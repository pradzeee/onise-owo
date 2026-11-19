import { NextResponse, type NextRequest } from "next/server";
import { processDueJobDispatchRounds } from "@/lib/dispatch";

function isAuthorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Scheduled job endpoint: escalates nearest-3 dispatch rounds after 60 seconds
 * (up to 3 rounds) and expires jobs with no acceptance. Idempotent.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await processDueJobDispatchRounds();
  return NextResponse.json({ ok: true, processed: results.length, results });
}
