"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  KeyRound,
  MapPin,
  PhoneCall,
  RefreshCw,
  Share2,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type {
  DisputeRecord,
  JobRecord,
  JobRequestRecord,
  PaymentRecord,
  QuoteRecord,
  ReviewRecord,
} from "@/lib/constants";
import { formatKoboAsNaira } from "@/lib/money";
import { formatLagosDateTime } from "@/lib/time";
import { JobChatPanel } from "./JobChatPanel";
import { JobPaymentPanel } from "./JobPaymentPanel";
import { JobRatingPanel } from "./JobRatingPanel";

interface JobPayload {
  viewerRole: "customer" | "artisan" | "invited_artisan";
  job: JobRecord;
  exactAddress: { exact_address: string; exact_lat: number; exact_lng: number } | null;
  requests: JobRequestRecord[];
  quotes: QuoteRecord[];
  payment: PaymentRecord | null;
  dispute: DisputeRecord | null;
  reviews: ReviewRecord[];
  photoUrls: string[];
  customerStartCode: string | null;
  artisanSummary: { full_name: string; trade: string; work_area: string } | null;
}

const STATUS_LABELS: Record<string, string> = {
  requested: "Finding verified artisan",
  accepted: "Accepted — awaiting quote",
  quoted: "Quote sent — awaiting customer",
  quote_accepted: "Quote accepted — ready to go",
  paid: "Paid",
  en_route: "Artisan en route",
  arrived: "Artisan arrived — enter start code",
  in_progress: "Work in progress",
  completed: "Completed",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  expired: "Expired (no artisan accepted)",
  disputed: "Disputed",
  refunded: "Refunded",
};

