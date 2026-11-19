import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { generateGuarantorOtp, hashGuarantorToken } from "@/lib/guarantor";
import { getClientIp } from "@/lib/http";
import { logger } from "@/lib/logger";
import { maskPhoneForUi } from "@/lib/phone";
import { checkRateLimit, OTP_RATE_LIMITS } from "@/lib/rate-limit";
import { sendNigerianSms } from "@/lib/sms";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";

const requestOtpSchema = z.object({
  acceptedPrivacyNotice: z.literal(true, {
    errorMap: () => ({
      message: "Please read and accept the short privacy notice to continue.",
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
    const parsed = requestOtpSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }

    const tokenHash = hashGuarantorToken(token);
    const clientIp = getClientIp(request);

    const ipLimit = await checkRateLimit(clientIp, OTP_RATE_LIMITS.requestByIp);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: `Too many requests. Please wait ${ipLimit.retryAfterSeconds} seconds.` },
        { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } },
      );
    }

    const tokenLimit = await checkRateLimit(
      tokenHash,
      OTP_RATE_LIMITS.guarantorOtpRequestByToken,
    );
    if (!tokenLimit.allowed) {
      return NextResponse.json(
        {
          error: `Please wait ${tokenLimit.retryAfterSeconds} seconds before requesting another code.`,
          retryAfterSeconds: tokenLimit.retryAfterSeconds,
        },
        { status: 429, headers: { "Retry-After": String(tokenLimit.retryAfterSeconds) } },
      );
    }

    const admin = createSupabaseAdminClient();
    const { data: record, error } = await admin
      .from("guarantor_verifications")
      .select("id, guarantor_phone_e164, status")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (error || !record) {
      return NextResponse.json(
        { error: "This guarantor link is invalid or has expired." },
        { status: 404 },
      );
    }

    if (record.status === "confirmed") {
      return NextResponse.json({ ok: true, alreadyConfirmed: true });
    }

    if (record.status !== "pending") {
      return NextResponse.json(
        { error: "This guarantor link is no longer active." },
        { status: 410 },
      );
    }

    const { otp, otpHash, expiresAtIso } = generateGuarantorOtp(record.id);
    const nowUtc = new Date().toISOString();

    const { error: updateErr } = await admin
      .from("guarantor_verifications")
      .update({
        otp_hash: otpHash,
        otp_expires_at: expiresAtIso,
        otp_attempts: 0,
        privacy_notice_accepted_at: nowUtc,
        updated_at: nowUtc,
      })
      .eq("id", record.id);

    if (updateErr) {
      logger.error("guarantor.otp_store_failed", { guarantorId: record.id });
      return NextResponse.json(
        { error: "Could not generate verification code." },
        { status: 500 },
      );
    }

    const smsResult = await sendNigerianSms({
      toE164: record.guarantor_phone_e164,
      purpose: "guarantor_otp",
      message: `Your Onise Owo guarantor confirmation code is ${otp}. It expires in 15 minutes. Never share this code.`,
    });

    const isDevMock =
      process.env.NODE_ENV !== "production" && smsResult.provider === "dev_mock";

    return NextResponse.json({
      ok: true,
      maskedPhone: maskPhoneForUi(record.guarantor_phone_e164),
      cooldownSeconds: OTP_RATE_LIMITS.guarantorOtpRequestByToken.cooldownSeconds,
      ...(isDevMock ? { devOtpPreview: otp } : {}),
    });
  } catch (err) {
    logger.error("guarantor.request_otp_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not send guarantor verification code." },
      { status: 500 },
    );
  }
}
