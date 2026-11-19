"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  Eye,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type {
  ArtisanProfileRecord,
  ArtisanVerificationRecord,
  AuditLogRecord,
  GuarantorVerificationRecord,
} from "@/lib/constants";
import { formatLagosDateTime } from "@/lib/time";

export interface AdminApplicationItem {
  artisan: ArtisanProfileRecord;
  verification: ArtisanVerificationRecord | null;
  guarantor: GuarantorVerificationRecord | null;
}

interface AdminVerificationsClientProps {
  applications: AdminApplicationItem[];
  auditLogs: AuditLogRecord[];
}

export function AdminVerificationsClient({
  applications,
  auditLogs,
}: AdminVerificationsClientProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("pending");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Ephemeral 60-second signed selfie viewer state
  const [activeSelfie, setActiveSelfie] = useState<{
    artisanId: string;
    artisanName: string;
    signedUrl: string;
    secondsLeft: number;
    auditLogId: string;
  } | null>(null);

  useEffect(() => {
    if (!activeSelfie) return;
    if (activeSelfie.secondsLeft <= 0) {
      setActiveSelfie(null);
      return;
    }
    const timer = setInterval(() => {
      setActiveSelfie((prev) =>
        prev && prev.secondsLeft > 1
          ? { ...prev, secondsLeft: prev.secondsLeft - 1 }
          : null,
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [activeSelfie]);

  const filtered = applications.filter((item) =>
    filter === "all" ? true : item.artisan.verification_status === filter,
  );

  async function handleOpenSelfie(artisanId: string, artisanName: string) {
    if (busyId) return;
    setBusyId(`selfie:${artisanId}`);
    setError(null);
    setFeedback(null);

    try {
      const res = await fetch(
        `/api/admin/verifications/${encodeURIComponent(artisanId)}/signed-url`,
        { method: "POST" },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        signedUrl?: string;
        expiresInSeconds?: number;
        auditLogId?: string;
      };

      if (!res.ok || !data.signedUrl) {
        setError(data.error ?? "Could not open private verification selfie.");
        return;
      }

      setActiveSelfie({
        artisanId,
        artisanName,
        signedUrl: data.signedUrl,
        secondsLeft: data.expiresInSeconds ?? 60,
        auditLogId: data.auditLogId ?? "",
      });
      router.refresh();
    } catch {
      setError("Network error while opening verification file.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReview(
    artisanId: string,
    decision: "approved" | "rejected" | "suspended",
  ) {
    if (busyId) return;
    setError(null);
    setFeedback(null);

    const reason = (reasons[artisanId] ?? "").trim();
    if ((decision === "rejected" || decision === "suspended") && reason.length < 5) {
      setError("Enter a clear reason (at least 5 characters) before rejecting or suspending.");
      return;
    }

    setBusyId(`review:${artisanId}`);
    try {
      const res = await fetch(
        `/api/admin/verifications/${encodeURIComponent(artisanId)}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            reason: reason || undefined,
          }),
        },
      );

      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not save admin decision.");
        return;
      }

      setFeedback(`Artisan marked as ${decision}. Action recorded in audit_log.`);
      router.refresh();
    } catch {
      setError("Network error while submitting admin review.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        {["pending", "approved", "rejected", "suspended", "all"].map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setFilter(tab)}
            className={`min-h-9 rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize transition ${
              filter === tab
                ? "bg-[#0B6E4F] text-white"
                : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {tab} (
            {tab === "all"
              ? applications.length
              : applications.filter((a) => a.artisan.verification_status === tab).length}
            )
          </button>
        ))}
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      {feedback ? (
        <div className="rounded-xl border border-emerald-200 bg-[#EBF7F2] px-4 py-3 text-sm text-[#08523B]">
          {feedback}
        </div>
      ) : null}

      {/* Ephemeral 60-second signed file viewer */}
      {activeSelfie ? (
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-gray-900">
                Private Selfie — {activeSelfie.artisanName}
              </p>
              <p className="text-xs text-amber-900">
                Signed link expires in{" "}
                <span className="font-mono font-bold">{activeSelfie.secondsLeft}s</span> •
                Audit log ID: <code className="font-mono">{activeSelfie.auditLogId.slice(0, 8)}</code>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveSelfie(null)}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-amber-100"
            >
              Close preview
            </button>
          </div>
          <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 bg-black/5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeSelfie.signedUrl}
              alt={`Private verification selfie for ${activeSelfie.artisanName}`}
              className="mx-auto max-h-80 object-contain"
            />
          </div>
        </div>
      ) : null}

      {/* Application cards */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          No artisan applications with status &ldquo;{filter}&rdquo;.
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(({ artisan, verification, guarantor }) => {
            const providerPassed =
              verification?.provider_status === "passed" &&
              verification.liveness_passed &&
              verification.face_match_passed;
            const guarantorConfirmed = guarantor?.status === "confirmed";
            const hasPayoutCode = Boolean(artisan.payout_recipient_code);
            const canApprove = providerPassed && guarantorConfirmed && hasPayoutCode;

            return (
              <article
                key={artisan.user_id}
                className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-bold text-gray-900">
                      {artisan.full_name}
                    </h2>
                    <p className="text-xs text-gray-600">
                      <span className="capitalize font-medium">
                        {artisan.trade.replace("_", " ")}
                      </span>{" "}
                      • {artisan.work_area} • Updated{" "}
                      {formatLagosDateTime(artisan.updated_at)}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${
                      artisan.verification_status === "approved"
                        ? "bg-emerald-100 text-emerald-800"
                        : artisan.verification_status === "rejected" ||
                            artisan.verification_status === "suspended"
                          ? "bg-red-100 text-red-800"
                          : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {artisan.verification_status}
                  </span>
                </div>

                <p className="text-xs leading-relaxed text-gray-700">{artisan.bio}</p>

                {/* Verification gates summary */}
                <div className="grid gap-3 rounded-xl bg-gray-50 p-3.5 text-xs sm:grid-cols-3">
                  <div className="flex items-start gap-2">
                    {providerPassed ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    )}
                    <div>
                      <p className="font-semibold text-gray-900">NIN + Face &amp; Liveness</p>
                      <p className="text-gray-600 capitalize">
                        {verification
                          ? `${verification.provider_status} (${verification.provider_name})`
                          : "Not submitted"}
                      </p>
                      {verification ? (
                        <p className="font-mono text-[10px] text-gray-500">
                          Ref: {verification.provider_reference}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    {guarantorConfirmed ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    )}
                    <div>
                      <p className="font-semibold text-gray-900">Guarantor</p>
                      <p className="text-gray-600">
                        {guarantor
                          ? `${guarantor.guarantor_name} (${guarantor.status})`
                          : "Missing"}
                      </p>
                      {guarantor?.confirmed_at ? (
                        <p className="text-[10px] text-gray-500">
                          {formatLagosDateTime(guarantor.confirmed_at)}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    {hasPayoutCode ? (
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    )}
                    <div>
                      <p className="font-semibold text-gray-900">Paystack Recipient</p>
                      <p className="font-mono text-[11px] text-gray-600">
                        {artisan.payout_recipient_code ?? "Not configured"}
                      </p>
                    </div>
                  </div>
                </div>

                {artisan.rejection_reason ? (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                    <strong>Previous reason:</strong> {artisan.rejection_reason}
                  </p>
                ) : null}

                {/* Admin actions */}
                <div className="space-y-3 border-t border-gray-100 pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busyId !== null || !verification}
                      onClick={() =>
                        handleOpenSelfie(artisan.user_id, artisan.full_name)
                      }
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {busyId === `selfie:${artisan.user_id}`
                        ? "Logging & signing..."
                        : "Open private selfie (60s link)"}
                    </button>

                    <button
                      type="button"
                      disabled={busyId !== null || !canApprove}
                      title={
                        canApprove
                          ? "Approve artisan"
                          : "Cannot approve until NIN face match + liveness passed AND guarantor confirmed"
                      }
                      onClick={() => handleReview(artisan.user_id, "approved")}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#0B6E4F] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#08523B] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Approve artisan
                    </button>
                  </div>

                  {!canApprove ? (
                    <p className="text-[11px] text-amber-800">
                      Approval locked until NIN face match &amp; liveness pass{" "}
                      <strong>and</strong> guarantor confirms via OTP.
                    </p>
                  ) : null}

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={reasons[artisan.user_id] ?? ""}
                      onChange={(e) =>
                        setReasons((prev) => ({
                          ...prev,
                          [artisan.user_id]: e.target.value,
                        }))
                      }
                      placeholder="Reason required to reject or suspend (e.g. Blurry selfie or unverified guarantor)"
                      className="min-h-10 flex-1 rounded-lg border border-gray-300 px-3 text-xs focus:border-[#0B6E4F] focus:outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => handleReview(artisan.user_id, "rejected")}
                        className="min-h-10 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => handleReview(artisan.user_id, "suspended")}
                        className="min-h-10 rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-200 disabled:opacity-50"
                      >
                        Suspend
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Recent Audit Log */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold text-gray-900">Recent Admin Audit Log</h2>
        <p className="mt-1 text-xs text-gray-600">
          Every private file open (60s signed link) and verification decision is recorded
          here.
        </p>

        {auditLogs.length === 0 ? (
          <p className="mt-3 text-xs text-gray-500">No audit entries yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100 text-xs">
            {auditLogs.map((log) => (
              <li
                key={log.id}
                className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <span className="font-mono font-semibold text-gray-900">
                    {log.action}
                  </span>
                  <span className="ml-2 text-gray-600">
                    Target: {log.target_type} ({log.target_id?.slice(0, 8) ?? "—"})
                  </span>
                </div>
                <span className="text-gray-500">{formatLagosDateTime(log.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
