import { NextResponse, type NextRequest } from "next/server";
import { processDueAccountDeletions } from "@/lib/deletion";
import { logger } from "@/lib/logger";

function isAuthorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Scheduled job (30-day permanent erasure):
 * Permanently erases personal data, storage files, and auth users for all
 * scheduled deletion requests whose 30-day period has elapsed.
 * Anonymises reviews, archives payment records for 6 years, preserves fraud/violence
 * ban hashes up to 5 years, writes non-PII deletion_logs, and sends confirmation SMS.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await processDueAccountDeletions(20);
  logger.info("cron.account_deletions_completed", summary);
  return NextResponse.json({ ok: true, ...summary });
}
