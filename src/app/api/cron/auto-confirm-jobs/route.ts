import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";

function isAuthorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Scheduled job: auto-confirms completed/paid jobs 24 hours after completion
 * if there is NO open dispute. Idempotent.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: "Supabase admin not configured." }, { status: 503 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("auto_confirm_completed_jobs");

  if (error) {
    logger.error("cron.auto_confirm_failed", { code: error.code });
    return NextResponse.json({ error: "Auto-confirm job failed." }, { status: 500 });
  }

  logger.info("cron.auto_confirm_completed", { confirmedCount: Number(data ?? 0) });
  return NextResponse.json({ ok: true, confirmedCount: Number(data ?? 0) });
}
