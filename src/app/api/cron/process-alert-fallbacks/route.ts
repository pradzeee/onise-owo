import { NextResponse, type NextRequest } from "next/server";
import { processDueSmsFallbacks } from "@/lib/alerts";
import { logger } from "@/lib/logger";

function isAuthorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/**
 * Scheduled job endpoint: sends backup SMS alerts for any Web Push notification
 * not acknowledged within 30 seconds. Atomic & idempotent (at-most-once SMS).
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await processDueSmsFallbacks(50);
  logger.info("cron.alert_fallbacks_completed", summary);
  return NextResponse.json({ ok: true, ...summary });
}
