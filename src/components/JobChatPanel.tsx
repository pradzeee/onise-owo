"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Ban,
  Clock,
  Flag,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { REPORT_CATEGORIES, containsPhoneNumber, type ReportCategory } from "@/lib/chat";
import type { JobChatStatus, JobMessageRecord } from "@/lib/constants";
import {
  createSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { formatLagosDateTime } from "@/lib/time";

interface JobChatPanelProps {
  jobId: string;
  otherLabel: string;
}

export function JobChatPanel({ jobId, otherLabel }: JobChatPanelProps) {
  const [messages, setMessages] = useState<JobMessageRecord[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [chatStatus, setChatStatus] = useState<JobChatStatus | null>(null);
  const [iBlockedOther, setIBlockedOther] = useState(false);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [busySafety, setBusySafety] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Report modal state
  const [showReport, setShowReport] = useState(false);
  const [reportCategory, setReportCategory] = useState<ReportCategory>("harassment");
  const [reportDetails, setReportDetails] = useState("");

  const listEndRef = useRef<HTMLDivElement | null>(null);

  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/messages`, {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        currentUserId?: string;
        iBlockedOther?: boolean;
        chatStatus?: JobChatStatus;
        messages?: JobMessageRecord[];
      };

      if (!res.ok) {
        if (json.chatStatus) setChatStatus(json.chatStatus);
        return;
      }

      setCurrentUserId(json.currentUserId ?? null);
      setIBlockedOther(Boolean(json.iBlockedOther));
      setChatStatus(json.chatStatus ?? null);
      setMessages(json.messages ?? []);
    } catch {
      // Ignore transient network errors
    }
  }, [jobId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Subscribe to Supabase Realtime inserts on job_messages for this job
  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`job-chat-${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "job_messages",
          filter: `job_id=eq.${jobId}`,
        },
        (payload) => {
          const incoming = payload.new as JobMessageRecord;
          if (!incoming?.id) return;
          setMessages((prev) =>
            prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming],
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending || !chatStatus?.can_send) return;

    setError(null);
    setNotice(null);

    if (containsPhoneNumber(text)) {
      setError(
        "For your safety, do not share phone numbers in chat. Keep all communication inside Oníṣẹ́ ọwọ́.",
      );
      return;
    }

    setSending(true);
    try {
      const idemKey = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": idemKey,
        },
        body: JSON.stringify({ body: text, idempotencyKey: idemKey }),
      });

      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: JobMessageRecord;
      };

      if (!res.ok) {
        setError(json.error ?? "Could not send message.");
        return;
      }

      setDraft("");
      if (json.message) {
        setMessages((prev) =>
          prev.some((m) => m.id === json.message!.id) ? prev : [...prev, json.message!],
        );
      }
    } catch {
      setError("Network error sending message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleToggleBlock() {
    if (busySafety) return;
    setBusySafety(true);
    setError(null);
    setNotice(null);

    try {
      const method = iBlockedOther ? "DELETE" : "POST";
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/block`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "POST" ? JSON.stringify({ reason: "Blocked from job chat" }) : undefined,
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not update block status.");
        return;
      }
      setNotice(
        iBlockedOther
          ? "User unblocked."
          : "User blocked. Chat is now disabled and you will not be matched again.",
      );
      await loadMessages();
    } catch {
      setError("Network error updating block status.");
    } finally {
      setBusySafety(false);
    }
  }

  async function handleSubmitReport(e: React.FormEvent) {
    e.preventDefault();
    if (busySafety || reportDetails.trim().length < 5) return;
    setBusySafety(true);
    setError(null);
    setNotice(null);

    try {
      const idemKey = `rep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": idemKey,
        },
        body: JSON.stringify({
          category: reportCategory,
          details: reportDetails.trim(),
          idempotencyKey: idemKey,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not submit report.");
        return;
      }
      setShowReport(false);
      setReportDetails("");
      setNotice("Report submitted to our safety team for review.");
    } catch {
      setError("Network error submitting report.");
    } finally {
      setBusySafety(false);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
            <MessageSquare className="h-4 w-4 text-[#0B6E4F]" />
            In-App Chat with {otherLabel}
          </h2>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-500">
            <ShieldCheck className="h-3.5 w-3.5 text-[#0B6E4F]" />
            Phone numbers are never shown. Chat closes 7 days after the job ends.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => loadMessages()}
            title="Refresh chat"
            className="inline-flex min-h-9 items-center rounded-lg border border-gray-200 px-2.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setShowReport((v) => !v)}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            <Flag className="h-3.5 w-3.5" />
            Report
          </button>
          <button
            type="button"
            disabled={busySafety}
            onClick={handleToggleBlock}
            className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold ${
              iBlockedOther
                ? "border border-gray-300 bg-gray-100 text-gray-800 hover:bg-gray-200"
                : "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
            }`}
          >
            <Ban className="h-3.5 w-3.5" />
            {iBlockedOther ? "Unblock" : "Block"}
          </button>
        </div>
      </div>

      {/* 7-day closing window info */}
      {chatStatus?.closes_at ? (
        <div className="flex items-center gap-1.5 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>
            {chatStatus.can_send
              ? `This chat will close on ${formatLagosDateTime(chatStatus.closes_at)}.`
              : `Chat closed on ${formatLagosDateTime(chatStatus.closes_at)} (7 days after job ended).`}
          </span>
        </div>
      ) : null}

      {/* Report inline panel */}
      {showReport ? (
        <form
          onSubmit={handleSubmitReport}
          className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-xs"
        >
          <p className="font-bold text-amber-950">Report {otherLabel}</p>
          <select
            value={reportCategory}
            onChange={(e) => setReportCategory(e.target.value as ReportCategory)}
            className="min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-xs"
          >
            {REPORT_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <textarea
            rows={2}
            required
            maxLength={1000}
            value={reportDetails}
            onChange={(e) => setReportDetails(e.target.value)}
            placeholder="Describe what happened so our safety team can investigate..."
            className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-xs"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busySafety || reportDetails.trim().length < 5}
              className="min-h-9 rounded-lg bg-amber-700 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-amber-800 disabled:opacity-50"
            >
              Submit Report
            </button>
            <button
              type="button"
              onClick={() => setShowReport(false)}
              className="min-h-9 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-[#EBF7F2] px-3 py-2 text-xs text-[#08523B]">
          {notice}
        </div>
      ) : null}

      {/* Messages thread */}
      <div className="max-h-80 space-y-2.5 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-3">
        {messages.length === 0 ? (
          <p className="py-6 text-center text-xs text-gray-500">
            No messages yet. Say hello to coordinate arrival or clarify job details.
          </p>
        ) : (
          messages.map((msg) => {
            const isMine = msg.sender_id === currentUserId;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    isMine
                      ? "bg-[#0B6E4F] text-white"
                      : "border border-gray-200 bg-white text-gray-900"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                </div>
                <span className="mt-0.5 px-1 text-[10px] text-gray-400">
                  {isMine ? "You" : otherLabel} • {formatLagosDateTime(msg.created_at)}
                </span>
              </div>
            );
          })
        )}
        <div ref={listEndRef} />
      </div>

      {/* Composer or Closed state */}
      {chatStatus?.can_send ? (
        <form onSubmit={handleSend} className="flex gap-2">
          <input
            type="text"
            maxLength={1000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a message (no phone numbers)..."
            className="min-h-11 flex-1 rounded-xl border border-gray-300 px-3.5 text-sm focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[#0B6E4F] px-4 text-xs font-bold text-white hover:bg-[#08523B] disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            {sending ? "Sending..." : "Send"}
          </button>
        </form>
      ) : (
        <div className="rounded-xl bg-gray-100 px-3.5 py-2.5 text-center text-xs text-gray-600">
          {chatStatus?.closed_reason ?? "Chat is currently closed."}
        </div>
      )}
    </section>
  );
}
