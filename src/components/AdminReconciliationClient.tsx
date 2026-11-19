"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";
import type { ReconciliationReportRecord } from "@/lib/constants";
import { formatKoboAsNaira } from "@/lib/money";
import { formatLagosDateTime } from "@/lib/time";

interface AdminReconciliationClientProps {
  reports: ReconciliationReportRecord[];
  defaultDate: string;
}

export function AdminReconciliationClient({
  reports,
  defaultDate,
}: AdminReconciliationClientProps) {
  const router = useRouter();
  const [reportDate, setReportDate] = useState(defaultDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleRunReconciliation() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/cron/reconcile-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportDate }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        summary?: { status: string; reportDate: string };
      };
      if (!res.ok) {
        setError(json.error ?? "Reconciliation failed.");
        return;
      }
      setNotice(
        `Reconciliation for ${json.summary?.reportDate} completed with status: ${json.summary?.status}.`,
      );
      router.refresh();
    } catch {
      setError("Network error running reconciliation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div>
          <label htmlFor="rec-date" className="mb-1 block text-xs font-semibold text-gray-700">
            Africa/Lagos Report Date
          </label>
          <input
            id="rec-date"
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            className="min-h-11 rounded-xl border border-gray-300 px-3 text-sm"
          />
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={handleRunReconciliation}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#0B6E4F] px-4 py-2 text-xs font-bold text-white hover:bg-[#08523B] disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Reconciling with Paystack..." : "Run Daily Reconciliation"}
        </button>
      </section>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-[#EBF7F2] px-4 py-3 text-xs text-[#08523B]">
          {notice}
        </div>
      ) : null}

      <section className="space-y-3">
        {reports.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            No daily reconciliation reports generated yet.
          </div>
        ) : (
          reports.map((r) => (
            <article
              key={r.id}
              className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-gray-900">
                    Date: {r.report_date} (WAT)
                  </h2>
                  <p className="text-xs text-gray-500">
                    Updated {formatLagosDateTime(r.updated_at)}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold capitalize ${
                    r.status === "matched"
                      ? "bg-emerald-100 text-emerald-800"
                      : r.status === "discrepancy"
                        ? "bg-red-100 text-red-800"
                        : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {r.status === "matched" ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <ShieldAlert className="h-3.5 w-3.5" />
                  )}
                  {r.status.replace("_", " ")}
                </span>
              </div>

              <dl className="grid gap-3 rounded-xl bg-gray-50 p-3.5 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-gray-500">Our DB Paid</dt>
                  <dd className="mt-0.5 font-bold text-gray-900">
                    {r.our_paid_count} txns • {formatKoboAsNaira(Number(r.our_paid_total_kobo))}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Platform Commission (15%)</dt>
                  <dd className="mt-0.5 font-bold text-gray-900">
                    {formatKoboAsNaira(Number(r.our_commission_total_kobo))}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Paystack Settled</dt>
                  <dd className="mt-0.5 font-bold text-gray-900">
                    {r.paystack_paid_count} txns •{" "}
                    {formatKoboAsNaira(Number(r.paystack_paid_total_kobo))}
                  </dd>
                </div>
              </dl>

              {r.status === "discrepancy" ? (
                <div className="space-y-1 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                  {r.missing_in_our_db_refs.length > 0 ? (
                    <p>
                      <strong>Missing in our DB:</strong>{" "}
                      {r.missing_in_our_db_refs.join(", ")}
                    </p>
                  ) : null}
                  {r.missing_in_paystack_refs.length > 0 ? (
                    <p>
                      <strong>Missing in Paystack:</strong>{" "}
                      {r.missing_in_paystack_refs.join(", ")}
                    </p>
                  ) : null}
                  {r.amount_mismatch_refs.length > 0 ? (
                    <p>
                      <strong>Amount mismatches:</strong>{" "}
                      {r.amount_mismatch_refs.join(", ")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
