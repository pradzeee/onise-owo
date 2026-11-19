import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hashGuarantorToken, verifyGuarantorOtpHash } from "@/lib/guarantor";
import { logger } from "@/lib/logger";
import { checkRateLimit, OTP_RATE_LIMITS } from "@/lib/rate-limit";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";

const confirmSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code sent to your phone."),
  acceptedPrivacyNotice: z.literal(true, {
    errorMap: () => ({
      message: "Please accept the privacy notice to confirm.",
    }),
  }),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  try {
    if (!isSupabaseAdminConfigured()) {
      return NextResponse.json(
        { error: "Server configuration is incomplete." },
        { status: 503 },
      );
    }

    const { token } = await context.params;
    if (!token || token.length < 16) {
      return NextResponse.json({ error: "Invalid guarantor link." }, { status: 400 });
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = confirmSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid confirmation code." },
        { status: 400 },
      );
    }

    const tokenHash = hashGuarantorToken(token);
    const limit = await checkRateLimit(
      tokenHash,
      OTP_RATE_LIMITS.guarantorOtpVerifyByToken,
    );
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error: `Too many attempts. Please wait ${limit.retryAfterSeconds} seconds.`,
        },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }

    const admin = createSupabaseAdminClient();
    const { data: record, error } = await admin
      .from("guarantor_verifications")
      .select("id, artisan_id, status, otp_hash, otp_expires_at, otp_attempts, confirmed_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (error || !record) {
      return NextResponse.json(
        { error: "This guarantor link is invalid or expired." },
        { status: 404 },
      );
    }

    // Idempotent: confirming an already confirmed guarantor returns success cleanly
    if (record.status === "confirmed") {
      return NextResponse.json({
        ok: true,
        status: "confirmed",
        confirmedAt: record.confirmed_at,
      });
    }

    if (record.status !== "pending") {
      return NextResponse.json(
        { error: "This guarantor link is no longer active." },
        { status: 410 },
      );
    }

    if (!record.otp_hash || !record.otp_expires_at) {
      return NextResponse.json(
        { error: "Please request a one-time code first." },
        { status: 400 },
      );
    }

    if (record.otp_attempts >= 5) {
      return NextResponse.json(
        { error: "Maximum attempts reached. Please request a fresh code." },
        { status: 429 },
      );
    }

    if (new Date(record.otp_expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        { error: "That code has expired. Please request a new code." },
        { status: 400 },
      );
    }

    const matches = verifyGuarantorOtpHash(record.id, parsed.data.code, record.otp_hash);
    if (!matches) {
      await admin
        .from("guarantor_verifications")
        .update({
          otp_attempts: record.otp_attempts + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", record.id);

      return NextResponse.json(
        { error: "Incorrect 6-digit code. Please try again." },
        { status: 401 },
      );
    }

    const nowUtc = new Date().toISOString();
    const { error: confirmErr } = await admin
      .from("guarantor_verifications")
      .update({
        status: "confirmed",
        confirmed_at: nowUtc,
        privacy_notice_accepted_at: nowUtc,
        otp_hash: null,
        otp_expires_at: null,
        updated_at: nowUtc,
      })
      .eq("id", record.id);

    if (confirmErr) {
      logger.error("guarantor.confirm_update_failed", { guarantorId: record.id });
      return NextResponse.json(
        { error: "Could not save confirmation right now." },
        { status: 500 },
      );
    }

    logger.info("guarantor.confirmed", {
      guarantorId: record.id,
      artisanId: record.artisan_id,
    });

    return NextResponse.json({
      ok: true,
      status: "confirmed",
      confirmedAt: nowUtc,
    });
  } catch (err) {
    logger.error("guarantor.confirm_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Something went wrong confirming guarantor status." },
      { status: 500 },
    );
  }
}
