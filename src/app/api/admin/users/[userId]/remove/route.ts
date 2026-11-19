import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checkAdminTwoStep } from "@/lib/admin-auth";
import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const removeSchema = z.object({
  removalReason: z.enum(["admin_removed", "fraud", "violence"]),
  notes: z.string().trim().min(5, "Enter removal notes (at least 5 characters).").max(500),
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Admin account removal:
 * - Marks account deleted at once, hides from search, logs out all sessions globally,
 *   wipes push_subscriptions & trusted_contacts, and schedules 30-day permanent erasure.
 * - For 'fraud' or 'violence', preserves ONLY NIN & phone hash in ban_records (5 years).
 * - Writes action to audit_log.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  const check = await checkAdminTwoStep();
  if (!check.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!check.isAdmin || !check.mfaVerified || !check.userId) {
    return NextResponse.json(
      { error: "Admin two-step verification required.", mfaRequired: check.isAdmin },
      { status: 403 },
    );
  }

  const { userId } = await context.params;
  if (!UUID_REGEX.test(userId) || userId === check.userId) {
    return NextResponse.json({ error: "Invalid target user ID." }, { status: 400 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = removeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid removal request." },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();

  // Prevent removing another admin from web dashboard
  const { data: targetProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (!targetProfile) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }
  if (targetProfile.role === "admin") {
    return NextResponse.json(
      { error: "Cannot remove another admin account from the dashboard." },
      { status: 403 },
    );
  }

  const { data: initRes, error } = await admin.rpc("initiate_account_deletion", {
    p_user_id: userId,
    p_removal_reason: parsed.data.removalReason,
    p_force_admin_override: true,
  });

  if (error) {
    return NextResponse.json(
      { error: "Could not remove account right now." },
      { status: 500 },
    );
  }

  // Log out target user globally at once
  await admin.auth.admin.signOut(userId, "global").catch(() => {});

  // Record admin action in audit_log
  await admin.from("audit_log").insert({
    actor_id: check.userId,
    action: `admin_remove_account_${parsed.data.removalReason}`,
    target_type: "profile",
    target_id: userId,
    metadata: {
      removal_reason: parsed.data.removalReason,
      notes: parsed.data.notes,
    },
  });

  logger.warn("admin.account_removed", {
    adminId: check.userId,
    targetUserId: userId,
    removalReason: parsed.data.removalReason,
  });

  const row = Array.isArray(initRes) ? initRes[0] : initRes;
  return NextResponse.json({
    ok: true,
    scheduledPurgeAt: row?.scheduled_purge_at ?? null,
  });
}
