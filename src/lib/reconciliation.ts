import { APP_TIMEZONE } from "./constants";
import { logger } from "./logger";
import {
  compareReconciliationRecords,
  type ReconciliationSummary,
} from "./payments";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "./supabase/admin";

/**
 * Returns YYYY-MM-DD in Africa/Lagos timezone.
 */
export function getLagosDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/**
 * Runs daily reconciliation comparing our paid records for `reportDate` (Africa/Lagos day)
 * against Paystack's settled transactions, storing the result in reconciliation_reports.
 * Idempotent (upserts by report_date).
 */
export async function runDailyPaymentReconciliation(
  targetDate?: string,
): Promise<ReconciliationSummary> {
  if (!isSupabaseAdminConfigured()) {
    throw new Error("Supabase admin credentials are not configured.");
  }

  const reportDate =
    targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)
      ? targetDate
      : getLagosDateString();

  // Africa/Lagos is UTC+1 (no DST)
  const dayStartUtc = new Date(`${reportDate}T00:00:00+01:00`).toISOString();
  const dayEndUtc = new Date(`${reportDate}T23:59:59.999+01:00`).toISOString();

  const admin = createSupabaseAdminClient();
  const { data: ourRows, error: dbErr } = await admin
    .from("payments")
    .select("provider_reference, amount_kobo, commission_kobo")
    .eq("status", "paid")
    .gte("paid_at", dayStartUtc)
    .lte("paid_at", dayEndUtc);

  if (dbErr) {
    throw new Error("Could not load local payment records for reconciliation.");
  }

  const localPaid = (ourRows ?? []) as {
    provider_reference: string;
    amount_kobo: number;
    commission_kobo: number;
  }[];

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  let summary: ReconciliationSummary;

  if (!secretKey) {
    // Dev mock mode when Paystack secret isn't configured yet
    const ourTotal = localPaid.reduce((acc, r) => acc + Number(r.amount_kobo), 0);
    const ourComm = localPaid.reduce((acc, r) => acc + Number(r.commission_kobo), 0);
    summary = {
      reportDate,
      ourPaidCount: localPaid.length,
      ourPaidTotalKobo: ourTotal,
      ourCommissionTotalKobo: ourComm,
      paystackPaidCount: 0,
      paystackPaidTotalKobo: 0,
      missingInOurDbRefs: [],
      missingInPaystackRefs: [],
      amountMismatchRefs: [],
      status: "skipped_mock",
    };
  } else {
    const paystackRows: { reference: string; amount: number }[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 10) {
      const url = new URL("https://api.paystack.co/transaction");
      url.searchParams.set("status", "success");
      url.searchParams.set("from", dayStartUtc);
      url.searchParams.set("to", dayEndUtc);
      url.searchParams.set("perPage", "100");
      url.searchParams.set("page", String(page));

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${secretKey}` },
      });

      if (!res.ok) {
        throw new Error(`Paystack reconciliation API returned HTTP ${res.status}`);
      }

      const json = (await res.json()) as {
        data?: { reference: string; amount: number }[];
        meta?: { pageCount?: number };
      };

      const batch = json.data ?? [];
      for (const item of batch) {
        if (item.reference && Number.isFinite(item.amount)) {
          paystackRows.push({ reference: item.reference, amount: Number(item.amount) });
        }
      }

      const pageCount = Number(json.meta?.pageCount ?? 1);
      hasMore = page < pageCount && batch.length > 0;
      page += 1;
    }

    summary = compareReconciliationRecords(reportDate, localPaid, paystackRows);
  }

  const nowUtc = new Date().toISOString();
  await admin.from("reconciliation_reports").upsert(
    {
      report_date: summary.reportDate,
      our_paid_count: summary.ourPaidCount,
      our_paid_total_kobo: summary.ourPaidTotalKobo,
      our_commission_total_kobo: summary.ourCommissionTotalKobo,
      paystack_paid_count: summary.paystackPaidCount,
      paystack_paid_total_kobo: summary.paystackPaidTotalKobo,
      missing_in_our_db_refs: summary.missingInOurDbRefs,
      missing_in_paystack_refs: summary.missingInPaystackRefs,
      amount_mismatch_refs: summary.amountMismatchRefs,
      status: summary.status,
      updated_at: nowUtc,
    },
    { onConflict: "report_date" },
  );

  logger.info("payments.reconciled", {
    reportDate: summary.reportDate,
    status: summary.status,
    ourPaidCount: summary.ourPaidCount,
    paystackPaidCount: summary.paystackPaidCount,
  });

  return summary;
}