export function JobDetailClient({ jobId }: { jobId: string }) {
  const [data, setData] = useState<JobPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Quote inputs (artisan)
  const [quoteNaira, setQuoteNaira] = useState("");
  const [quoteNotes, setQuoteNotes] = useState("");

  // Start code input (artisan on arrival)
  const [startCodeInput, setStartCodeInput] = useState("");

  // Cancel confirmation state
  const [showCancelBox, setShowCancelBox] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  // Share & SOS modals
  const [shareResult, setShareResult] = useState<{
    shareUrl: string;
    smsSentTo: string | null;
  } | null>(null);
  const [sosModal, setSosModal] = useState<{
    emergencyNumber: string;
    trustedContactPhone: string | null;
    trustedContactName: string | null;
    alertedTrustedContact: boolean;
  } | null>(null);

  const [secondsToRoundEnd, setSecondsToRoundEnd] = useState<number | null>(null);

  const loadJob = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as JobPayload & { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not load job.");
        return;
      }
      setData(json);
    } catch {
      setError("Network error loading job.");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    loadJob();
  }, [loadJob]);

  // Countdown & auto-refresh when job is in 'requested' wave dispatch
  useEffect(() => {
    if (!data || data.job.status !== "requested" || !data.job.round_expires_at) {
      setSecondsToRoundEnd(null);
      return;
    }

    const updateCountdown = () => {
      const diff = Math.ceil(
        (new Date(data.job.round_expires_at!).getTime() - Date.now()) / 1000,
      );
      setSecondsToRoundEnd(Math.max(0, diff));
      if (diff <= 0) {
        loadJob();
      }
    };

    updateCountdown();
    const t = setInterval(updateCountdown, 2000);
    return () => clearInterval(t);
  }, [data, loadJob]);

  async function runAction(
    label: string,
    url: string,
    body?: Record<string, unknown>,
    onSuccess?: (json: Record<string, unknown>) => void,
  ) {
    if (busy) return;
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError(String(json.error ?? "Action failed."));
        return;
      }
      onSuccess?.(json);
      await loadJob();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        Loading job details...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
        {error ?? "Job not found."}
      </div>
    );
  }

  const {
    viewerRole,
    job,
    exactAddress,
    requests,
    quotes,
    payment,
    dispute,
    reviews,
    photoUrls,
    customerStartCode,
    artisanSummary,
  } = data;

  const myRequest = requests[0];
  const pendingQuote = quotes.find((q) => q.status === "pending");
  const isActiveJob = ![
    "completed",
    "confirmed",
    "cancelled",
    "expired",
    "refunded",
  ].includes(job.status);

  const canCancel =
    (viewerRole === "customer" || viewerRole === "artisan") &&
    [
      "requested",
      "accepted",
      "quoted",
      "quote_accepted",
      "en_route",
      "arrived",
    ].includes(job.status);

  const estimatedCustomerCancelFeeKobo =
    viewerRole === "customer" &&
    (job.status === "en_route" || job.status === "arrived")
      ? Math.min(Math.max(Math.floor((job.accepted_amount_kobo ?? 0) / 10), 100_000), 500_000)
      : 0;

  return (
    <div className="space-y-5">
      {/* Header status card */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="inline-block rounded-full bg-[#EBF7F2] px-2.5 py-0.5 text-xs font-bold capitalize text-[#08523B]">
              {job.trade.replace("_", " ")}
            </span>
            <h1 className="mt-1.5 text-xl font-extrabold text-gray-900">
              {STATUS_LABELS[job.status] ?? job.status}
            </h1>
            <p className="mt-0.5 text-xs text-gray-500">
              Created {formatLagosDateTime(job.created_at)} • Area: {job.approx_area_label}
            </p>
          </div>
          <button
            type="button"
            onClick={() => loadJob()}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-gray-800">{job.description}</p>

        {/* Wave dispatch status */}
        {job.status === "requested" ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
            <Clock className="h-4 w-4 shrink-0 text-amber-700" />
            <span>
              {job.dispatch_mode === "nearest_3"
                ? `Nearest-3 dispatch: Round ${job.dispatch_round} of 3`
                : "Direct artisan request"}{" "}
              {secondsToRoundEnd !== null ? `• ${secondsToRoundEnd}s remaining in this round` : ""}
            </span>
          </div>
        ) : null}

        {job.status === "expired" ? (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-800">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              No artisan accepted after {job.dispatch_round} round(s), so this request
              expired. Please create a new request or try another area.
            </p>
          </div>
        ) : null}

        {job.status === "cancelled" ? (
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3.5 text-xs text-gray-700">
            <strong>Job cancelled</strong> at {formatLagosDateTime(job.cancelled_at)}.
            {job.cancel_fee_kobo > 0 ? (
              <span className="ml-1 font-semibold text-red-700">
                Cancellation fee applied: {formatKoboAsNaira(job.cancel_fee_kobo)}.
              </span>
            ) : (
              <span className="ml-1">No cancellation fee.</span>
            )}
          </div>
        ) : null}

        {/* Job Photos */}
        {photoUrls.length > 0 ? (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {photoUrls.map((url, idx) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={idx}
                src={url}
                alt={`Job photo ${idx + 1}`}
                className="h-24 w-full rounded-xl border border-gray-200 object-cover sm:h-32"
              />
            ))}
          </div>
        ) : null}
      </section>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-[#EBF7F2] px-4 py-3 text-sm text-[#08523B]">
          {notice}
        </div>
      ) : null}

      {/* Invited Artisan Accept/Decline Card */}
      {viewerRole === "invited_artisan" ? (
        <section className="rounded-2xl border-2 border-[#0B6E4F] bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold text-gray-900">Incoming Job Request</h2>
          <p className="mt-1 text-xs text-gray-600">
            General area: <strong>{job.approx_area_label}</strong>. The exact street
            address is revealed immediately after you accept. First artisan to accept wins!
          </p>

          {myRequest?.status === "taken" ? (
            <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">
              This job has already been taken by another artisan.
            </div>
          ) : myRequest?.status === "declined" || myRequest?.status === "expired" ? (
            <div className="mt-3 rounded-xl bg-gray-100 p-3 text-sm text-gray-700 capitalize">
              Request status: <strong>{myRequest.status}</strong>.
            </div>
          ) : job.status === "requested" ? (
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  runAction("accept", `/api/jobs/${job.id}/accept`, {}, (json) => {
                    if (json.won) {
                      setNotice("You won the job! Exact address is now unlocked below.");
                    } else {
                      setNotice("Another artisan accepted this job first — marked as taken.");
                    }
                  })
                }
                className="flex min-h-12 flex-1 items-center justify-center rounded-xl bg-[#0B6E4F] px-4 py-3 text-sm font-bold text-white hover:bg-[#08523B] disabled:opacity-50"
              >
                {busy === "accept" ? "Accepting..." : "Accept Job Now"}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  runAction("decline", `/api/jobs/${job.id}/decline`, {}, () => {
                    setNotice("Request declined.");
                  })
                }
                className="min-h-12 rounded-xl border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Exact Address (ONLY visible to customer OR accepted artisan!) */}
      {exactAddress ? (
        <section className="rounded-2xl border border-emerald-200 bg-[#EBF7F2]/60 p-4">
          <div className="flex items-start gap-2.5">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#0B6E4F]" />
            <div className="text-xs">
              <p className="font-bold text-[#08523B]">
                Exact Job Address{" "}
                {viewerRole === "customer" && !job.artisan_id
                  ? "(Hidden from artisans until accepted)"
                  : "(Unlocked after acceptance)"}
              </p>
              <p className="mt-1 text-sm font-semibold text-gray-900">
                {exactAddress.exact_address}
              </p>
              {artisanSummary ? (
                <p className="mt-1 text-xs text-gray-600">
                  Assigned verified artisan: <strong>{artisanSummary.full_name}</strong> (
                  {artisanSummary.work_area})
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {/* 4-Digit Start Code: Customer sees code; Artisan enters on arrival */}
      {viewerRole === "customer" && customerStartCode && isActiveJob ? (
        <section className="rounded-2xl border-2 border-[#0B6E4F] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[#0B6E4F]">
                4-Digit Start Code
              </p>
              <p className="mt-1 text-xs text-gray-600">
                Give this code to your artisan <strong>only when they arrive</strong> so
                they can start the job.
              </p>
            </div>
            <div className="rounded-xl bg-[#EBF7F2] px-4 py-2.5 font-mono text-2xl font-extrabold tracking-[0.25em] text-[#08523B]">
              {customerStartCode}
            </div>
          </div>
        </section>
      ) : null}

      {viewerRole === "artisan" && job.status === "arrived" ? (
        <section className="rounded-2xl border-2 border-[#0B6E4F] bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
            <KeyRound className="h-4 w-4 text-[#0B6E4F]" />
            Enter Customer&apos;s 4-Digit Start Code
          </h2>
          <p className="mt-1 text-xs text-gray-600">
            Ask the customer for the 4-digit code shown on their screen to start work.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runAction(
                "start",
                `/api/jobs/${job.id}/start`,
                { code: startCodeInput },
                () => {
                  setStartCodeInput("");
                  setNotice("Start code verified! Job is now in progress.");
                },
              );
            }}
            className="mt-3 flex gap-2"
          >
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              required
              value={startCodeInput}
              onChange={(e) =>
                setStartCodeInput(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              placeholder="1234"
              className="min-h-12 w-36 rounded-xl border border-gray-300 text-center font-mono text-xl font-bold tracking-[0.3em]"
            />
            <button
              type="submit"
              disabled={busy !== null || startCodeInput.length !== 4}
              className="min-h-12 flex-1 rounded-xl bg-[#0B6E4F] px-4 text-sm font-bold text-white hover:bg-[#08523B] disabled:opacity-50"
            >
              {busy === "start" ? "Checking..." : "Verify & Start Job"}
            </button>
          </form>
        </section>
      ) : null}

      {/* Quotes Section */}
      {(viewerRole === "customer" || viewerRole === "artisan") && job.artisan_id ? (
        <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900">Quotes (Nigerian Naira)</h2>
            {job.accepted_amount_kobo ? (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                Agreed: {formatKoboAsNaira(job.accepted_amount_kobo)}
              </span>
            ) : null}
          </div>

          {/* Customer accepts/declines pending quote */}
          {viewerRole === "customer" && pendingQuote ? (
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50/70 p-4">
              <p className="text-xs font-semibold text-amber-900">
                Pending quote from artisan:
              </p>
              <p className="mt-1 text-2xl font-extrabold text-gray-900">
                {formatKoboAsNaira(pendingQuote.amount_kobo)}
              </p>
              {pendingQuote.notes ? (
                <p className="mt-1 text-xs text-gray-700">{pendingQuote.notes}</p>
              ) : null}
              <div className="mt-3 flex gap-2.5">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    runAction(
                      "accept-quote",
                      `/api/quotes/${pendingQuote.id}/respond`,
                      { accept: true },
                      () => setNotice("Quote accepted! Your artisan can now head over."),
                    )
                  }
                  className="min-h-11 flex-1 rounded-xl bg-[#0B6E4F] px-4 text-xs font-bold text-white hover:bg-[#08523B] disabled:opacity-50"
                >
                  Accept Quote
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    runAction(
                      "decline-quote",
                      `/api/quotes/${pendingQuote.id}/respond`,
                      { accept: false },
                      () => setNotice("Quote declined. The artisan can send a revised quote."),
                    )
                  }
                  className="min-h-11 rounded-xl border border-gray-300 bg-white px-4 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Decline
                </button>
              </div>
            </div>
          ) : null}

          {/* Artisan sends or updates quote (changed price needs a new quote!) */}
          {viewerRole === "artisan" &&
          ["accepted", "quoted", "quote_accepted"].includes(job.status) ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                runAction(
                  "quote",
                  `/api/jobs/${job.id}/quotes`,
                  {
                    amountNaira: quoteNaira,
                    notes: quoteNotes || undefined,
                  },
                  () => {
                    setQuoteNaira("");
                    setQuoteNotes("");
                    setNotice("Quote sent to customer for approval.");
                  },
                );
              }}
              className="space-y-3 rounded-xl bg-gray-50 p-4"
            >
              <p className="text-xs font-semibold text-gray-800">
                {quotes.length > 0
                  ? "Need to change the price? Send a new quote (replaces the old one and requires customer acceptance)."
                  : "Send your quote in Naira:"}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={quoteNaira}
                  onChange={(e) => setQuoteNaira(e.target.value)}
                  placeholder="Amount in Naira (e.g. 15000)"
                  className="min-h-11 rounded-xl border border-gray-300 bg-white px-3 text-sm font-semibold"
                />
                <input
                  type="text"
                  maxLength={500}
                  value={quoteNotes}
                  onChange={(e) => setQuoteNotes(e.target.value)}
                  placeholder="Optional breakdown (parts, labour)"
                  className="min-h-11 rounded-xl border border-gray-300 bg-white px-3 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={busy !== null || !quoteNaira.trim()}
                className="min-h-11 w-full rounded-xl bg-[#0B6E4F] px-4 text-xs font-bold text-white hover:bg-[#08523B] disabled:opacity-50 sm:w-auto"
              >
                {busy === "quote" ? "Sending quote..." : "Send Quote"}
              </button>
            </form>
          ) : null}

          {/* Quote History */}
          {quotes.length > 0 ? (
            <ul className="divide-y divide-gray-100 text-xs">
              {quotes.map((q) => (
                <li key={q.id} className="flex items-center justify-between py-2">
                  <div>
                    <span className="font-bold text-gray-900">
                      {formatKoboAsNaira(q.amount_kobo)}
                    </span>
                    {q.notes ? <span className="ml-2 text-gray-600">{q.notes}</span> : null}
                  </div>
                  <span className="rounded bg-gray-100 px-2 py-0.5 font-semibold capitalize text-gray-700">
                    {q.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-500">No quotes sent yet.</p>
          )}
        </section>
      ) : null}

      {/* Artisan Job Progress Controls */}
      {viewerRole === "artisan" &&
      ["quote_accepted", "paid", "en_route", "in_progress"].includes(job.status) ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-gray-900">Update Job Progress</h2>
          <div className="mt-3 flex flex-wrap gap-3">
            {job.status === "quote_accepted" || job.status === "paid" ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  runAction(
                    "en_route",
                    `/api/jobs/${job.id}/status`,
                    { nextStatus: "en_route" },
                    () => setNotice("Marked as En Route. Customer notified."),
                  )
                }
                className="min-h-12 flex-1 rounded-xl bg-[#0B6E4F] px-4 text-sm font-bold text-white hover:bg-[#08523B]"
              >
                I&apos;m En Route
              </button>
            ) : null}

            {job.status === "en_route" ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  runAction(
                    "arrived",
                    `/api/jobs/${job.id}/status`,
                    { nextStatus: "arrived" },
                    () =>
                      setNotice(
                        "Marked as Arrived. Ask the customer for their 4-digit start code.",
                      ),
                  )
                }
                className="min-h-12 flex-1 rounded-xl bg-[#0B6E4F] px-4 text-sm font-bold text-white hover:bg-[#08523B]"
              >
                I Have Arrived
              </button>
            ) : null}

            {job.status === "in_progress" ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  runAction(
                    "completed",
                    `/api/jobs/${job.id}/status`,
                    { nextStatus: "completed" },
                    () => setNotice("Job marked Completed!"),
                  )
                }
                className="min-h-12 flex-1 rounded-xl bg-[#0B6E4F] px-4 text-sm font-bold text-white hover:bg-[#08523B]"
              >
                Mark Job Completed
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Safety Bar: Share Job, SOS, and Cancel (with Terms cancel fee rule) */}
      {(viewerRole === "customer" || viewerRole === "artisan") && isActiveJob ? (
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap gap-2.5">
            {viewerRole === "customer" ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  runAction("share", `/api/jobs/${job.id}/share`, {}, (json) => {
                    setShareResult({
                      shareUrl: String(json.shareUrl ?? ""),
                      smsSentTo: json.smsSentTo ? String(json.smsSentTo) : null,
                    });
                  })
                }
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-xs font-bold text-gray-800 hover:bg-gray-50"
              >
                <Share2 className="h-4 w-4 text-[#0B6E4F]" />
                Share job
              </button>
            ) : null}

            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                runAction("sos", `/api/jobs/${job.id}/sos`, {}, (json) => {
                  setSosModal({
                    emergencyNumber: String(json.emergencyNumber ?? "112"),
                    trustedContactPhone: json.trustedContactPhone
                      ? String(json.trustedContactPhone)
                      : null,
                    trustedContactName: json.trustedContactName
                      ? String(json.trustedContactName)
                      : null,
                    alertedTrustedContact: Boolean(json.alertedTrustedContact),
                  });
                })
              }
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-red-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-red-700"
            >
              <AlertTriangle className="h-4 w-4" />
              SOS Emergency
            </button>

            {canCancel ? (
              <button
                type="button"
                onClick={() => setShowCancelBox((v) => !v)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
              >
                Cancel job
              </button>
            ) : null}
          </div>

          {shareResult ? (
            <div className="rounded-xl border border-emerald-200 bg-[#EBF7F2] p-3.5 text-xs text-[#08523B]">
              <p className="font-bold flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                Live safety tracking link created
              </p>
              {shareResult.smsSentTo ? (
                <p className="mt-1">SMS link sent to {shareResult.smsSentTo}.</p>
              ) : (
                <p className="mt-1">
                  Save a Trusted Contact on your dashboard to auto-send SMS next time.
                </p>
              )}
              <a
                href={shareResult.shareUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 block break-all font-mono underline"
              >
                {shareResult.shareUrl}
              </a>
            </div>
          ) : null}

          {sosModal ? (
            <div className="space-y-3 rounded-xl border-2 border-red-400 bg-red-50 p-4 text-xs text-red-950">
              <p className="flex items-center gap-1.5 text-sm font-extrabold text-red-800">
                <ShieldAlert className="h-4 w-4" />
                Emergency SOS Actions
              </p>
              <p>
                {sosModal.alertedTrustedContact
                  ? `An urgent SOS SMS has been sent to ${sosModal.trustedContactName}.`
                  : "Call Nigeria Emergency 112 immediately if you are in danger."}
              </p>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`tel:${sosModal.emergencyNumber}`}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-red-700 px-4 py-2 text-xs font-bold text-white"
                >
                  <PhoneCall className="h-4 w-4" />
                  Call 112 Now
                </a>
                {sosModal.trustedContactPhone ? (
                  <a
                    href={`tel:${sosModal.trustedContactPhone}`}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-800"
                  >
                    <PhoneCall className="h-4 w-4" />
                    Call {sosModal.trustedContactName ?? "Trusted Contact"}
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}

          {showCancelBox && canCancel ? (
            <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/50 p-4 text-xs">
              <p className="font-bold text-gray-900">
                {estimatedCustomerCancelFeeKobo > 0
                  ? `Cancellation fee notice: Because the artisan is already ${job.status.replace("_", " ")}, a cancellation fee of ${formatKoboAsNaira(estimatedCustomerCancelFeeKobo)} applies under our Terms.`
                  : "Free cancellation: No cancellation fee applies at this stage."}
              </p>
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Optional reason for cancelling"
                className="min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-xs"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    runAction(
                      "cancel",
                      `/api/jobs/${job.id}/cancel`,
                      { reason: cancelReason || undefined },
                      () => {
                        setShowCancelBox(false);
                        setNotice("Job cancelled.");
                      },
                    )
                  }
                  className="min-h-10 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-red-700"
                >
                  Confirm Cancellation
                </button>
                <button
                  type="button"
                  onClick={() => setShowCancelBox(false)}
                  className="min-h-10 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-xs font-semibold text-gray-700"
                >
                  Keep job
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Step 6: Pay After Job (Paystack Checkout, Confirm & Disputes) */}
      <JobPaymentPanel
        job={job}
        viewerRole={viewerRole}
        payment={payment}
        dispute={dispute}
        onUpdated={loadJob}
      />

      {/* Step 7: Ratings (strictly after job is confirmed) */}
      <JobRatingPanel
        job={job}
        viewerRole={viewerRole}
        reviews={reviews ?? []}
        onUpdated={loadJob}
      />

      {/* Step 5: In-app Job Chat (opens ONLY after acceptance, between customer & artisan) */}
      {(viewerRole === "customer" || viewerRole === "artisan") &&
      job.artisan_id &&
      job.status !== "requested" &&
      job.status !== "expired" ? (
        <JobChatPanel
          jobId={job.id}
          otherLabel={
            viewerRole === "customer"
              ? (artisanSummary?.full_name ?? "Your Artisan")
              : "Customer"
          }
        />
      ) : null}
    </div>
  );
}
