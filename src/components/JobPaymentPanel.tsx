"use client";

import { useState } from "react";
import {
  AlertOctagon,
  CheckCircle2,
  CreditCard,
  ShieldCheck,
} from "lucide-react";
import {
  DISPUTE_REASONS,
  type DisputeReason,
  type DisputeRecord,
  type JobRecord,
  type PaymentRecord,
} from "@/lib/constants";
import { formatKoboAsNaira } from "@/lib/money";
import { formatLagosDateTime } from "@/lib/time";

interface JobPaymentPanelProps {
  job: JobRecord;
  viewerRole: "customer" | "artisan" | "invited_artisan";
  payment: PaymentRecord | null;
  dispute: DisputeRecord | null;
  onUpdated: () => Promise<void>;
}

export function JobPaymentPanel({
  job,
  viewerRole,
  payment,
  dispute,
  onUpdated,
}: JobPaymentPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showDispute, setShowDispute] = useState(false);
  const [disputeReason, setDisputeReason] = useState<DisputeReason>("incomplete_work");
  const [disputeDetails, setDisputeDetails] = useState("");

  if (viewerRole === "invited_artisan") return null;

  const showSection =
    ["in_progress", "completed", "paid", "confirmed", "disputed", "refunded"].includes(
      job.status,
    ) || Boolean(payment || dispute);

  if (!showSection) return null;

  const hasOpenDispute = dispute?.status === "open";
  const isPaid = payment?.status === "paid";

  const canPay =
    viewerRole === "customer" &&
    job.status === "completed" &&
    !isPaid &&
    !hasOpenDispute;

  const canConfirm =
    viewerRole === "customer" &&
    job.status === "paid" &&
    isPaid &&
    !hasOpenDispute;

  const canOpenDispute =
    !hasOpenDispute &&
    ["in_progress", "completed", "paid"].includes(job.status);

  async function handleStartPayment() {
    if (busy) return;
    setBusy("pay");
    setError(null);
    setNotice(null);

    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/pay`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        authorizationUrl?: string;
        reference?: string;
        isMock?: boolean;
      };

      if (!res.ok || !data.authorizationUrl) {
        setError(data.error ?? "Could not initialize Paystack payment.");
        return;
      }

      if (data.isMock) {
        setNotice(
          `Dev mock checkout created (Ref: ${data.reference}). In production you are redirected to Paystack — payment is NEVER marked paid by the browser; trigger the signed webhook /api/webhooks/paystack to mark it paid.`,
        );
        await onUpdated();
        return;
      }

      // Redirect browser to Paystack hosted checkout (never stores card details)
      window.location.href = data.authorizationUrl;
    } catch {
      setError("Network error starting Paystack payment.");
    } finally {
      setBusy(null);
    }
  }

  async function handleConfirmJob() {
    if (busy) return;
    setBusy("confirm");
    setError(null);
    setNotice(null);

    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/confirm`, {
        method: "POST",
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not confirm job.");
        return;
      }
      setNotice("Job confirmed! Thank you for using Oníṣẹ́ ọwọ́.");
      await onUpdated();
    } catch {
      setError("Network error confirming job.");
    } finally {
      setBusy(null);
    }
  }

  async function handleOpenDispute(e: React.FormEvent) {
    e.preventDefault();
    if (busy || disputeDetails.trim().length < 10) return;
    setBusy("dispute");
    setError(null);
    setNotice(null);

    try {
      const idemKey = `disp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const res = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/dispute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": idemKey,
        },
        body: JSON.stringify({
          reason: disputeReason,
          details: disputeDetails.trim(),
          idempotencyKey: idemKey,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not open dispute.");
        return;
      }
      setShowDispute(false);
      setDisputeDetails("");
      setNotice("Dispute opened. Payout release and 24-hour auto-confirmation are paused.");
      await onUpdated();
    } catch {
      setError("Network error opening dispute.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
          <CreditCard className="h-4 w-4 text-[#0B6E4F]" />
          Payment &amp; Completion (Pay After Job)
        </h2>
        {payment ? (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${
              payment.status === "paid"
                ? "bg-emerald-100 text-emerald-800"
                : payment.status === "amount_mismatch" || payment.status === "failed"
                  ? "bg-red-100 text-red-800"
                  : "bg-amber-100 text-amber-800"
            }`}
          >
            Payment: {payment.status.replace("_", " ")}
          </span>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700"
        >
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-[#EBF7F2] px-3.5 py-2.5 text-xs text-[#08523B]">
          {notice}
        </div>
      ) : null}

      {/* Payment record summary (never card details) */}
      {payment ? (
        <dl className="grid gap-3 rounded-xl bg-gray-50 p-3.5 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-gray-500">Total Amount</dt>
            <dd className="mt-0.5 font-bold text-gray-900">
              {formatKoboAsNaira(payment.amount_kobo)}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Platform Fee (15%)</dt>
            <dd className="mt-0.5 font-semibold text-gray-800">
              {formatKoboAsNaira(payment.commission_kobo)}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Paystack Ref / Refund</dt>
            <dd className="mt-0.5 font-mono text-[11px] text-gray-700 break-all">
              {payment.provider_reference} ({payment.refund_status})
            </dd>
          </div>
          {payment.paid_at ? (
            <div className="sm:col-span-3 text-[11px] text-[#08523B]">
              Verified by Paystack webhook at {formatLagosDateTime(payment.paid_at)}
              {payment.release_paused ? " • Release paused due to dispute" : ""}
            </div>
          ) : null}
        </dl>
      ) : null}

      {/* Open Dispute Banner */}
      {dispute ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-900">
          <p className="flex items-center gap-1.5 font-bold">
            <AlertOctagon className="h-4 w-4 shrink-0" />
            Dispute ({dispute.status.replace("_", " ")}) —{" "}
            {dispute.reason.replace("_", " ")}
          </p>
          <p className="mt-1">{dispute.details}</p>
          {dispute.status === "open" ? (
            <p className="mt-1.5 text-[11px] font-semibold">
              Payout release and 24-hour auto-confirmation are paused until an admin
              resolves this dispute.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Customer Paystack Checkout CTA (after job completion) */}
      {canPay && job.accepted_amount_kobo ? (
        <div className="space-y-2.5">
          <p className="text-xs text-gray-600">
            The artisan marked this job completed. Inspect the work, then pay the agreed{" "}
            <strong>{formatKoboAsNaira(job.accepted_amount_kobo)}</strong> securely via
            Paystack (we never store card details).
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={handleStartPayment}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0B6E4F] px-4 py-3 text-sm font-bold text-white hover:bg-[#08523B] disabled:opacity-50"
          >
            <CreditCard className="h-4 w-4" />
            {busy === "pay"
              ? "Starting Paystack checkout..."
              : `Pay ${formatKoboAsNaira(job.accepted_amount_kobo)} with Paystack`}
          </button>
        </div>
      ) : null}

      {/* Pending webhook confirmation notice */}
      {payment?.status === "pending" && !isPaid ? (
        <p className="flex items-center gap-1.5 text-xs text-amber-800">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          Waiting for verified Paystack webhook confirmation. We never mark a job paid
          from the browser redirect alone.
        </p>
      ) : null}

      {/* Customer Confirm Job Done (or 24h auto-confirm) */}
      {canConfirm ? (
        <div className="space-y-2.5">
          <p className="text-xs text-gray-600">
            Payment verified! Tap below to confirm the job is satisfactorily finished (or
            it will auto-confirm 24 hours after completion if no dispute is opened).
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={handleConfirmJob}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0B6E4F] px-4 py-3 text-sm font-bold text-white hover:bg-[#08523B] disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            {busy === "confirm" ? "Confirming..." : "Confirm Job Completed"}
          </button>
        </div>
      ) : null}

      {/* Confirmed badge */}
      {job.status === "confirmed" ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-[#EBF7F2] p-3 text-xs font-semibold text-[#08523B]">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            Job confirmed at {formatLagosDateTime(job.confirmed_at)}. You can now leave a
            1–5 star rating below.
          </span>
        </div>
      ) : null}

      {/* Open Dispute button & form */}
      {canOpenDispute ? (
        <div className="border-t border-gray-100 pt-3">
          {!showDispute ? (
            <button
              type="button"
              onClick={() => setShowDispute(true)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
            >
              <AlertOctagon className="h-3.5 w-3.5" />
              Open a dispute
            </button>
          ) : (
            <form
              onSubmit={handleOpenDispute}
              className="space-y-3 rounded-xl border border-red-200 bg-red-50/50 p-4 text-xs"
            >
              <p className="font-bold text-red-900">
                Open a Dispute (pauses payout release &amp; 24h auto-confirm)
              </p>
              <select
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value as DisputeReason)}
                className="min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-xs"
              >
                {DISPUTE_REASONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <textarea
                rows={3}
                required
                maxLength={1000}
                value={disputeDetails}
                onChange={(e) => setDisputeDetails(e.target.value)}
                placeholder="Explain the issue clearly (at least 10 characters)..."
                className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-xs"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy !== null || disputeDetails.trim().length < 10}
                  className="min-h-10 rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {busy === "dispute" ? "Submitting..." : "Submit Dispute"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDispute(false)}
                  className="min-h-10 rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-700"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      ) : null}
    </section>
  );
}
