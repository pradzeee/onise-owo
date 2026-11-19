import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { dispatchAlertWithSmsFallback, processDueSmsFallbacks } from "@/lib/alerts";
import { logger } from "@/lib/logger";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const testAlertSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

export async function GET() {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ alerts: [] });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Trigger any due 30s fallbacks in local dev/polling so status transitions are immediately visible
  await processDueSmsFallbacks(10).catch(() => {});

  const { data } = await supabase
    .from("alert_deliveries")
    .select(
      "id, user_id, alert_type, reference_id, status, push_attempted_at, push_delivered_at, sms_fallback_due_at, sms_fallback_sent_at, created_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(5);

  return NextResponse.json({ alerts: data ?? [] });
}

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseServerConfigured()) {
      return NextResponse.json(
        { error: "Supabase is not configured." },
        { status: 503 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rawBody = await request.json().catch(() => ({}));
    const parsed = testAlertSchema.safeParse(rawBody);
    const idempotencyKey =
      (parsed.success ? parsed.data.idempotencyKey : undefined) ??
      `test:${user.id}:${Math.floor(Date.now() / 5000)}`;

    const result = await dispatchAlertWithSmsFallback({
      userId: user.id,
      alertType: "test_alert",
      title: "Oníṣẹ́ ọwọ́ — Test Alert",
      body: "Web Push is working! Because this push arrived, the 30-second SMS backup was cancelled.",
      url: "/dashboard",
      idempotencyKey,
    });

    return NextResponse.json({ ok: true, delivery: result });
  } catch (err) {
    logger.error("alerts.test_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not send test alert right now." },
      { status: 500 },
    );
  }
}
