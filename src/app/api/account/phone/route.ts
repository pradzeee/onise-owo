import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { LEGAL_VERSIONS } from "@/lib/constants";
import {
  fetchFirestoreUserProfile,
  getActiveFirebaseSession,
  isFirebaseServerConfigured,
  normalizeDisplayName,
  saveFirestoreUserProfile,
  setFirebaseSessionCookies,
} from "@/lib/firebase/server";
import { logger } from "@/lib/logger";
import { maskPhoneForUi, normalizeNigerianPhone } from "@/lib/phone";
import {
  createSupabaseServerClient,
  isRealSupabaseConfigured,
} from "@/lib/supabase/server";

const updatePhoneSchema = z.object({
  phone: z.string().min(10, "Enter your 11-digit Nigerian mobile number.").max(25),
});

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => null);
    const parsed = updatePhoneSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid phone number." },
        { status: 400 },
      );
    }

    let normalizedPhone: string;
    try {
      normalizedPhone = normalizeNigerianPhone(parsed.data.phone);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid Nigerian phone number." },
        { status: 400 },
      );
    }

    // 1. Live Supabase update
    if (isRealSupabaseConfigured()) {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
      }

      await supabase.auth
        .updateUser({
          phone: normalizedPhone,
        })
        .catch(() => {});

      await supabase
        .from("profiles")
        .update({
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id)
        .catch(() => {});

      logger.info("account.phone_updated", { ok: true });
      return NextResponse.json({
        ok: true,
        phone: normalizedPhone,
        maskedPhone: maskPhoneForUi(normalizedPhone),
      });
    }

    // 2. Firebase Auth + Firestore update
    if (isFirebaseServerConfigured()) {
      const fbSession = await getActiveFirebaseSession();
      if (!fbSession) {
        return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
      }

      const nowIso = new Date().toISOString();
      if (fbSession.idToken) {
        const existing = await fetchFirestoreUserProfile(fbSession.uid, fbSession.idToken);
        if (existing) {
          await saveFirestoreUserProfile(
            fbSession.uid,
            fbSession.idToken,
            { phone: normalizedPhone, updatedAt: nowIso },
            ["phone", "updatedAt"],
          );
        } else if (fbSession.role === "customer" || fbSession.role === "artisan") {
          await saveFirestoreUserProfile(fbSession.uid, fbSession.idToken, {
            uid: fbSession.uid,
            email: fbSession.email,
            displayName: normalizeDisplayName(fbSession.displayName, fbSession.email),
            role: fbSession.role,
            trade: fbSession.role === "artisan" ? (fbSession.trade ?? "plumber") : null,
            phone: normalizedPhone,
            accountStatus: fbSession.accountStatus === "paused" ? "paused" : "active",
            verificationStatus: fbSession.verificationStatus,
            accepted18Plus: true,
            acceptedTermsVersion: LEGAL_VERSIONS.terms_of_service,
            acceptedPrivacyVersion: LEGAL_VERSIONS.privacy_policy,
            consents: { age_18_plus: true, terms_of_service: true, privacy_policy: true },
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }
      }

      await setFirebaseSessionCookies(
        {
          uid: fbSession.uid,
          email: fbSession.email,
          displayName: fbSession.displayName,
          role: fbSession.role,
          trade: fbSession.trade,
          phone: normalizedPhone,
          accountStatus: fbSession.accountStatus,
          verificationStatus: fbSession.verificationStatus,
        },
        fbSession.idToken,
      );

      logger.info("account.phone_updated", { ok: true });
      return NextResponse.json({
        ok: true,
        phone: normalizedPhone,
        maskedPhone: maskPhoneForUi(normalizedPhone),
      });
    }

    // 3. Offline fallback
    const cookieStore = await cookies();
    cookieStore.set("onise_user_phone", normalizedPhone, {
      path: "/",
      sameSite: "lax",
    });

    logger.info("account.phone_updated", { ok: true });
    return NextResponse.json({
      ok: true,
      phone: normalizedPhone,
      maskedPhone: maskPhoneForUi(normalizedPhone),
    });
  } catch (err) {
    logger.error("account.phone_update_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not update phone number. Please try again." },
      { status: 500 },
    );
  }
}
