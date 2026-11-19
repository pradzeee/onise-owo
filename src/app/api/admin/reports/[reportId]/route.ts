import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checkAdminTwoStep } from "@/lib/admin-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const updateSchema = z.object({
  status: z.enum(["reviewing", "resolved", "dismissed"]),
  notes: z.string().trim().max(500).optional(),
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ reportId: string }> },
) {
  const check = await checkAdminTwoStep();
  if (!check.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!check.isAdmin || !check.mfaVerified) {
    return NextResponse.json(
      { error: "Admin two-step verification required.", mfaRequired: check.isAdmin },
      { status: 403 },
    );
  }

  const { reportId } = await context.params;
  if (!UUID_REGEX.test(reportId)) {
    return NextResponse.json({ error: "Invalid report ID." }, { status: 400 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid report update." },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_update_report", {
    p_report_id: reportId,
    p_status: parsed.data.status,
    p_notes: parsed.data.notes ?? null,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Could not update report." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, report: data });
}
