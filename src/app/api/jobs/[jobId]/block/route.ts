import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const blockSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveOtherParticipant(jobId: string) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };

  const { data: job } = await supabase
    .from("jobs")
    .select("customer_id, artisan_id, status")
    .eq("id", jobId)
    .maybeSingle();

  if (!job || !job.artisan_id || job.status === "requested" || job.status === "expired") {
    return {
      error: "You can only block a participant on an accepted job.",
      status: 403 as const,
    };
  }

  const otherId =
    user.id === job.customer_id
      ? job.artisan_id
      : user.id === job.artisan_id
        ? job.customer_id
        : null;

  if (!otherId) {
    return { error: "Forbidden", status: 403 as const };
  }

  return { supabase, user, otherId };
}

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

  const resolved = await resolveOtherParticipant(jobId);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const rawBody = await request.json().catch(() => ({}));
  const parsed = blockSchema.safeParse(rawBody);

  const { error } = await resolved.supabase.rpc("block_user", {
    p_blocked_id: resolved.otherId,
    p_job_id: jobId,
    p_reason: parsed.success ? (parsed.data.reason ?? null) : null,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Could not block user." },
      { status: 400 },
    );
  }

  logger.info("safety.user_blocked", { jobId, blockerId: resolved.user.id });
  return NextResponse.json({ ok: true, blocked: true });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
  }

  const { jobId } = await context.params;
  if (!UUID_REGEX.test(jobId)) {
    return NextResponse.json({ error: "Invalid job ID." }, { status: 400 });
  }

  const resolved = await resolveOtherParticipant(jobId);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const { error } = await resolved.supabase.rpc("unblock_user", {
    p_blocked_id: resolved.otherId,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Could not unblock user." },
      { status: 400 },
    );
  }

  logger.info("safety.user_unblocked", { jobId, blockerId: resolved.user.id });
  return NextResponse.json({ ok: true, blocked: false });
}
