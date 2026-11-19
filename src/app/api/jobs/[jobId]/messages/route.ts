import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { containsPhoneNumber } from "@/lib/chat";
import { logger } from "@/lib/logger";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const sendMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Enter a message.")
    .max(1000, "Message must be 1000 characters or fewer."),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
  }

  const { jobId } = await context.params;
  if (!UUID_REGEX.test(jobId)) {
    return NextResponse.json({ error: "Invalid job ID." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: statusData, error: statusErr } = await supabase.rpc(
    "get_job_chat_status",
    { p_job_id: jobId },
  );

  if (statusErr) {
    return NextResponse.json(
      { error: "Could not check chat status." },
      { status: 400 },
    );
  }

  const chatStatus = (Array.isArray(statusData) ? statusData[0] : statusData) as {
    can_read: boolean;
    can_send: boolean;
    is_blocked: boolean;
    closes_at: string | null;
    closed_reason: string | null;
  };

  if (!chatStatus?.can_read) {
    return NextResponse.json(
      {
        error: chatStatus?.closed_reason ?? "Chat is not available for this job.",
        chatStatus,
      },
      { status: 403 },
    );
  }

  const [{ data: messages }, { data: job }, { data: myBlocks }] = await Promise.all([
    supabase
      .from("job_messages")
      .select("id, job_id, sender_id, body, created_at")
      .eq("job_id", jobId)
      .order("created_at", { ascending: true })
      .limit(200),
    supabase
      .from("jobs")
      .select("customer_id, artisan_id")
      .eq("id", jobId)
      .maybeSingle(),
    supabase.from("user_blocks").select("blocked_id").eq("blocker_id", user.id),
  ]);

  const otherUserId =
    job && user.id === job.customer_id
      ? job.artisan_id
      : job && user.id === job.artisan_id
        ? job.customer_id
        : null;

  const iBlockedOther = Boolean(
    otherUserId &&
      (myBlocks ?? []).some((b: { blocked_id: string }) => b.blocked_id === otherUserId),
  );

  return NextResponse.json({
    ok: true,
    currentUserId: user.id,
    otherUserId,
    iBlockedOther,
    chatStatus,
    messages: messages ?? [],
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    if (!isSupabaseServerConfigured()) {
      return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
    }

    const { jobId } = await context.params;
    if (!UUID_REGEX.test(jobId)) {
      return NextResponse.json({ error: "Invalid job ID." }, { status: 400 });
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = sendMessageSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid message." },
        { status: 400 },
      );
    }

    // Do not allow sharing phone numbers in chat
    if (containsPhoneNumber(parsed.data.body)) {
      return NextResponse.json(
        {
          error:
            "For your safety, please do not share phone numbers in chat. Keep all communication inside Oníṣẹ́ ọwọ́.",
        },
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

    const idempotencyKey =
      parsed.data.idempotencyKey ??
      request.headers.get("x-idempotency-key")?.trim() ??
      null;

    const { data: msg, error } = await supabase.rpc("send_job_message", {
      p_job_id: jobId,
      p_body: parsed.data.body,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message || "Could not send message." },
        { status: error.code === "42501" ? 403 : 400 },
      );
    }

    // RULE: NEVER log message text!
    logger.info("chat.message_sent", {
      jobId,
      messageId: msg?.id,
    });

    return NextResponse.json({ ok: true, message: msg });
  } catch (err) {
    logger.error("chat.send_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not send message right now." },
      { status: 500 },
    );
  }
}
