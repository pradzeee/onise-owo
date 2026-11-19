import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";

function isAuthorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/**
 * Scheduled job endpoint: sets artisans Offline after 15 minutes without a heartbeat signal.
 * Safe to run repeatedly (idempotent).
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: "Supabase admin not configured." }, { status: 503 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("expire_stale_online_artisans");

  if (error) {
    logger.error("cron.expire_online_failed", { code: error.code });
    return NextResponse.json({ error: "Could not expire stale artisans." }, { status: 500 });
  }

  logger.info("cron.expire_online_completed", { expiredCount: Number(data ?? 0) });
  return NextResponse.json({ ok: true, expiredCount: Number(data ?? 0) });
}
