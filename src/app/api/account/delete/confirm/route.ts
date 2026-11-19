import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  findAuthUserByPhone,
  formatDeletionBlockerReasons,
  verifyDeletionOtpHash,
} from "@/lib/deletion";
import { getClientIp } from "@/lib/http";
import { logger } from "@/lib/logger";
import { normalizeNigerianPhone } from "@/lib/phone";
import { checkRateLimit, OTP_RATE_LIMITS } from "@/lib/rate-limit";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const confirmSchema = z.object({
  phone: z.string().trim().min(10).max(25).optional(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit deletion confirmation code."),
});

/**
 * Confirms account deletion with the 6-digit OTP (works logged-in OR unauthenticated):
 * - Re-verifies blockers atomically
 * - Marks account 'deleted' at once, hides from search, deletes push_subscriptions & trusted_contacts
 * - Logs out ALL active sessions globally
 * - Schedules permanent erasure within 30 days
 */
export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseServerConfigured() || !isSupabaseAdminConfigured()) {
      return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = confirmSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid confirmation code." },
        { status: 400 },
      );
    }

    const clientIp = getClientIp(request);
    const ipLimit = await checkRateLimit(clientIp, OTP_RATE_LIMITS.verifyByIp);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: `Too many attempts. Wait ${ipLimit.retryAfterSeconds}s.` },
        { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } },
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user: sessionUser },
    } = await supabase.auth.getUser();

    let targetUserId: string | null = sessionUser?.id ?? null;

    if (!targetUserId) {
      if (!parsed.data.phone) {
        return NextResponse.json(
          { error: "Enter the phone number linked to your account." },
          { status: 400 },
        );
      }
      let phoneE164: string;
      try {
        phoneE164 = normalizeNigerianPhone(parsed.data.phone);
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "Invalid phone number." },
          { status: 400 },
        );
      }
      const found = await findAuthUserByPhone(phoneE164);
      if (!found) {
        return NextResponse.json(
          { error: "Invalid code or account not found." },
          { status: 401 },
        );
      }
      targetUserId = found.id;
    }

    const admin = createSupabaseAdminClient();
    const { data: reqRow } = await admin
      .from("deletion_requests")
      .select("id, status, otp_hash, otp_expires_at, otp_attempts, scheduled_purge_at")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!reqRow) {
      return NextResponse.json(
        { error: "Please request a deletion code first." },
        { status: 400 },
      );
    }

    // Idempotent if already scheduled
    if (reqRow.status === "scheduled") {
      if (sessionUser) await supabase.auth.signOut();
      return NextResponse.json({
        ok: true,
        status: "scheduled",
        scheduledPurgeAt: reqRow.scheduled_purge_at,
      });
    }

    if (reqRow.otp_attempts >= 5) {
      return NextResponse.json(
        { error: "Too many incorrect attempts. Request a fresh deletion code." },
        { status: 429 },
      );
    }

    if (!reqRow.otp_hash || !reqRow.otp_expires_at) {
      return NextResponse.json(
        { error: "Please request a deletion code first." },
        { status: 400 },
      );
    }

    if (new Date(reqRow.otp_expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        { error: "That code has expired. Please request a new code." },
        { status: 400 },
      );
    }

    const matches = verifyDeletionOtpHash(targetUserId, parsed.data.code, reqRow.otp_hash);
    if (!matches) {
      await admin
        .from("deletion_requests")
        .update({
          otp_attempts: reqRow.otp_attempts + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", reqRow.id);

      return NextResponse.json(
        { error: "Incorrect 6-digit code. Please check the SMS and try again." },
        { status: 401 },
      );
    }

    // Atomically check blockers, soft-delete, hide from search, wipe push subs & trusted contacts
    const { data: initRes, error: initErr } = await admin.rpc(
      "initiate_account_deletion",
      {
        p_user_id: targetUserId,
        p_removal_reason: "user_requested",
        p_force_admin_override: false,
      },
    );

    if (initErr) {
      logger.error("deletion.initiate_failed", { code: initErr.code });
      return NextResponse.json(
        { error: "Could not complete account deletion right now." },
        { status: 500 },
      );
    }

    const row = (Array.isArray(initRes) ? initRes[0] : initRes) as {
      scheduled: boolean;
      scheduled_purge_at: string | null;
      active_jobs_count: number;
      pending_payments_or_refunds_count: number;
      open_disputes_count: number;
    };

    if (!row?.scheduled) {
      return NextResponse.json(
        {
          error: "Deletion is currently blocked by open items.",
          blocked: true,
          blockers: {
            activeJobsCount: row?.active_jobs_count ?? 0,
            pendingPaymentsOrRefundsCount: row?.pending_payments_or_refunds_count ?? 0,
            openDisputesCount: row?.open_disputes_count ?? 0,
            reasons: formatDeletionBlockerReasons({
              activeJobsCount: row?.active_jobs_count ?? 0,
              pendingPaymentsOrRefundsCount: row?.pending_payments_or_refunds_count ?? 0,
              openDisputesCount: row?.open_disputes_count ?? 0,
            }),
          },
        },
        { status: 409 },
      );
    }

    // Log out ALL sessions for this user immediately
    await admin.auth.admin.signOut(targetUserId, "global").catch(() => {});
    if (sessionUser) {
      await supabase.auth.signOut().catch(() => {});
    }

    logger.info("deletion.scheduled", { scheduledPurgeAt: row.scheduled_purge_at });

    return NextResponse.json({
      ok: true,
      status: "scheduled",
      scheduledPurgeAt: row.scheduled_purge_at,
    });
  } catch (err) {
    logger.error("deletion.confirm_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not confirm account deletion." },
      { status: 500 },
    );
  }
}
