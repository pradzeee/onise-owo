import { NextResponse } from "next/server";
import { checkAdminTwoStep } from "@/lib/admin-auth";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import { buildTotpOtpAuthUri, generateTotpSecret } from "@/lib/totp";

/**
 * Returns admin two-step (TOTP) enrollment & verification status.
 * If the admin has not enrolled yet, generates a fresh Base32 TOTP secret
 * so they can add it to Google Authenticator / Authy and verify step 2.
 */
export async function GET() {
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
  }

  const check = await checkAdminTwoStep();
  if (!check.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!check.isAdmin || !check.userId) {
    return NextResponse.json({ error: "Admin privileges required." }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("admin_totp_secrets")
    .select("secret_base32, verified_at")
    .eq("admin_id", check.userId)
    .maybeSingle();

  if (existing?.verified_at) {
    return NextResponse.json({
      ok: true,
      enrolled: true,
      mfaVerified: check.mfaVerified,
    });
  }

  let secretBase32 = existing?.secret_base32;
  if (!secretBase32) {
    secretBase32 = generateTotpSecret();
    await admin.from("admin_totp_secrets").upsert(
      {
        admin_id: check.userId,
        secret_base32: secretBase32,
        verified_at: null,
      },
      { onConflict: "admin_id" },
    );
  }

  return NextResponse.json({
    ok: true,
    enrolled: false,
    mfaVerified: false,
    setupSecretBase32: secretBase32,
    otpAuthUri: buildTotpOtpAuthUri(`admin-${check.userId.slice(0, 8)}`, secretBase32),
  });
}
