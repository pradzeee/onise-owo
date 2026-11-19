import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { dispatchAlertWithSmsFallback } from "@/lib/alerts";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const statusSchema = z.object({
  nextStatus: z.enum(["en_route", "arrived", "completed"]),
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  if (!isSupabaseServerConfigured() || !isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
  }

  const { jobId } = await context.params;
  if (!UUID_REGEX.test(jobId)) {
    return NextResponse.json({ error: "Invalid job ID." }, { status: 400 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = statusSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status transition." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: newStatus, error } = await supabase.rpc("transition_job_status", {
    p_job_id: jobId,
    p_next_status: parsed.data.nextStatus,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Could not update job status." },
      { status: error.code === "42501" ? 403 : 400 },
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: jobRow } = await admin
    .from("jobs")
    .select("customer_id")
    .eq("id", jobId)
    .maybeSingle();

  if (jobRow?.customer_id) {
    const messages: Record<string, { title: string; body: string }> = {
      en_route: {
        title: "Your artisan is on the way",
        body: "They are heading to your address now.",
      },
      arrived: {
        title: "Your artisan has arrived",
        body: "Share your 4-digit start code on Oníṣẹ́ ọwọ́ only after confirming their identity.",
      },
      completed: {
        title: "Artisan marked job completed",
        body: "Open Oníṣẹ́ ọwọ́ to inspect the work and proceed.",
      },
    };
    const msg = messages[parsed.data.nextStatus];
    if (msg) {
      await dispatchAlertWithSmsFallback({
        userId: jobRow.customer_id,
        alertType: "job_status",
        title: msg.title,
        body: msg.body,
        url: `/jobs/${jobId}`,
        referenceId: jobId,
        idempotencyKey: `job_status:${jobId}:${parsed.data.nextStatus}`,
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, status: newStatus });
}
