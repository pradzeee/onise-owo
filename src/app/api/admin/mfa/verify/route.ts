import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  ADMIN_MFA_COOKIE_NAME,
  ADMIN_MFA_SESSION_HOURS,
  checkAdminTwoStep,
  generateAdminMfaToken,
} from "@/lib/admin-auth";
import { logger } from "@/lib/logger";
import { checkRateLimit, OTP_RATE_LIMITS } from "@/lib/rate-limit";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import { verifyTotpCode } from "@/lib/totp";

const verifySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app."),
});

export async function POST(request: NextRequest) {
  try {
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

    const limit = await checkRateLimit(check.userId, OTP_RATE_LIMITS.verifyByPhone);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: `Too many two-step attempts. Wait ${limit.retryAfterSeconds}s.` },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = verifySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid 6-digit code." },
        { status: 400 },
      );
    }

    const admin = createSupabaseAdminClient();
    const { data: totpRow } = await admin
      .from("admin_totp_secrets")
      .select("secret_base32, verified_at, last_used_step")
      .eq("admin_id", check.userId)
      .maybeSingle();

    if (!totpRow?.secret_base32) {
      return NextResponse.json(
        { error: "Reload the page to initialize your two-step authenticator setup." },
        { status: 400 },
      );
    }

    const { valid, matchedStep } = verifyTotpCode(
      totpRow.secret_base32,
      parsed.data.code,
      Date.now(),
      totpRow.last_used_step,
    );

    if (!valid || matchedStep === null) {
      return NextResponse.json(
        { error: "Invalid or already-used 6-digit authenticator code." },
        { status: 401 },
      );
    }

    const nowUtc = new Date();
    const expiresAt = new Date(
      nowUtc.getTime() + ADMIN_MFA_SESSION_HOURS * 60 * 60 * 1000,
    );
    const { rawToken, tokenHash } = generateAdminMfaToken();

    await admin
      .from("admin_totp_secrets")
      .update({
        verified_at: totpRow.verified_at ?? nowUtc.toISOString(),
        last_used_step: matchedStep,
        updated_at: nowUtc.toISOString(),
      })
      .eq("admin_id", check.userId);

    await admin.from("admin_mfa_sessions").insert({
      admin_id: check.userId,
      session_token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
    });

    await admin.from("audit_log").insert({
      actor_id: check.userId,
      action: totpRow.verified_at ? "admin_two_step_verified" : "admin_two_step_enrolled",
      target_type: "admin_session",
      target_id: check.userId,
      metadata: { expires_at: expiresAt.toISOString() },
    });

    logger.info("admin.mfa_verified", { adminId: check.userId });

    const response = NextResponse.json({
      ok: true,
      expiresAt: expiresAt.toISOString(),
    });

    response.cookies.set(ADMIN_MFA_COOKIE_NAME, rawToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ADMIN_MFA_SESSION_HOURS * 60 * 60,
    });

    return response;
  } catch (err) {
    logger.error("admin.mfa_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json({ error: "Verification error." }, { status: 500 });
  }
}
