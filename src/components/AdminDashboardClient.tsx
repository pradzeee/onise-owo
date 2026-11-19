"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertOctagon,
  Briefcase,
  Clock,
  Flag,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import type {
  ArtisanProfileRecord,
  AuditLogRecord,
  DisputeRecord,
  JobRecord,
  ProfileRecord,
} from "@/lib/constants";
import { formatKoboAsNaira } from "@/lib/money";
import { formatLagosDateTime } from "@/lib/time";

export interface SafetySuspensionRow {
  id: string;
  user_id: string;
  is_urgent: boolean;
  reason: string;
  applied_at: string;
  human_review_due_at: string;
  review_outcome: "pending" | "upheld" | "lifted";
  human_reviewed_at: string | null;
  review_notes: string | null;
}

export interface UserReportRow {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  job_id: string | null;
  category: string;
  details: string;
  status: "open" | "reviewing" | "resolved" | "dismissed";
  created_at: string;
}

interface AdminDashboardClientProps {
  pendingArtisans: ArtisanProfileRecord[];
  users: ProfileRecord[];
  jobs: JobRecord[];
  disputes: DisputeRecord[];
  reports: UserReportRow[];
  suspensions: SafetySuspensionRow[];
  auditLogs: AuditLogRecord[];
}

type TabKey =
  | "approvals"
  | "users"
  | "jobs"
  | "disputes"
  | "reports"
  | "audit";

