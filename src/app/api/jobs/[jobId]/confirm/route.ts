import { NextResponse, type NextRequest } from "next/server";
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
  if (!isSupabaseServerConfigured()) {
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

  const { data: status, error } = await supabase.rpc("confirm_completed_job", {
    p_job_id: jobId,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Could not confirm job." },
      { status: error.code === "42501" ? 403 : 400 },
    );
  }

  return NextResponse.json({ ok: true, status });
}
