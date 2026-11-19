import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { acknowledgeAlertDelivery } from "@/lib/alerts";

const ackSchema = z.object({
  alertId: z.string().uuid(),
  ackToken: z.string().min(16).max(128),
});

/**
 * Called by the PWA Service Worker (public/sw.js) immediately when a Web Push
 * arrives, cancelling the 30-second SMS backup alert. Idempotent.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.json().catch(() => null);
  const parsed = ackSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid ack payload." }, { status: 400 });
  }

  const res = await acknowledgeAlertDelivery(parsed.data.alertId, parsed.data.ackToken);
  if (!res.ok) {
    return NextResponse.json({ error: "Invalid alert token." }, { status: 403 });
  }

  return NextResponse.json({ ok: true, alreadyDelivered: Boolean(res.alreadyDelivered) });
}
