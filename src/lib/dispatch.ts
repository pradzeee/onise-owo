import { dispatchAlertWithSmsFallback } from "./alerts";
import { logger } from "./logger";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "./supabase/admin";

export interface RoundAdvanceResult {
  jobId: string;
  action: "next_round" | "expired";
  newRound: number;
  notifiedCount: number;
}

/**
 * Advances any expired nearest-3 dispatch rounds (60s per round, max 3 rounds)
 * and dispatches Web Push + 30s SMS backup alerts to newly invited artisans,
 * or notifies the customer when the job expires after 3 rounds.
 * Atomic & idempotent.
 */
export async function processDueJobDispatchRounds(
  specificJobId?: string,
): Promise<RoundAdvanceResult[]> {
  if (!isSupabaseAdminConfigured()) return [];

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("advance_due_job_rounds", {
    p_job_id: specificJobId ?? null,
  });

  if (error || !Array.isArray(data) || data.length === 0) {
    return [];
  }

  const results: RoundAdvanceResult[] = [];

  for (const row of data as {
    job_id: string;
    action: "next_round" | "expired";
    new_round: number;
    notified_artisan_ids: string[] | null;
    customer_id: string;
  }[]) {
    if (row.action === "next_round" && row.notified_artisan_ids?.length) {
      await Promise.all(
        row.notified_artisan_ids.map((artisanId) =>
          dispatchAlertWithSmsFallback({
            userId: artisanId,
            alertType: "job_request",
            title: "New nearby job request!",
            body: "A customer nearby needs your trade. Tap now to review and accept — first to accept wins.",
            url: `/jobs/${row.job_id}`,
            referenceId: row.job_id,
            idempotencyKey: `job_req:${row.job_id}:r${row.new_round}:${artisanId}`,
          }).catch((err) => {
            logger.warn("dispatch.artisan_alert_failed", {
              jobId: row.job_id,
              message: err instanceof Error ? err.message : "unknown",
            });
          }),
        ),
      );

      results.push({
        jobId: row.job_id,
        action: "next_round",
        newRound: row.new_round,
        notifiedCount: row.notified_artisan_ids.length,
      });
    } else if (row.action === "expired") {
      await dispatchAlertWithSmsFallback({
        userId: row.customer_id,
        alertType: "job_status",
        title: "No artisan accepted your request",
        body: "Your job request expired after 3 rounds. Open Oníṣẹ́ ọwọ́ to try again or pick another artisan.",
        url: `/jobs/${row.job_id}`,
        referenceId: row.job_id,
        idempotencyKey: `job_expired:${row.job_id}`,
      }).catch(() => {});

      results.push({
        jobId: row.job_id,
        action: "expired",
        newRound: row.new_round,
        notifiedCount: 0,
      });
    }
  }

  return results;
}
