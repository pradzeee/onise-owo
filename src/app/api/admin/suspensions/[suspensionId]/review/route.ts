import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checkAdminTwoStep } from "@/lib/admin-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const reviewSchema = z.object({
  outcome: z.enum(["upheld", "lifted"]),
  notes: z.string().trim().min(5, "Enter review notes (at least 5 characters).").max(500),
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ suspensionId: string }> },
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

  const { suspensionId } = await context.params;
  if (!UUID_REGEX.test(suspensionId)) {
    return NextResponse.json({ error: "Invalid suspension ID." }, { status: 400 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = reviewSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid review payload." },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_review_safety_suspension", {
    p_suspension_id: suspensionId,
    p_outcome: parsed.data.outcome,
    p_notes: parsed.data.notes,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Could not record safety review." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, suspension: data });
}
