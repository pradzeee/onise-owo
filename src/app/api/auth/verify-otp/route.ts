import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getClientIp } from "@/lib/http";
import { logger } from "@/lib/logger";
import { normalizeNigerianPhone } from "@/lib/phone";
import { checkRateLimit, OTP_RATE_LIMITS } from "@/lib/rate-limit";
import {
  createSupabaseServerClient,
  isRealSupabaseConfigured,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const verifyOtpSchema = z.object({
  phone: z.string().min(10).max(25),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit verification code sent by SMS."),
});

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => null);
    const parsed = verifyOtpSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid verification code." },
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

    const clientIp = getClientIp(request);

    const ipLimit = await checkRateLimit(clientIp, OTP_RATE_LIMITS.verifyByIp);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        {
          error: `Too many verification attempts. Please try again in ${ipLimit.retryAfterSeconds} seconds.`,
        },
        {
          status: 429,
          headers: { "Retry-After": String(ipLimit.retryAfterSeconds) },
        },
      );
    }

    const phoneLimit = await checkRateLimit(
      normalizedPhone,
      OTP_RATE_LIMITS.verifyByPhone,
    );
    if (!phoneLimit.allowed) {
      return NextResponse.json(
        {
          error: `Too many incorrect attempts. Please wait ${phoneLimit.retryAfterSeconds} seconds or request a new code.`,
        },
        {
          status: 429,
          headers: { "Retry-After": String(phoneLimit.retryAfterSeconds) },
        },
      );
    }

    // Block legacy non-Supabase OTP bypass so no unverified session cookies can be minted
    if (!isRealSupabaseConfigured()) {
      return NextResponse.json(
        { error: "Phone OTP verification is disabled. Sign in with Google or Email & Password." },
        { status: 410 },
      );
    }

    if (!isSupabaseServerConfigured()) {
      return NextResponse.json(
        { error: "Supabase is not configured yet." },
        { status: 503 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({
      phone: normalizedPhone,
      token: parsed.data.code,
      type: "sms",
    });

    if (error || !data.user) {
      logger.warn("auth.otp_verify_failed", {
        code: error?.code ?? "invalid_otp",
      });
      return NextResponse.json(
        { error: "Invalid or expired code. Please check the SMS and try again." },
        { status: 401 },
      );
    }

    // Check whether the user already completed role selection + mandatory consents
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, account_status")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profile?.account_status === "deleted" || profile?.account_status === "suspended") {
      await supabase.auth.signOut();
      return NextResponse.json(
        { error: "This account is currently unavailable. Please contact support." },
        { status: 403 },
      );
    }

    const nextPath = profile?.role ? "/dashboard" : "/onboarding";

    logger.info("auth.otp_verified", {
      userId: data.user.id,
      hasRole: Boolean(profile?.role),
    });

    return NextResponse.json({
      ok: true,
      nextPath,
    });
  } catch (err) {
    logger.error("auth.otp_verify_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not verify code right now. Please try again." },
      { status: 500 },
    );
  }
}