export function AdminDashboardClient({
  pendingArtisans,
  users,
  jobs,
  disputes,
  reports,
  suspensions,
  auditLogs,
}: AdminDashboardClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("approvals");
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});
  const [removeReasonMap, setRemoveReasonMap] = useState<
    Record<string, "admin_removed" | "fraud" | "violence">
  >({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pendingSuspensions = suspensions.filter((s) => s.review_outcome === "pending");
  const openDisputes = disputes.filter((d) => d.status === "open");
  const openReports = reports.filter((r) => r.status === "open" || r.status === "reviewing");

  async function callAdminApi(
    key: string,
    url: string,
    body: Record<string, unknown>,
    successMsg: string,
  ) {
    if (busyKey) return;
    setBusyKey(key);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        mfaRequired?: boolean;
      };
      if (data.mfaRequired) {
        router.push("/admin/mfa?next=/admin");
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Admin action failed.");
        return;
      }
      setNotice(successMsg);
      router.refresh();
    } catch {
      setError("Network error performing admin action.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top navigation & summary KPIs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/verifications"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[#0B6E4F] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#08523B]"
          >
            <ShieldCheck className="h-4 w-4" />
            Full Verification Queue (60s selfies)
          </Link>
          <Link
            href="/admin/reconciliation"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-xs font-bold text-gray-800 hover:bg-gray-50"
          >
            <Scale className="h-4 w-4 text-[#0B6E4F]" />
            Daily Paystack Reconciliation
          </Link>
        </div>
      </div>

      {/* Urgent safety suspension 2-business-day SLA alert */}
      {pendingSuspensions.length > 0 ? (
        <section className="space-y-3 rounded-2xl border-2 border-red-400 bg-red-50 p-4">
          <p className="flex items-center gap-2 text-sm font-extrabold text-red-900">
            <ShieldAlert className="h-5 w-5 shrink-0" />
            {pendingSuspensions.length} Urgent Safety Suspension(s) Awaiting Human Review
            (2-Business-Day SLA)
          </p>
          <div className="space-y-2.5">
            {pendingSuspensions.map((s) => (
              <div
                key={s.id}
                className="space-y-2 rounded-xl border border-red-200 bg-white p-3.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-bold text-gray-900">
                    User: {s.user_id.slice(0, 8)}...
                  </span>
                  <span className="flex items-center gap-1 font-bold text-red-700">
                    <Clock className="h-3.5 w-3.5" />
                    Review due: {formatLagosDateTime(s.human_review_due_at)}
                  </span>
                </div>
                <p className="text-gray-700">Reason: {s.reason}</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={notesMap[`susp:${s.id}`] ?? ""}
                    onChange={(e) =>
                      setNotesMap((p) => ({ ...p, [`susp:${s.id}`]: e.target.value }))
                    }
                    placeholder="Human review notes (min 5 chars)"
                    className="min-h-9 flex-1 rounded-lg border border-gray-300 px-3 text-xs"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyKey !== null}
                      onClick={() =>
                        callAdminApi(
                          `susp-up:${s.id}`,
                          `/api/admin/suspensions/${s.id}/review`,
                          { outcome: "upheld", notes: notesMap[`susp:${s.id}`] ?? "" },
                          "Suspension upheld after human review and logged to audit_log.",
                        )
                      }
                      className="min-h-9 rounded-lg bg-red-700 px-3 text-xs font-bold text-white"
                    >
                      Uphold
                    </button>
                    <button
                      type="button"
                      disabled={busyKey !== null}
                      onClick={() =>
                        callAdminApi(
                          `susp-lift:${s.id}`,
                          `/api/admin/suspensions/${s.id}/review`,
                          { outcome: "lifted", notes: notesMap[`susp:${s.id}`] ?? "" },
                          "Suspension lifted and account restored. Logged to audit_log.",
                        )
                      }
                      className="min-h-9 rounded-lg bg-[#0B6E4F] px-3 text-xs font-bold text-white"
                    >
                      Lift Suspension
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3">
        {[
          { id: "approvals", label: `Pending Approvals (${pendingArtisans.length})`, icon: ShieldCheck },
          { id: "users", label: `Users (${users.length})`, icon: Users },
          { id: "jobs", label: `Jobs (${jobs.length})`, icon: Briefcase },
          { id: "disputes", label: `Disputes (${openDisputes.length} open)`, icon: AlertOctagon },
          { id: "reports", label: `Reports (${openReports.length} open)`, icon: Flag },
          { id: "audit", label: `Audit Log (${auditLogs.length})`, icon: Clock },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as TabKey)}
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                tab === item.id
                  ? "bg-[#0B6E4F] text-white"
                  : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700"
        >
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-[#EBF7F2] px-4 py-3 text-xs text-[#08523B]">
          {notice}
        </div>
      ) : null}

      {/* TAB 1: Artisans Waiting for Approval */}
      {tab === "approvals" ? (
        <section className="space-y-3">
          {pendingArtisans.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
              No artisans currently waiting for approval.
            </div>
          ) : (
            pendingArtisans.map((art) => (
              <div
                key={art.user_id}
                className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <h2 className="text-sm font-bold text-gray-900">{art.full_name}</h2>
                  <p className="text-xs text-gray-600">
                    <span className="capitalize">{art.trade.replace("_", " ")}</span> •{" "}
                    {art.work_area} • Submitted {formatLagosDateTime(art.updated_at)}
                  </p>
                </div>
                <Link
                  href="/admin/verifications"
                  className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#0B6E4F] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#08523B]"
                >
                  Inspect Selfie &amp; Review
                </Link>
              </div>
            ))
          )}
        </section>
      ) : null}

      {/* TAB 2: Users (Suspend / Urgent Safety Suspension / Remove Account) */}
      {tab === "users" ? (
        <section className="space-y-3">
          {users.map((u) => (
            <article
              key={u.id}
              className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 text-xs shadow-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-bold text-gray-900">
                    {u.display_name || "Unnamed User"}{" "}
                    <span className="font-mono font-normal text-gray-500">
                      ({u.id.slice(0, 8)})
                    </span>
                  </p>
                  <p className="mt-0.5 text-gray-600 capitalize">
                    Role: <strong>{u.role ?? "onboarding"}</strong> • Status:{" "}
                    <strong>{u.account_status}</strong> • Verification:{" "}
                    <strong>{u.verification_status}</strong> • Rating:{" "}
                    {u.rating_count > 0
                      ? `★ ${Number(u.rating_avg).toFixed(2)} (${u.rating_count})`
                      : "None"}
                  </p>
                </div>
                <span className="text-gray-400">{formatLagosDateTime(u.created_at)}</span>
              </div>

              {u.role !== "admin" && u.account_status !== "deleted" ? (
                <div className="flex flex-col gap-2 border-t border-gray-100 pt-2.5 sm:flex-row">
                  <input
                    type="text"
                    value={notesMap[`user:${u.id}`] ?? ""}
                    onChange={(e) =>
                      setNotesMap((p) => ({ ...p, [`user:${u.id}`]: e.target.value }))
                    }
                    placeholder="Reason for urgent suspension or removal (min 5 chars)"
                    className="min-h-9 flex-1 rounded-lg border border-gray-300 px-3 text-xs"
                  />
                  <select
                    value={removeReasonMap[u.id] ?? "admin_removed"}
                    onChange={(e) =>
                      setRemoveReasonMap((p) => ({
                        ...p,
                        [u.id]: e.target.value as "admin_removed" | "fraud" | "violence",
                      }))
                    }
                    aria-label="Removal reason"
                    className="min-h-9 rounded-lg border border-gray-300 bg-white px-2 text-xs"
                  >
                    <option value="admin_removed">Remove: Policy</option>
                    <option value="fraud">Remove: Fraud (5y ban)</option>
                    <option value="violence">Remove: Violence (5y ban)</option>
                  </select>
                  <button
                    type="button"
                    disabled={busyKey !== null}
                    onClick={() =>
                      callAdminApi(
                        `susp-user:${u.id}`,
                        `/api/admin/users/${u.id}/suspend`,
                        {
                          reason: notesMap[`user:${u.id}`] ?? "",
                          isUrgent: true,
                        },
                        "Urgent safety suspension applied immediately (2-business-day review scheduled) & logged.",
                      )
                    }
                    className="min-h-9 rounded-lg border border-amber-300 bg-amber-50 px-3 font-bold text-amber-950 hover:bg-amber-100"
                  >
                    Urgent Suspend
                  </button>
                  <button
                    type="button"
                    disabled={busyKey !== null}
                    onClick={() =>
                      callAdminApi(
                        `rem-user:${u.id}`,
                        `/api/admin/users/${u.id}/remove`,
                        {
                          removalReason: removeReasonMap[u.id] ?? "admin_removed",
                          notes: notesMap[`user:${u.id}`] ?? "",
                        },
                        "Account removed, sessions terminated, and logged to audit_log.",
                      )
                    }
                    className="min-h-9 rounded-lg bg-red-600 px-3 font-bold text-white hover:bg-red-700"
                  >
                    Remove Account
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

      {/* TAB 3: Jobs */}
      {tab === "jobs" ? (
        <section className="space-y-3">
          {jobs.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
              No jobs recorded yet.
            </div>
          ) : (
            jobs.map((j) => (
              <div
                key={j.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-xs shadow-xs"
              >
                <div>
                  <p className="font-bold capitalize text-gray-900">
                    {j.trade.replace("_", " ")} • {j.approx_area_label}{" "}
                    <span className="font-mono font-normal text-gray-400">
                      ({j.id.slice(0, 8)})
                    </span>
                  </p>
                  <p className="mt-0.5 text-gray-600 line-clamp-1">{j.description}</p>
                  <p className="mt-0.5 text-gray-400">
                    Created {formatLagosDateTime(j.created_at)}
                    {j.accepted_amount_kobo
                      ? ` • Agreed: ${formatKoboAsNaira(Number(j.accepted_amount_kobo))}`
                      : ""}
                  </p>
                </div>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 font-bold capitalize text-gray-800">
                  {j.status.replace("_", " ")}
                </span>
              </div>
            ))
          )}
        </section>
      ) : null}

      {/* TAB 4: Disputes */}
      {tab === "disputes" ? (
        <section className="space-y-3">
          {disputes.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
              No disputes filed yet.
            </div>
          ) : (
            disputes.map((d) => (
              <article
                key={d.id}
                className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 text-xs shadow-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold capitalize text-gray-900">
                    {d.reason.replace("_", " ")} • Job {d.job_id.slice(0, 8)}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-bold capitalize ${
                      d.status === "open"
                        ? "bg-red-100 text-red-800"
                        : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    {d.status.replace("_", " ")}
                  </span>
                </div>
                <p className="text-gray-700">{d.details}</p>
                <p className="text-[11px] text-gray-400">
                  Opened {formatLagosDateTime(d.created_at)}
                </p>

                {d.status === "open" ? (
                  <div className="flex flex-col gap-2 border-t border-gray-100 pt-2.5 sm:flex-row">
                    <input
                      type="text"
                      value={notesMap[`disp:${d.id}`] ?? ""}
                      onChange={(e) =>
                        setNotesMap((p) => ({ ...p, [`disp:${d.id}`]: e.target.value }))
                      }
                      placeholder="Resolution notes (min 5 chars)"
                      className="min-h-9 flex-1 rounded-lg border border-gray-300 px-3 text-xs"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() =>
                          callAdminApi(
                            `disp-rel:${d.id}`,
                            `/api/admin/disputes/${d.id}/resolve`,
                            {
                              resolution: "resolved_release",
                              notes: notesMap[`disp:${d.id}`] ?? "",
                            },
                            "Dispute resolved: payment released to artisan & logged.",
                          )
                        }
                        className="min-h-9 rounded-lg bg-[#0B6E4F] px-3 font-bold text-white"
                      >
                        Release to Artisan
                      </button>
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() =>
                          callAdminApi(
                            `disp-ref:${d.id}`,
                            `/api/admin/disputes/${d.id}/resolve`,
                            {
                              resolution: "resolved_refund",
                              notes: notesMap[`disp:${d.id}`] ?? "",
                            },
                            "Dispute resolved: job marked for refund & logged.",
                          )
                        }
                        className="min-h-9 rounded-lg bg-red-600 px-3 font-bold text-white"
                      >
                        Refund Customer
                      </button>
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() =>
                          callAdminApi(
                            `disp-dis:${d.id}`,
                            `/api/admin/disputes/${d.id}/resolve`,
                            {
                              resolution: "dismissed",
                              notes: notesMap[`disp:${d.id}`] ?? "",
                            },
                            "Dispute dismissed & logged.",
                          )
                        }
                        className="min-h-9 rounded-lg border border-gray-300 bg-white px-3 font-semibold text-gray-700"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ) : d.resolution_notes ? (
                  <p className="text-gray-600">
                    <strong>Resolution:</strong> {d.resolution_notes}
                  </p>
                ) : null}
              </article>
            ))
          )}
        </section>
      ) : null}

      {/* TAB 5: Reports */}
      {tab === "reports" ? (
        <section className="space-y-3">
          {reports.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
              No safety reports submitted yet.
            </div>
          ) : (
            reports.map((r) => (
              <article
                key={r.id}
                className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 text-xs shadow-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold capitalize text-gray-900">
                    {r.category.replace(/_/g, " ")} • Reported user{" "}
                    <code className="font-mono">{r.reported_user_id.slice(0, 8)}</code>
                  </span>
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-bold capitalize text-amber-900">
                    {r.status}
                  </span>
                </div>
                <p className="text-gray-700">{r.details}</p>
                <p className="text-[11px] text-gray-400">
                  Filed {formatLagosDateTime(r.created_at)}
                </p>

                {r.status === "open" || r.status === "reviewing" ? (
                  <div className="flex flex-col gap-2 border-t border-gray-100 pt-2.5 sm:flex-row">
                    <input
                      type="text"
                      value={notesMap[`rep:${r.id}`] ?? ""}
                      onChange={(e) =>
                        setNotesMap((p) => ({ ...p, [`rep:${r.id}`]: e.target.value }))
                      }
                      placeholder="Review notes"
                      className="min-h-9 flex-1 rounded-lg border border-gray-300 px-3 text-xs"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() =>
                          callAdminApi(
                            `rep-res:${r.id}`,
                            `/api/admin/reports/${r.id}`,
                            { status: "resolved", notes: notesMap[`rep:${r.id}`] ?? "" },
                            "Report marked resolved & logged to audit_log.",
                          )
                        }
                        className="min-h-9 rounded-lg bg-[#0B6E4F] px-3 font-bold text-white"
                      >
                        Resolve
                      </button>
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() =>
                          callAdminApi(
                            `rep-dis:${r.id}`,
                            `/api/admin/reports/${r.id}`,
                            { status: "dismissed", notes: notesMap[`rep:${r.id}`] ?? "" },
                            "Report dismissed & logged to audit_log.",
                          )
                        }
                        className="min-h-9 rounded-lg border border-gray-300 bg-white px-3 font-semibold text-gray-700"
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() =>
                          callAdminApi(
                            `rep-susp:${r.id}`,
                            `/api/admin/users/${r.reported_user_id}/suspend`,
                            {
                              reason:
                                (notesMap[`rep:${r.id}`] ?? "").trim() ||
                                `Urgent safety suspension from report (${r.category})`,
                              isUrgent: true,
                            },
                            "Urgent safety suspension applied immediately on reported user!",
                          )
                        }
                        className="min-h-9 rounded-lg bg-red-600 px-3 font-bold text-white"
                      >
                        Urgent Suspend Reported User
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            ))
          )}
        </section>
      ) : null}

      {/* TAB 6: Audit Log */}
      {tab === "audit" ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <ul className="divide-y divide-gray-100 text-xs">
            {auditLogs.map((log) => (
              <li
                key={log.id}
                className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <span className="font-mono font-bold text-gray-900">{log.action}</span>
                  <span className="ml-2 text-gray-600">
                    {log.target_type} ({log.target_id?.slice(0, 8) ?? "—"})
                  </span>
                </div>
                <span className="text-gray-400">{formatLagosDateTime(log.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
