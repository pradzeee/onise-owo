import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { LEGAL_VERSIONS } from "@/lib/constants";
import { logger } from "@/lib/logger";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const subscribeSchema = z.object({
  endpoint: z.string().url().min(10).max(2048),
  keys: z.object({
    p256dh: z.string().min(10).max(512),
    auth: z.string().min(10).max(512),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url().optional(),
});

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseServerConfigured()) {
      return NextResponse.json(
        { error: "Supabase is not configured." },
        { status: 503 },
      );
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = subscribeSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid push subscription." },
        { status: 400 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Record separate withdrawable notifications consent idempotently
    await supabase.rpc("set_optional_consent", {
      p_consent_type: "notifications",
      p_granted: true,
      p_version: LEGAL_VERSIONS.notifications,
    });

    const userAgent = request.headers.get("user-agent")?.slice(0, 255) ?? null;

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        user_agent: userAgent,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,endpoint" },
    );

    if (error) {
      logger.warn("push.subscribe_failed", { userId: user.id, code: error.code });
      return NextResponse.json(
        { error: "Could not save push notification subscription." },
        { status: 400 },
      );
    }

    logger.info("push.subscribed", { userId: user.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("push.subscribe_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not enable push notifications." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!isSupabaseServerConfigured()) {
      return NextResponse.json({ ok: true });
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rawBody = await request.json().catch(() => ({}));
    const parsed = unsubscribeSchema.safeParse(rawBody);

    let query = supabase.from("push_subscriptions").delete().eq("user_id", user.id);
    if (parsed.success && parsed.data.endpoint) {
      query = query.eq("endpoint", parsed.data.endpoint);
    }

    await query;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Could not remove push subscription." },
      { status: 500 },
    );
  }
}
