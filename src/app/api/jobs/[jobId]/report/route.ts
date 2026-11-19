import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { REPORT_CATEGORIES, type ReportCategory } from "@/lib/chat";
import { logger } from "@/lib/logger";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const VALID_CATEGORIES = REPORT_CATEGORIES.map((c) => c.id) as [
  ReportCategory,
  ...ReportCategory[],
];

const reportSchema = z.object({
  category: z.enum(VALID_CATEGORIES),
  details: z
    .string()
    .trim()
    .min(5, "Please explain what happened (at least 5 characters).")
    .max(1000, "Details must be 1000 characters or fewer."),
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
  const parsed = reportSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check your report details." },
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

  const { data: job } = await supabase
    .from("jobs")
    .select("customer_id, artisan_id, status")
    .eq("id", jobId)
    .maybeSingle();

  if (!job || !job.artisan_id || job.status === "requested" || job.status === "expired") {
    return NextResponse.json(
      { error: "You can only submit a report on an accepted job." },
      { status: 403 },
    );
  }

  const otherId =
    user.id === job.customer_id
      ? job.artisan_id
      : user.id === job.artisan_id
        ? job.customer_id
        : null;

  if (!otherId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const idempotencyKey =
    parsed.data.idempotencyKey ??
    request.headers.get("x-idempotency-key")?.trim() ??
    null;

  const { data: report, error } = await supabase.rpc("create_user_report", {
    p_reported_user_id: otherId,
    p_job_id: jobId,
    p_category: parsed.data.category,
    p_details: parsed.data.details,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Could not submit report." },
      { status: 400 },
    );
  }

  // Never log report details text (may contain sensitive descriptions)
  logger.warn("safety.user_reported", {
    jobId,
    reportId: report?.id,
    category: parsed.data.category,
  });

  return NextResponse.json({ ok: true, reportId: report?.id });
}
