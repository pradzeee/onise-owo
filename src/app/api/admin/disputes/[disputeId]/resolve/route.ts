import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checkAdminTwoStep } from "@/lib/admin-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const resolveSchema = z.object({
  resolution: z.enum(["resolved_release", "resolved_refund", "dismissed"]),
  notes: z.string().trim().min(5, "Enter resolution notes (at least 5 characters).").max(500),
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ disputeId: string }> },
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

  const { disputeId } = await context.params;
  if (!UUID_REGEX.test(disputeId)) {
    return NextResponse.json({ error: "Invalid dispute ID." }, { status: 400 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = resolveSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid dispute resolution." },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_resolve_dispute", {
    p_dispute_id: disputeId,
    p_resolution: parsed.data.resolution,
    p_notes: parsed.data.notes,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Could not resolve dispute." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, dispute: data });
}
