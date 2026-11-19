import { NextResponse, type NextRequest } from "next/server";
import { dispatchAlertWithSmsFallback } from "@/lib/alerts";
import { createStartCodeMaterial } from "@/lib/jobs";
import { logger } from "@/lib/logger";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    if (!isSupabaseServerConfigured() || !isSupabaseAdminConfigured()) {
      return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
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

    // Generate start code nonce + hash (raw 4-digit code is NEVER stored in Postgres)
    const { nonce, startCodeHash } = createStartCodeMaterial(jobId);

    // Atomic single-UPDATE race guard in Postgres: first to accept wins!
    const { data, error } = await supabase.rpc("accept_job_request", {
      p_job_id: jobId,
      p_start_code_nonce: nonce,
      p_start_code_hash: startCodeHash,
    });

    if (error) {
      logger.warn("jobs.accept_failed", {
        userId: user.id,
        jobId,
        code: error.code,
      });
      return NextResponse.json(
        { error: error.message || "Could not accept job request." },
        { status: error.code === "42501" ? 403 : 400 },
      );
    }

    const row = (Array.isArray(data) ? data[0] : data) as {
      won: boolean;
      request_status: string;
      job_status: string;
    };

    if (row?.won) {
      const admin = createSupabaseAdminClient();
      const { data: jobRow } = await admin
        .from("jobs")
        .select("customer_id")
        .eq("id", jobId)
        .maybeSingle();

      if (jobRow?.customer_id) {
        await dispatchAlertWithSmsFallback({
          userId: jobRow.customer_id,
          alertType: "job_status",
          title: "An artisan accepted your job!",
          body: "Open Oníṣẹ́ ọwọ́ to view your 4-digit start code and wait for their quote.",
          url: `/jobs/${jobId}`,
          referenceId: jobId,
          idempotencyKey: `job_accepted:${jobId}`,
        }).catch(() => {});
      }
    }

    return NextResponse.json({
      ok: true,
      won: Boolean(row?.won),
      requestStatus: row?.request_status ?? "taken",
      jobStatus: row?.job_status ?? "requested",
    });
  } catch (err) {
    logger.error("jobs.accept_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not accept job right now." },
      { status: 500 },
    );
  }
}
