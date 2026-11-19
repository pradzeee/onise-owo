import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { verifyCaptchaToken } from "@/lib/captcha";
import { isDevAccessAllowed } from "@/lib/dev-access";
import { getClientIp } from "@/lib/http";
import { logger } from "@/lib/logger";
import { maskPhoneForUi, normalizeNigerianPhone } from "@/lib/phone";
import { checkRateLimit, OTP_RATE_LIMITS } from "@/lib/rate-limit";
import {
  createSupabaseServerClient,
  isRealSupabaseConfigured,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const requestOtpSchema = z.object({
  phone: z.string().min(10, "Enter your Nigerian mobile number.").max(25),
  captchaToken: z.string().min(1, "Please complete the CAPTCHA check."),
});

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => null);
    const parsed = requestOtpSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request." },
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

    // In local dev without live Supabase, accept immediately with mock code 123456
    if (isDevAccessAllowed() && !isRealSupabaseConfigured()) {
      return NextResponse.json({
        ok: true,
        maskedPhone: maskPhoneForUi(normalizedPhone),
        cooldownSeconds: 30,
      });
    }

    const clientIp = getClientIp(request);

    // 1. Verify CAPTCHA before spending SMS credits or hitting Supabase Auth
    const captchaCheck = await verifyCaptchaToken(parsed.data.captchaToken, clientIp);
    if (!captchaCheck.success) {
      return NextResponse.json(
        { error: captchaCheck.error ?? "CAPTCHA verification failed." },
        { status: 400 },
      );
    }

    // 2. Enforce IP and phone-hash rate limits (never stores raw phone or IP)
    const ipLimit = await checkRateLimit(clientIp, OTP_RATE_LIMITS.requestByIp);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        {
          error: `Too many requests from this network. Please wait ${ipLimit.retryAfterSeconds} seconds and try again.`,
          retryAfterSeconds: ipLimit.retryAfterSeconds,
        },
        {
          status: 429,
          headers: { "Retry-After": String(ipLimit.retryAfterSeconds) },
        },
      );
    }

    const phoneLimit = await checkRateLimit(
      normalizedPhone,
      OTP_RATE_LIMITS.requestByPhone,
    );
    if (!phoneLimit.allowed) {
      return NextResponse.json(
        {
          error: `Please wait ${phoneLimit.retryAfterSeconds} seconds before requesting another code.`,
          retryAfterSeconds: phoneLimit.retryAfterSeconds,
        },
        {
          status: 429,
          headers: { "Retry-After": String(phoneLimit.retryAfterSeconds) },
        },
      );
    }

    if (!isSupabaseServerConfigured()) {
      return NextResponse.json(
        {
          error:
            "Supabase is not configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
        },
        { status: 503 },
      );
    }

    // 3. Dispatch OTP via Supabase Auth (which triggers the Nigerian Send SMS Hook)
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      phone: normalizedPhone,
      options: {
        shouldCreateUser: true,
      },
    });

    if (error) {
      logger.warn("auth.otp_request_failed", {
        status: error.status ?? 400,
        code: error.code ?? "unknown",
      });
      return NextResponse.json(
        {
          error:
            error.status === 429
              ? "Too many SMS attempts. Please wait a minute and try again."
              : "Could not send verification code right now. Please check the number and try again.",
        },
        { status: error.status === 429 ? 429 : 400 },
      );
    }

    logger.info("auth.otp_requested", { ok: true });

    return NextResponse.json({
      ok: true,
      maskedPhone: maskPhoneForUi(normalizedPhone),
      cooldownSeconds: OTP_RATE_LIMITS.requestByPhone.cooldownSeconds,
    });
  } catch (err) {
    logger.error("auth.otp_request_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
