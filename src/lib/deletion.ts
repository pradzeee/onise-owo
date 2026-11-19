import crypto from "crypto";
import { hmacHash } from "./crypto";
import { logger } from "./logger";
import { sendNigerianSms } from "./sms";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "./supabase/admin";

export interface DeletionBlockers {
  canDelete: boolean;
  activeJobsCount: number;
  pendingPaymentsOrRefundsCount: number;
  openDisputesCount: number;
  reasons: string[];
}

export function formatDeletionBlockerReasons(counts: {
  activeJobsCount: number;
  pendingPaymentsOrRefundsCount: number;
  openDisputesCount: number;
}): string[] {
  const reasons: string[] = [];
  if (counts.activeJobsCount > 0) {
    reasons.push(
      `You have ${counts.activeJobsCount} active job${counts.activeJobsCount === 1 ? "" : "s"} in progress or awaiting confirmation.`,
    );
  }
  if (counts.pendingPaymentsOrRefundsCount > 0) {
    reasons.push(
      `You have ${counts.pendingPaymentsOrRefundsCount} pending payout, payment, or refund.`,
    );
  }
  if (counts.openDisputesCount > 0) {
    reasons.push(
      `You have ${counts.openDisputesCount} open dispute${counts.openDisputesCount === 1 ? "" : "s"} awaiting resolution.`,
    );
  }
  return reasons;
}

export function generateDeletionOtp(userId: string): {
  otp: string;
  otpHash: string;
  expiresAtIso: string;
} {
  const otp = String(crypto.randomInt(100000, 1000000));
  const otpHash = hashDeletionOtp(userId, otp);
  const expiresAtIso = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  return { otp, otpHash, expiresAtIso };
}

export function hashDeletionOtp(userId: string, otp: string): string {
  return hmacHash("deletion:otp", `${userId}:${otp.trim()}`);
}

export function verifyDeletionOtpHash(
  userId: string,
  candidateOtp: string,
  storedHash: string | null | undefined,
): boolean {
  if (!storedHash || !/^\d{6}$/.test(candidateOtp.trim())) return false;
  const expected = hashDeletionOtp(userId, candidateOtp);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Looks up a Supabase Auth user by E.164 phone number (for unauthenticated /delete-account).
 * Paginates cleanly and never logs phone numbers.
 */
export async function findAuthUserByPhone(
  e164Phone: string,
): Promise<{ id: string; phone: string } | null> {
  const admin = createSupabaseAdminClient();
  const normalizedTarget = e164Phone.replace(/^\+/, "");

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error || !data?.users?.length) break;

    const match = data.users.find((u: { id: string; phone?: string | null }) => {
      const p = (u.phone ?? "").replace(/^\+/, "");
      return p === normalizedTarget;
    });

    if (match) {
      return { id: match.id, phone: match.phone ? `+${match.phone.replace(/^\+/, "")}` : e164Phone };
    }
    if (data.users.length < 200) break;
  }

  return null;
}

/**
 * Permanently erases a single scheduled user's personal data (DB rows, Storage files,
 * and Supabase Auth user), archives payments for 6 years, anonymises reviews,
 * records a non-PII deletion log, and sends an SMS confirmation message.
 * Idempotent.
 */
