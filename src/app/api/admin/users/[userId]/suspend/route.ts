import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checkAdminTwoStep } from "@/lib/admin-auth";
import { addBusinessDaysLagos } from "@/lib/business-days";
import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const suspendSchema = z.object({
  reason: z.string().trim().min(5, "Provide a reason (at least 5 characters).").max(500),
  isUrgent: z.boolean().default(true),
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  const check = await checkAdminTwoStep();
  if (!check.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!check.isAdmin) {
    return NextResponse.json({ error: "Admin privileges required." }, { status: 403 });
  }
  if (!check.mfaVerified) {
    return NextResponse.json(
      { error: "Admin two-step verification required.", mfaRequired: true },
      { status: 403 },
    );
  }

  const { userId } = await context.params;
  if (!UUID_REGEX.test(userId)) {
    return NextResponse.json({ error: "Invalid user ID." }, { status: 400 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = suspendSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid suspension request." },
      { status: 400 },
    );
  }

  // Urgent safety suspensions apply at once and are reviewed by a human within 2 business days (Lagos)
  const reviewDueAt = addBusinessDaysLagos(new Date(), 2).toISOString();

  const supabase = await createSupabaseServerClient();
  const { data: suspension, error } = await supabase.rpc("admin_suspend_user", {
    p_target_user_id: userId,
    p_reason: parsed.data.reason,
    p_is_urgent: parsed.data.isUrgent,
    p_human_review_due_at: reviewDueAt,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Could not suspend user." },
      { status: error.code === "42501" ? 403 : 400 },
    );
  }

  // Apply immediately: sign out all active sessions for the suspended user
  const admin = createSupabaseAdminClient();
  await admin.auth.admin.signOut(userId, "global").catch(() => {});

  logger.warn("admin.user_suspended", {
    adminId: check.userId,
    targetUserId: userId,
    isUrgent: parsed.data.isUrgent,
    reviewDueAt,
  });

  return NextResponse.json({ ok: true, suspension });
}
