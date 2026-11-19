import crypto from "crypto";
import * as webpush from "web-push";
import { hmacHash } from "./crypto";
import { PUSH_FALLBACK_SMS_SECONDS } from "./location";
import { logger } from "./logger";
import { sendNigerianSms } from "./sms";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "./supabase/admin";

export type AlertType = "job_request" | "quote_update" | "job_status" | "test_alert";

export interface DispatchAlertInput {
  userId: string;
  alertType: AlertType;
  title: string;
  body: string;
  url?: string;
  referenceId?: string | null;
  idempotencyKey: string;
}

export interface DispatchAlertResult {
  alertId: string;
  status: string;
  pushSentCount: number;
  smsFallbackDueAt: string;
  idempotentReplay: boolean;
}

export function generateAckToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(24).toString("base64url");
  return {
    rawToken,
    tokenHash: hmacHash("alert:ack", rawToken),
  };
}

export function verifyAckTokenHash(rawToken: string, storedHash: string): boolean {
  if (!rawToken || !storedHash) return false;
  const computed = hmacHash("alert:ack", rawToken.trim());
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isVapidConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
  );
}

function configureWebPush(): void {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
  const privateKey = process.env.VAPID_PRIVATE_KEY!;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:support@oniseowo.ng";
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

function buildSmsFallbackText(alertType: AlertType): string {
  switch (alertType) {
    case "job_request":
      return "Onise Owo: You have a new nearby job request waiting. Open the Onise Owo app now to accept.";
    case "quote_update":
      return "Onise Owo: There is an update on your job quote. Open the app to review.";
    case "job_status":
      return "Onise Owo: Your job status has been updated. Open the app for details.";
    case "test_alert":
    default:
      return "Onise Owo: Backup SMS alert confirmed (Web Push was not acknowledged within 30 seconds).";
  }
}

/**
 * Dispatches a Web Push notification and schedules an automatic 30-second SMS backup
 * if the service worker does not acknowledge delivery in time.
 * Safe to run twice with the same idempotencyKey (idempotent).
 */
export async function dispatchAlertWithSmsFallback(
  input: DispatchAlertInput,
): Promise<DispatchAlertResult> {
  if (!isSupabaseAdminConfigured()) {
    throw new Error("Supabase admin credentials are required to dispatch alerts.");
  }

  const admin = createSupabaseAdminClient();

  // Idempotency check
  const { data: existing } = await admin
    .from("alert_deliveries")
    .select("id, status, sms_fallback_due_at")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();

  if (existing) {
    return {
      alertId: existing.id,
      status: existing.status,
      pushSentCount: 0,
      smsFallbackDueAt: existing.sms_fallback_due_at,
      idempotentReplay: true,
    };
  }

  const { rawToken, tokenHash } = generateAckToken();
  const now = new Date();
  const fallbackDueAt = new Date(
    now.getTime() + PUSH_FALLBACK_SMS_SECONDS * 1000,
  ).toISOString();

  const { data: created, error: insertErr } = await admin
    .from("alert_deliveries")
    .insert({
      user_id: input.userId,
      alert_type: input.alertType,
      reference_id: input.referenceId ?? null,
      idempotency_key: input.idempotencyKey,
      ack_token_hash: tokenHash,
      status: "pending",
      sms_fallback_due_at: fallbackDueAt,
    })
    .select("id, status, sms_fallback_due_at")
    .single();

  if (insertErr || !created) {
    // Handle concurrent duplicate insert cleanly
    if (insertErr?.code === "23505") {
      const { data: replay } = await admin
        .from("alert_deliveries")
        .select("id, status, sms_fallback_due_at")
        .eq("idempotency_key", input.idempotencyKey)
        .single();
      if (replay) {
        return {
          alertId: replay.id,
          status: replay.status,
          pushSentCount: 0,
          smsFallbackDueAt: replay.sms_fallback_due_at,
          idempotentReplay: true,
        };
      }
    }
    throw new Error("Could not create alert delivery record.");
  }

  // Fetch user's browser push subscriptions
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", input.userId);

  let pushSentCount = 0;
  const expiredSubIds: string[] = [];

  if (subs && subs.length > 0 && isVapidConfigured()) {
    configureWebPush();
    const payload = JSON.stringify({
      title: input.title,
      body: input.body,
      url: input.url ?? "/dashboard",
      alertId: created.id,
      ackToken: rawToken,
    });

    await Promise.all(
      subs.map(async (sub: { id: string; endpoint: string; p256dh: string; auth: string }) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            payload,
            { TTL: 60 },
          );
          pushSentCount += 1;
        } catch (err) {
          const statusCode =
            err && typeof err === "object" && "statusCode" in err
              ? Number((err as { statusCode?: number }).statusCode)
              : 0;
          if (statusCode === 404 || statusCode === 410) {
            expiredSubIds.push(sub.id);
          }
          logger.warn("alerts.push_send_failed", {
            alertId: created.id,
            statusCode,
          });
        }
      }),
    );

    if (expiredSubIds.length > 0) {
      await admin.from("push_subscriptions").delete().in("id", expiredSubIds);
    }
  }

  const nextStatus = pushSentCount > 0 ? "push_sent" : "pending";
  await admin
    .from("alert_deliveries")
    .update({
      status: nextStatus,
      push_attempted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", created.id);

  logger.info("alerts.dispatched", {
    alertId: created.id,
    alertType: input.alertType,
    pushSentCount,
  });

  // Best-effort fast-path timer for local/long-running Node servers;
  // /api/cron/process-alert-fallbacks guarantees execution on serverless hosts too.
  const timer = setTimeout(() => {
    processDueSmsFallbacks().catch(() => {});
  }, (PUSH_FALLBACK_SMS_SECONDS + 1) * 1000);
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return {
    alertId: created.id,
    status: nextStatus,
    pushSentCount,
    smsFallbackDueAt: created.sms_fallback_due_at,
    idempotentReplay: false,
  };
}

/**
 * Acknowledges that a Web Push notification was received by the user's browser SW.
 * Cancels the 30-second SMS backup alert. Idempotent.
 */
export async function acknowledgeAlertDelivery(
  alertId: string,
  ackToken: string,
): Promise<{ ok: boolean; alreadyDelivered?: boolean }> {
  if (!isSupabaseAdminConfigured()) {
    throw new Error("Supabase admin credentials are not configured.");
  }

  const admin = createSupabaseAdminClient();
  const { data: row } = await admin
    .from("alert_deliveries")
    .select("id, ack_token_hash, push_delivered_at, status")
    .eq("id", alertId)
    .maybeSingle();

  if (!row) {
    return { ok: false };
  }

  if (!verifyAckTokenHash(ackToken, row.ack_token_hash)) {
    return { ok: false };
  }

  if (row.push_delivered_at) {
    return { ok: true, alreadyDelivered: true };
  }

  const nowUtc = new Date().toISOString();
  await admin
    .from("alert_deliveries")
    .update({
      status: "push_delivered",
      push_delivered_at: nowUtc,
      updated_at: nowUtc,
    })
    .eq("id", row.id)
    .is("push_delivered_at", null);

  logger.info("alerts.push_acked", { alertId: row.id });
  return { ok: true };
}

/**
 * Claims and dispatches SMS backup alerts for any alert not acknowledged via Web Push
 * within 30 seconds. Atomic claim via FOR UPDATE SKIP LOCKED guarantees at-most-once SMS.
 */
export async function processDueSmsFallbacks(limit = 25): Promise<{
  claimed: number;
  smsSent: number;
  failed: number;
}> {
  if (!isSupabaseAdminConfigured()) {
    return { claimed: 0, smsSent: 0, failed: 0 };
  }

  const admin = createSupabaseAdminClient();
  const { data: claimedRows, error } = await admin.rpc(
    "claim_due_sms_fallback_alerts",
    { p_limit: limit },
  );

  if (error || !Array.isArray(claimedRows) || claimedRows.length === 0) {
    return { claimed: 0, smsSent: 0, failed: 0 };
  }

  let smsSent = 0;
  let failed = 0;

  for (const row of claimedRows as {
    alert_id: string;
    user_id: string;
    alert_type: AlertType;
  }[]) {
    try {
      const { data: userRes } = await admin.auth.admin.getUserById(row.user_id);
      const phone = userRes?.user?.phone;

      if (!phone) {
        await admin
          .from("alert_deliveries")
          .update({
            status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.alert_id);
        failed += 1;
        continue;
      }

      await sendNigerianSms({
        toE164: phone,
        purpose: `alert_fallback_${row.alert_type}`,
        message: buildSmsFallbackText(row.alert_type),
      });

      const nowUtc = new Date().toISOString();
      await admin
        .from("alert_deliveries")
        .update({
          status: "sms_sent",
          sms_fallback_sent_at: nowUtc,
          updated_at: nowUtc,
        })
        .eq("id", row.alert_id);

      smsSent += 1;
    } catch (err) {
      logger.warn("alerts.sms_fallback_failed", {
        alertId: row.alert_id,
        message: err instanceof Error ? err.message : "unknown",
      });
      await admin
        .from("alert_deliveries")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.alert_id);
      failed += 1;
    }
  }

  return {
    claimed: claimedRows.length,
    smsSent,
    failed,
  };
}
