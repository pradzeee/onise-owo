import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hashStartCode } from "@/lib/jobs";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const startSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "Enter the customer's 4-digit start code."),
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
  const parsed = startSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid 4-digit code." },
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

  const codeHash = hashStartCode(jobId, parsed.data.code);
  const { data: started, error } = await supabase.rpc(
    "verify_start_code_and_start_job",
    {
      p_job_id: jobId,
      p_code_hash: codeHash,
    },
  );

  if (error) {
    return NextResponse.json(
      { error: error.message || "Could not verify start code." },
      { status: error.code === "42501" ? 403 : 400 },
    );
  }

  if (!started) {
    return NextResponse.json(
      { error: "Incorrect 4-digit start code. Ask the customer to check their screen." },
      { status: 401 },
    );
  }

  return NextResponse.json({ ok: true, status: "in_progress" });
}
