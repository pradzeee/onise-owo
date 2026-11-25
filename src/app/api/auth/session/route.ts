import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { LEGAL_VERSIONS, TRADES, type ArtisanTrade } from "@/lib/constants";
import {
  fetchFirestoreUserProfile,
  getActiveFirebaseSession,
  isFirebaseServerConfigured,
  normalizeDisplayName,
  saveFirestoreUserProfile,
  setFirebaseSessionCookies,
  verifyFirebaseIdToken,
  type FirebaseUserProfileDoc,
} from "@/lib/firebase/server";
import { logger } from "@/lib/logger";

const VALID_TRADE_IDS = TRADES.map((t) => t.id) as [ArtisanTrade, ...ArtisanTrade[]];

const sessionPostSchema = z.object({
  idToken: z.string().min(20, "Missing authentication token."),
  mode: z.enum(["login", "signup", "refresh"]).default("login"),
  role: z.enum(["customer", "artisan"]).optional(),
  trade: z.enum(VALID_TRADE_IDS).optional(),
  displayName: z.string().trim().max(120).optional(),
  acceptedTerms: z.boolean().optional(),
});

export async function GET() {
  const session = await getActiveFirebaseSession();
  if (!session) {
    return NextResponse.json({ authenticated: false, user: null });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      uid: session.uid,
      email: session.email,
      displayName: session.displayName,
      role: session.role,
      trade: session.trade,
      accountStatus: session.accountStatus,
      verificationStatus: session.verificationStatus,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    if (!isFirebaseServerConfigured()) {
      return NextResponse.json(
        { error: "Firebase authentication is not configured on this server." },
        { status: 503 },
      );
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = sessionPostSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid session request." },
        { status: 400 },
      );
    }

    const { idToken, mode, role, trade, displayName, acceptedTerms } = parsed.data;

    let verified;
    try {
      verified = await verifyFirebaseIdToken(idToken);
    } catch (err) {
      logger.warn("auth.firebase_token_rejected", {
        message: err instanceof Error ? err.message : "invalid_token",
      });
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid authentication token." },
        { status: 401 },
      );
    }

    if (!verified.email) {
      return NextResponse.json(
        { error: "Your account must provide a valid email address." },
        { status: 400 },
      );
    }

    const existingDoc = await fetchFirestoreUserProfile(verified.uid, idToken);

    // Prevent suspended or deleted accounts from signing back in
    if (
      existingDoc &&
      (existingDoc.accountStatus as string) !== "active" &&
      (existingDoc.accountStatus as string) !== "paused"
    ) {
      return NextResponse.json(
        { error: "This account has been suspended or scheduled for deletion." },
        { status: 403 },
      );
    }

    // Registration flow: enforce unique account per email/UID and required terms
    if (mode === "signup") {
      if (existingDoc) {
        return NextResponse.json(
          {
            error: `An account with this email already exists as a ${existingDoc.role}. Please log in instead.`,
          },
          { status: 409 },
        );
      }

      if (!role) {
        return NextResponse.json(
          { error: "Please select whether you are registering as a Customer or Artisan." },
          { status: 400 },
        );
      }

      if (role === "artisan" && !trade) {
        return NextResponse.json(
          { error: "Please choose your primary trade category." },
          { status: 400 },
        );
      }

      if (acceptedTerms !== true) {
        return NextResponse.json(
          { error: "You must confirm you are 18+ and accept our Terms & Privacy Policy." },
          { status: 400 },
        );
      }

      const nowIso = new Date().toISOString();
      const safeName = normalizeDisplayName(displayName ?? verified.name, verified.email);
      const newProfile: FirebaseUserProfileDoc = {
        uid: verified.uid,
        email: verified.email,
        displayName: safeName,
        role,
        trade: role === "artisan" ? (trade ?? "plumber") : null,
        phone: null,
        accountStatus: "active",
        verificationStatus: "unverified",
        accepted18Plus: true,
        acceptedTermsVersion: LEGAL_VERSIONS.terms_of_service,
        acceptedPrivacyVersion: LEGAL_VERSIONS.privacy_policy,
        consents: {
          age_18_plus: true,
          terms_of_service: true,
          privacy_policy: true,
        },
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      await saveFirestoreUserProfile(verified.uid, idToken, newProfile);

      await setFirebaseSessionCookies(
        {
          uid: newProfile.uid,
          email: newProfile.email,
          displayName: newProfile.displayName,
          role: newProfile.role,
          trade: newProfile.trade,
          phone: null,
          accountStatus: newProfile.accountStatus,
          verificationStatus: newProfile.verificationStatus,
        },
        idToken,
      );

      logger.info("auth.firebase_signup_success", {
        uid: verified.uid,
        role,
        provider: verified.signInProvider,
      });

      return NextResponse.json({
        ok: true,
        nextPath: role === "artisan" ? "/artisan/onboarding" : "/dashboard",
      });
    }

    // Login or silent token refresh flow
    if (existingDoc) {
      await setFirebaseSessionCookies(
        {
          uid: existingDoc.uid,
          email: existingDoc.email || verified.email,
          displayName: existingDoc.displayName || verified.name,
          role: existingDoc.role,
          trade: existingDoc.trade,
          phone: existingDoc.phone,
          accountStatus: existingDoc.accountStatus,
          verificationStatus: existingDoc.verificationStatus,
        },
        idToken,
      );

      logger.info("auth.firebase_login_success", {
        uid: verified.uid,
        role: existingDoc.role,
        provider: verified.signInProvider,
      });

      return NextResponse.json({
        ok: true,
        nextPath: "/dashboard",
      });
    }

    // Refresh preserves current session details if Firestore doc was temporarily unreachable
    const previousSession = mode === "refresh" ? await getActiveFirebaseSession() : null;
    if (previousSession && previousSession.uid === verified.uid && previousSession.role) {
      await setFirebaseSessionCookies(
        {
          uid: previousSession.uid,
          email: verified.email || previousSession.email,
          displayName: previousSession.displayName,
          role: previousSession.role,
          trade: previousSession.trade,
          phone: previousSession.phone,
          accountStatus: previousSession.accountStatus,
          verificationStatus: previousSession.verificationStatus,
        },
        idToken,
      );
      return NextResponse.json({ ok: true, nextPath: "/dashboard" });
    }

    // Brand-new Google user logging in from /login -> route smoothly to /onboarding
    const fallbackName = normalizeDisplayName(verified.name, verified.email);
    await setFirebaseSessionCookies(
      {
        uid: verified.uid,
        email: verified.email,
        displayName: fallbackName,
        role: null,
        trade: null,
        phone: null,
        accountStatus: "active",
        verificationStatus: "unverified",
      },
      idToken,
    );

    logger.info("auth.firebase_onboarding_needed", {
      uid: verified.uid,
      provider: verified.signInProvider,
    });

    return NextResponse.json({
      ok: true,
      nextPath: "/onboarding",
    });
  } catch (err) {
    logger.error("auth.firebase_session_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Unable to complete authentication. Please try again." },
      { status: 500 },
    );
  }
}
