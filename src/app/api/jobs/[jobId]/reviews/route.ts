import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const reviewSchema = z.object({
  rating: z
    .number()
    .int("Rating must be a whole number from 1 to 5.")
    .min(1, "Select between 1 and 5 stars.")
    .max(5, "Select between 1 and 5 stars."),
  comment: z
    .string()
    .trim()
    .max(500, "Comment must be 500 characters or fewer.")
    .optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ reviews: [] });
  }

  const { jobId } = await context.params;
  if (!UUID_REGEX.test(jobId)) {
    return NextResponse.json({ error: "Invalid job ID." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data } = await supabase
    .from("reviews")
    .select(
      "id, job_id, reviewer_id, reviewee_id, reviewer_role, reviewer_display_name, rating, comment, is_anonymized, created_at",
    )
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });

  return NextResponse.json({ ok: true, reviews: data ?? [] });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    if (!isSupabaseServerConfigured()) {
      return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
    }

    const { jobId } = await context.params;
    if (!UUID_REGEX.test(jobId)) {
      return NextResponse.json({ error: "Invalid job ID." }, { status: 400 });
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = reviewSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid rating input." },
        { status: 400 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const idempotencyKey =
      parsed.data.idempotencyKey ??
      request.headers.get("x-idempotency-key")?.trim() ??
      null;

    const { data: review, error } = await supabase.rpc("submit_job_review", {
      p_job_id: jobId,
      p_rating: parsed.data.rating,
      p_comment: parsed.data.comment ?? null,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      const status =
        error.code === "42501" ? 403 : error.code === "23505" ? 409 : 400;
      return NextResponse.json(
        { error: error.message || "Could not submit review." },
        { status },
      );
    }

    logger.info("reviews.submitted", {
      jobId,
      reviewId: review?.id,
      rating: parsed.data.rating,
    });

    return NextResponse.json({ ok: true, review });
  } catch (err) {
    logger.error("reviews.submit_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not submit review right now." },
      { status: 500 },
    );
  }
}
