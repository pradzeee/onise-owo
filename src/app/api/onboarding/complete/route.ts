import { cookies } from "next/headers";
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
  type FirebaseUserProfileDoc,
} from "@/lib/firebase/server";
import { logger } from "@/lib/logger";
import {
  createSupabaseServerClient,
  isRealSupabaseConfigured,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const VALID_TRADE_IDS = TRADES.map((t) => t.id) as [ArtisanTrade, ...ArtisanTrade[]];

// Strictly allows ONLY 'customer' or 'artisan'. 'admin' is rejected here AND in Postgres/Firestore.
const onboardingSchema = z
  .object({
    role: z.enum(["customer", "artisan"], {
      errorMap: () => ({ message: "Choose either Customer or Artisan." }),
    }),
    trade: z.enum(VALID_TRADE_IDS).optional(),
    acceptedAgeAndLegal: z.literal(true, {
      errorMap: () => ({
        message:
          "You must confirm that you are 18 or older and accept the Terms of Service and Privacy Policy.",
      }),
    }),
    idempotencyKey: z.string().trim().min(8).max(128).optional(),
  })
  .refine(
    (data) => data.role !== "artisan" || Boolean(data.trade),
    { message: "Please select your primary trade category.", path: ["trade"] },
  );

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => null);
    const parsed = onboardingSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid onboarding input." },
        { status: 400 },
      );
    }

    // 1. Firebase Auth + Firestore Onboarding Flow
    if (!isRealSupabaseConfigured() && isFirebaseServerConfigured()) {
      const fbSession = await getActiveFirebaseSession();
      if (!fbSession || !fbSession.idToken) {
        return NextResponse.json(
          { error: "Please sign in with Google or Email & Password first." },
          { status: 401 },
        );
      }

      const existing = await fetchFirestoreUserProfile(fbSession.uid, fbSession.idToken);
      if (existing?.role) {
        await setFirebaseSessionCookies(
          {
            uid: existing.uid,
            email: existing.email,
            displayName: existing.displayName,
            role: existing.role,
            trade: existing.trade,
            phone: existing.phone,
            accountStatus: existing.accountStatus,
            verificationStatus: existing.verificationStatus,
          },
          fbSession.idToken,
        );
        return NextResponse.json({
          ok: true,
          nextPath: "/dashboard",
        });
      }

      const nowIso = new Date().toISOString();
      const role = parsed.data.role;
      const trade = role === "artisan" ? (parsed.data.trade ?? "plumber") : null;
      const safeName = normalizeDisplayName(fbSession.displayName, fbSession.email);

      const profileDoc: FirebaseUserProfileDoc = {
        uid: fbSession.uid,
        email: fbSession.email,
        displayName: safeName,
        role,
        trade,
        phone: fbSession.phone ?? null,
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

      await saveFirestoreUserProfile(fbSession.uid, fbSession.idToken, profileDoc);

      await setFirebaseSessionCookies(
        {
          uid: profileDoc.uid,
          email: profileDoc.email,
          displayName: profileDoc.displayName,
          role: profileDoc.role,
          trade: profileDoc.trade,
          phone: profileDoc.phone,
          accountStatus: profileDoc.accountStatus,
          verificationStatus: profileDoc.verificationStatus,
        },
        fbSession.idToken,
      );

      logger.info("onboarding.firebase_completed", {
        uid: fbSession.uid,
        role,
      });

      return NextResponse.json({
        ok: true,
        profile: profileDoc,
        nextPath: role === "artisan" ? "/artisan/onboarding" : "/dashboard",
      });
    }

    // 2. Supabase Postgres Onboarding Flow
    if (!isSupabaseServerConfigured()) {
      return NextResponse.json(
        { error: "Authentication backend is not configured yet." },
        { status: 503 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
    }

    const headerKey = request.headers.get("x-idempotency-key")?.trim();
    const idempotencyKey = parsed.data.idempotencyKey ?? headerKey ?? null;

    const { data, error } = await supabase.rpc("complete_onboarding", {
      p_role: parsed.data.role,
      p_terms_version: LEGAL_VERSIONS.terms_of_service,
      p_privacy_version: LEGAL_VERSIONS.privacy_policy,
      p_accepted_required: parsed.data.acceptedAgeAndLegal,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      logger.warn("onboarding.complete_failed", {
        userId: user.id,
        code: error.code,
      });
      return NextResponse.json(
        { error: error.message || "Could not complete onboarding." },
        { status: error.code === "42501" ? 403 : 400 },
      );
    }

    logger.info("onboarding.completed", {
      userId: user.id,
      role: parsed.data.role,
    });

    const cookieStore = await cookies();
    cookieStore.set("onise_user_role", parsed.data.role, {
      path: "/",
      sameSite: "lax",
    });

    return NextResponse.json({
      ok: true,
      profile: data,
      nextPath: parsed.data.role === "artisan" ? "/artisan/onboarding" : "/dashboard",
    });
  } catch (err) {
    logger.error("onboarding.exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
