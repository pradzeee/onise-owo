import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { verifyCaptchaToken } from "@/lib/captcha";
import {
  findAuthUserByPhone,
  formatDeletionBlockerReasons,
  generateDeletionOtp,
} from "@/lib/deletion";
import { getClientIp } from "@/lib/http";
import { logger } from "@/lib/logger";
import { maskPhoneForUi, normalizeNigerianPhone } from "@/lib/phone";
import { checkRateLimit, OTP_RATE_LIMITS } from "@/lib/rate-limit";
import { sendNigerianSms } from "@/lib/sms";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const requestSchema = z.object({
  phone: z.string().trim().min(10).max(25).optional(),
  captchaToken: z.string().trim().optional(),
});

/**
 * Requests a 6-digit account deletion confirmation OTP.
 * Works BOTH logged-in (from /settings) AND without login (from /delete-account).
 * Checks active job / pending payout or refund / open dispute blockers first.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseServerConfigured() || !isSupabaseAdminConfigured()) {
      return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
    }

    const rawBody = await request.json().catch(() => ({}));
    const parsed = requestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const clientIp = getClientIp(request);
    const ipLimit = await checkRateLimit(clientIp, OTP_RATE_LIMITS.requestByIp);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: `Too many requests. Wait ${ipLimit.retryAfterSeconds}s and try again.` },
        { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } },
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user: sessionUser },
    } = await supabase.auth.getUser();

    let targetUserId: string | null = null;
    let targetPhoneE164: string | null = null;

    if (sessionUser) {
      targetUserId = sessionUser.id;
      if (sessionUser.phone) {
        try {
          targetPhoneE164 = normalizeNigerianPhone(sessionUser.phone);
        } catch {
          targetPhoneE164 = `+${sessionUser.phone.replace(/^\+/, "")}`;
        }
      } else if (parsed.data.phone) {
        try {
          targetPhoneE164 = normalizeNigerianPhone(parsed.data.phone);
        } catch (err) {
          return NextResponse.json(
            { error: err instanceof Error ? err.message : "Invalid Nigerian phone." },
            { status: 400 },
          );
        }
      }
    } else {
      // Unauthenticated /delete-account flow requires phone + CAPTCHA
      if (!parsed.data.phone) {
        return NextResponse.json(
          { error: "Enter the Nigerian mobile number linked to your account." },
          { status: 400 },
        );
      }

      const captchaCheck = await verifyCaptchaToken(
        parsed.data.captchaToken ?? "",
        clientIp,
      );
      if (!captchaCheck.success) {
        return NextResponse.json(
          { error: captchaCheck.error ?? "Complete the CAPTCHA check." },
          { status: 400 },
        );
      }

      try {
        targetPhoneE164 = normalizeNigerianPhone(parsed.data.phone);
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "Invalid Nigerian phone." },
          { status: 400 },
        );
      }

      const phoneLimit = await checkRateLimit(
        targetPhoneE164,
        OTP_RATE_LIMITS.requestByPhone,
      );
      if (!phoneLimit.allowed) {
        return NextResponse.json(
          {
            error: `Please wait ${phoneLimit.retryAfterSeconds} seconds before requesting another code.`,
            retryAfterSeconds: phoneLimit.retryAfterSeconds,
          },
          { status: 429, headers: { "Retry-After": String(phoneLimit.retryAfterSeconds) } },
        );
      }

      const found = await findAuthUserByPhone(targetPhoneE164);
      if (!found) {
        return NextResponse.json(
          {
            error:
              "We could not find an active account matching that phone number.",
          },
          { status: 404 },
        );
      }
      targetUserId = found.id;
      targetPhoneE164 = found.phone;
    }

    if (!targetUserId || !targetPhoneE164) {
      return NextResponse.json(
        { error: "A verified mobile number is required to send the deletion OTP." },
        { status: 400 },
      );
    }

    const admin = createSupabaseAdminClient();

    // Check deletion blockers BEFORE sending OTP
    const [{ data: blockerRows }, { data: profileRow }] = await Promise.all([
      admin.rpc("check_account_deletion_blockers", { p_user_id: targetUserId }),
      admin
        .from("profiles")
        .select("role, account_status")
        .eq("id", targetUserId)
        .maybeSingle(),
    ]);

    const blocker = (Array.isArray(blockerRows) ? blockerRows[0] : blockerRows) as {
      can_delete: boolean;
      active_jobs_count: number;
      pending_payments_or_refunds_count: number;
      open_disputes_count: number;
    };

    if (blocker && !blocker.can_delete) {
      const reasons = formatDeletionBlockerReasons({
        activeJobsCount: blocker.active_jobs_count,
        pendingPaymentsOrRefundsCount: blocker.pending_payments_or_refunds_count,
        openDisputesCount: blocker.open_disputes_count,
      });

      return NextResponse.json(
        {
          error: "Your account cannot be deleted right now because of open items.",
          blocked: true,
          blockers: {
            activeJobsCount: blocker.active_jobs_count,
            pendingPaymentsOrRefundsCount: blocker.pending_payments_or_refunds_count,
            openDisputesCount: blocker.open_disputes_count,
            reasons,
          },
          canPause: profileRow?.role === "artisan",
        },
        { status: 409 },
      );
    }

    const { otp, otpHash, expiresAtIso } = generateDeletionOtp(targetUserId);
    const nowUtc = new Date().toISOString();

    await admin.from("deletion_requests").upsert(
      {
        user_id: targetUserId,
        status: "otp_pending",
        removal_reason: "user_requested",
        otp_hash: otpHash,
        otp_expires_at: expiresAtIso,
        otp_attempts: 0,
        updated_at: nowUtc,
      },
      { onConflict: "user_id" },
    );

    const smsRes = await sendNigerianSms({
      toE164: targetPhoneE164,
      purpose: "account_deletion_otp",
      message: `Your Onise Owo account deletion code is ${otp}. Enter this code only if you want to delete your account. Expires in 15 minutes.`,
    });

    const isDevMock =
      process.env.NODE_ENV !== "production" && smsRes.provider === "dev_mock";

    logger.info("deletion.otp_sent", { authenticated: Boolean(sessionUser) });

    return NextResponse.json({
      ok: true,
      maskedPhone: maskPhoneForUi(targetPhoneE164),
      cooldownSeconds: 60,
      ...(isDevMock ? { devOtpPreview: otp } : {}),
    });
  } catch (err) {
    logger.error("deletion.request_otp_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not start account deletion right now." },
      { status: 500 },
    );
  }
}