export async function purgeSingleDeletedUser(userId: string): Promise<{
  purged: boolean;
  storageFilesDeleted: number;
  paymentRecordsArchived: number;
  banRecordCreated: boolean;
  anonymousRefId: string;
}> {
  if (!isSupabaseAdminConfigured()) {
    throw new Error("Supabase admin credentials are required.");
  }

  const admin = createSupabaseAdminClient();

  // Fetch phone ONLY in memory to send final confirmation SMS after erasure (never logged!)
  const { data: userLookup } = await admin.auth.admin.getUserById(userId);
  const phoneForConfirmation = userLookup?.user?.phone
    ? `+${userLookup.user.phone.replace(/^\+/, "")}`
    : null;

  // Collect all storage paths to delete BEFORE erasing DB metadata
  const [{ data: artisanRow }, { data: verifRow }, { data: customerJobs }] =
    await Promise.all([
      admin
        .from("artisan_profiles")
        .select("photo_path")
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("artisan_verifications")
        .select("selfie_storage_path")
        .eq("user_id", userId)
        .maybeSingle(),
      admin.from("jobs").select("photo_paths").eq("customer_id", userId),
    ]);

  let storageFilesDeleted = 0;

  if (artisanRow?.photo_path) {
    const { error } = await admin.storage
      .from("artisan-photos")
      .remove([artisanRow.photo_path]);
    if (!error) storageFilesDeleted += 1;
  }

  if (verifRow?.selfie_storage_path) {
    const { error } = await admin.storage
      .from("artisan-verifications")
      .remove([verifRow.selfie_storage_path]);
    if (!error) storageFilesDeleted += 1;
  }

  const jobPhotoPaths: string[] = [];
  for (const job of customerJobs ?? []) {
    if (Array.isArray(job.photo_paths)) {
      for (const p of job.photo_paths as string[]) {
        if (p) jobPhotoPaths.push(p);
      }
    }
  }
  if (jobPhotoPaths.length > 0) {
    const { error } = await admin.storage.from("job-photos").remove(jobPhotoPaths);
    if (!error) storageFilesDeleted += jobPhotoPaths.length;
  }

  const anonymousRefId = `anon_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  // Execute atomic DB erasure, 6-year payment archiving, review anonymisation, and non-PII deletion log
  const { data: rpcRes, error: rpcErr } = await admin.rpc(
    "execute_user_data_erasure_db",
    {
      p_user_id: userId,
      p_anonymous_ref_id: anonymousRefId,
      p_storage_files_deleted: storageFilesDeleted,
    },
  );

  if (rpcErr) {
    logger.error("deletion.db_erasure_failed", { code: rpcErr.code });
    throw new Error("Could not erase user database records.");
  }

  const row = (Array.isArray(rpcRes) ? rpcRes[0] : rpcRes) as {
    payment_records_archived: number;
    ban_record_created: boolean;
  };

  // Permanently delete the Supabase Auth user (also cascades public.profiles + deletion_requests)
  const { error: authDelErr } = await admin.auth.admin.deleteUser(userId);
  if (authDelErr) {
    logger.error("deletion.auth_delete_failed", { status: authDelErr.status });
    throw new Error("Could not delete auth user record.");
  }

  // Send confirmation SMS when done (never logs phone or message text)
  if (phoneForConfirmation) {
    await sendNigerianSms({
      toE164: phoneForConfirmation,
      purpose: "account_deletion_complete",
      message:
        "Your Onise Owo account and personal data have been permanently erased as requested.",
    }).catch(() => {});
  }

  logger.info("deletion.purge_completed", {
    anonymousRefId,
    storageFilesDeleted,
    paymentRecordsArchived: Number(row?.payment_records_archived ?? 0),
    banRecordCreated: Boolean(row?.ban_record_created),
  });

  return {
    purged: true,
    storageFilesDeleted,
    paymentRecordsArchived: Number(row?.payment_records_archived ?? 0),
    banRecordCreated: Boolean(row?.ban_record_created),
    anonymousRefId,
  };
}

/**
 * Scheduled job helper: processes all deletion_requests whose 30-day window has elapsed.
 */
export async function processDueAccountDeletions(limit = 20): Promise<{
  processed: number;
  failed: number;
}> {
  if (!isSupabaseAdminConfigured()) {
    return { processed: 0, failed: 0 };
  }

  const admin = createSupabaseAdminClient();
  const nowUtc = new Date().toISOString();

  const { data: dueRows } = await admin
    .from("deletion_requests")
    .select("user_id")
    .eq("status", "scheduled")
    .lte("scheduled_purge_at", nowUtc)
    .order("scheduled_purge_at", { ascending: true })
    .limit(limit);

  let processed = 0;
  let failed = 0;

  for (const row of dueRows ?? []) {
    try {
      await purgeSingleDeletedUser(row.user_id);
      processed += 1;
    } catch {
      failed += 1;
    }
  }

  return { processed, failed };
}
