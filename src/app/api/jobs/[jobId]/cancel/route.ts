import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const cancelSchema = z.object({
  reason: z.string().trim().max(500).optional(),
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

  const rawBody = await request.json().catch(() => ({}));
  const parsed = cancelSchema.safeParse(rawBody);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("cancel_job", {
    p_job_id: jobId,
    p_reason: parsed.success ? (parsed.data.reason ?? null) : null,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Could not cancel job." },
      { status: error.code === "42501" ? 403 : 400 },
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    status: string;
    cancel_fee_kobo: number;
  };

  return NextResponse.json({
    ok: true,
    status: row?.status ?? "cancelled",
    cancelFeeKobo: Number(row?.cancel_fee_kobo ?? 0),
  });
}
