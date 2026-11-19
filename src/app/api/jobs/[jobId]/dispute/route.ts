import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { DISPUTE_REASONS, type DisputeReason } from "@/lib/constants";
import { logger } from "@/lib/logger";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const VALID_REASONS = DISPUTE_REASONS.map((r) => r.id) as [
  DisputeReason,
  ...DisputeReason[],
];

const disputeSchema = z.object({
  reason: z.enum(VALID_REASONS),
  details: z
    .string()
    .trim()
    .min(10, "Describe the dispute in at least 10 characters.")
    .max(1000),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
  }

  const { jobId } = await context.params;
  if (!UUID_REGEX.test(jobId)) {
    return NextResponse.json({ error: "Invalid job ID." }, { status: 400 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = disputeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check your dispute details." },
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

  const { data: dispute, error } = await supabase.rpc("open_job_dispute", {
    p_job_id: jobId,
    p_reason: parsed.data.reason,
    p_details: parsed.data.details,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Could not open dispute." },
      { status: error.code === "42501" ? 403 : 400 },
    );
  }

  logger.warn("disputes.opened", {
    jobId,
    disputeId: dispute?.id,
    reason: parsed.data.reason,
  });

  return NextResponse.json({ ok: true, dispute });
}
