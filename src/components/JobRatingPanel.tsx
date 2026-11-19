"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Star } from "lucide-react";
import type { JobRecord, ReviewRecord } from "@/lib/constants";
import { formatLagosDateTime } from "@/lib/time";

interface JobRatingPanelProps {
  job: JobRecord;
  viewerRole: "customer" | "artisan" | "invited_artisan";
  reviews: ReviewRecord[];
  onUpdated: () => Promise<void>;
}

function createIdemKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function JobRatingPanel({
  job,
  viewerRole,
  reviews,
  onUpdated,
}: JobRatingPanelProps) {
  const [rating, setRating] = useState<number>(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const idemKeyRef = useRef<string>(createIdemKey());

  // Ratings are strictly ONLY allowed after a confirmed job
  if (job.status !== "confirmed" || viewerRole === "invited_artisan") {
    return null;
  }

  const myReview = reviews.find((r) => r.reviewer_role === viewerRole);
  const otherLabel = viewerRole === "customer" ? "your artisan" : "the customer";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || rating < 1 || rating > 5) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/reviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": idemKeyRef.current,
        },
        body: JSON.stringify({
          rating,
          comment: comment.trim() || undefined,
          idempotencyKey: idemKeyRef.current,
        }),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not submit your rating.");
        return;
      }

      setNotice("Thank you! Your rating has been saved and added to their profile.");
      await onUpdated();
    } catch {
      setError("Network error submitting rating. Safe to retry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
          <Star className="h-4 w-4 fill-amber-400 text-amber-500" />
          Ratings &amp; Reviews
        </h2>
        <p className="mt-0.5 text-xs text-gray-600">
          Each side can submit one 1–5 star review with an optional comment after a job is
          confirmed.
        </p>
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
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-[#EBF7F2] px-3.5 py-2.5 text-xs text-[#08523B]">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      ) : null}

      {!myReview ? (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-xl bg-gray-50 p-4">
          <p className="text-xs font-semibold text-gray-800">
            Rate {otherLabel} (1–5 stars):
          </p>

          <div className="flex items-center gap-2" role="radiogroup" aria-label="Star rating">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                role="radio"
                aria-checked={rating === star}
                aria-label={`${star} star${star > 1 ? "s" : ""}`}
                onClick={() => setRating(star)}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white transition hover:border-amber-400"
              >
                <Star
                  className={`h-6 w-6 ${
                    star <= rating
                      ? "fill-amber-400 text-amber-500"
                      : "text-gray-300"
                  }`}
                />
              </button>
            ))}
            {rating > 0 ? (
              <span className="ml-1 text-xs font-bold text-gray-700">{rating} / 5</span>
            ) : null}
          </div>

          <textarea
            rows={2}
            maxLength={500}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional comment (e.g. Punctual, neat work, fair price)"
            className="w-full rounded-xl border border-gray-300 bg-white p-3 text-sm focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
          />

          <button
            type="submit"
            disabled={submitting || rating < 1}
            className="min-h-11 rounded-xl bg-[#0B6E4F] px-5 text-xs font-bold text-white hover:bg-[#08523B] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Submitting rating..." : "Submit Rating"}
          </button>
        </form>
      ) : (
        <div className="rounded-xl border border-emerald-200 bg-[#EBF7F2]/60 p-3.5 text-xs text-[#08523B]">
          <p className="font-bold">You rated {myReview.rating} / 5 stars</p>
          {myReview.comment ? <p className="mt-1">{myReview.comment}</p> : null}
        </div>
      )}

      {reviews.length > 0 ? (
        <ul className="divide-y divide-gray-100 text-xs">
          {reviews.map((rev) => (
            <li key={rev.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-gray-900">
                    {rev.reviewer_display_name}
                  </span>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold capitalize text-gray-600">
                    {rev.reviewer_role}
                  </span>
                </div>
                <span className="flex items-center gap-0.5 font-bold text-amber-700">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
                  {rev.rating}.0
                </span>
              </div>
              {rev.comment ? (
                <p className="mt-1 text-gray-700">{rev.comment}</p>
              ) : null}
              <p className="mt-1 text-[10px] text-gray-400">
                {formatLagosDateTime(rev.created_at)}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
