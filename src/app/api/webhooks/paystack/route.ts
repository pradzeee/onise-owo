import { NextResponse, type NextRequest } from "next/server";
import { dispatchAlertWithSmsFallback } from "@/lib/alerts";
import { logger } from "@/lib/logger";
import { sha256Hex, verifyPaystackWebhookSignature } from "@/lib/payments";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";

interface PaystackWebhookPayload {
  event?: string;
  data?: {
    id?: number | string;
    reference?: string;
    transaction_reference?: string;
    amount?: number;
    currency?: string;
    status?: string;
  };
}

/**
 * Paystack Webhook Handler — ONLY authoritative source of truth for marking a job paid!
 * - Verifies HMAC-SHA512 x-paystack-signature on the raw request body.
 * - Saves unique provider_event_id in webhook_events and ignores repeats (idempotent).
 * - Checks paid amount (kobo) strictly equals the accepted quote & payment record.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseAdminConfigured()) {
      return NextResponse.json({ error: "Server not configured." }, { status: 503 });
    }

    const rawBody = await request.text();
    const signature = request.headers.get("x-paystack-signature");

    if (!verifyPaystackWebhookSignature(rawBody, signature)) {
      logger.warn("webhook.paystack_invalid_signature", {});
      return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
    }

    let payload: PaystackWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as PaystackWebhookPayload;
    } catch {
      return NextResponse.json({ error: "Malformed JSON." }, { status: 400 });
    }

    const eventType = String(payload.event ?? "").trim();
    const data = payload.data ?? {};
    const reference = String(data.reference ?? data.transaction_reference ?? "").trim();
    const providerEventId = `paystack:${eventType}:${String(data.id ?? reference)}`;
    const payloadHash = sha256Hex(rawBody);

    const admin = createSupabaseAdminClient();

    if (eventType === "charge.success") {
      if (data.currency && data.currency.toUpperCase() !== "NGN") {
        logger.warn("webhook.paystack_non_ngn", { reference, currency: data.currency });
        return NextResponse.json({ ok: true, ignored: "non_ngn" });
      }

      const paidAmountKobo = Number(data.amount ?? 0);
      if (!reference || !Number.isSafeInteger(paidAmountKobo) || paidAmountKobo <= 0) {
        return NextResponse.json({ error: "Invalid charge payload." }, { status: 400 });
      }

      const { data: rpcRes, error } = await admin.rpc(
        "process_paystack_charge_success",
        {
          p_provider_event_id: providerEventId,
          p_event_type: eventType,
          p_provider_reference: reference,
          p_paid_amount_kobo: paidAmountKobo,
          p_payload_hash: payloadHash,
        },
      );

      if (error) {
        logger.error("webhook.paystack_rpc_error", { code: error.code });
        return NextResponse.json({ error: "Processing error." }, { status: 500 });
      }

      const row = (Array.isArray(rpcRes) ? rpcRes[0] : rpcRes) as {
        outcome: string;
        job_id: string | null;
        payment_id: string | null;
      };

      logger.info("webhook.paystack_charge_handled", {
        outcome: row?.outcome,
        reference,
      });

      if (row?.outcome === "paid" && row.job_id) {
        const { data: jobRow } = await admin
          .from("jobs")
          .select("customer_id, artisan_id")
          .eq("id", row.job_id)
          .maybeSingle();

        if (jobRow?.artisan_id) {
          await dispatchAlertWithSmsFallback({
            userId: jobRow.artisan_id,
            alertType: "job_status",
            title: "Payment verified via Paystack!",
            body: "The customer's payment has been confirmed on Oníṣẹ́ ọwọ́.",
            url: `/jobs/${row.job_id}`,
            referenceId: row.job_id,
            idempotencyKey: `paid_art:${reference}`,
          }).catch(() => {});
        }
      }

      return NextResponse.json({
        ok: true,
        outcome: row?.outcome ?? "processed",
        duplicate: row?.outcome === "duplicate_ignored",
      });
    }

    if (eventType === "refund.processed" || eventType === "refund.failed") {
      // Idempotently record webhook event
      const { error: evErr } = await admin.from("webhook_events").insert({
        provider: "paystack",
        provider_event_id: providerEventId,
        event_type: eventType,
        provider_reference: reference || null,
        payload_hash: payloadHash,
        status: "processed",
      });

      if (evErr?.code === "23505") {
        return NextResponse.json({ ok: true, duplicate: true });
      }

      if (reference) {
        const nextRefundStatus = eventType === "refund.processed" ? "refunded" : "failed";
        const { data: updatedPayment } = await admin
          .from("payments")
          .update({
            refund_status: nextRefundStatus,
            updated_at: new Date().toISOString(),
          })
          .eq("provider_reference", reference)
          .select("job_id")
          .maybeSingle();

        if (nextRefundStatus === "refunded" && updatedPayment?.job_id) {
          await admin
            .from("jobs")
            .update({
              status: "refunded",
              updated_at: new Date().toISOString(),
            })
            .eq("id", updatedPayment.job_id);
        }
      }

      return NextResponse.json({ ok: true, outcome: eventType });
    }

    // Record other valid signed Paystack events idempotently without action
    await admin
      .from("webhook_events")
      .insert({
        provider: "paystack",
        provider_event_id: providerEventId,
        event_type: eventType || "unknown",
        provider_reference: reference || null,
        payload_hash: payloadHash,
        status: "ignored",
      })
      .select("id")
      .maybeSingle();

    return NextResponse.json({ ok: true, ignored: true });
  } catch (err) {
    logger.error("webhook.paystack_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json({ error: "Webhook error." }, { status: 500 });
  }
}
