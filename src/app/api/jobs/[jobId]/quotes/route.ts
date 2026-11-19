import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { dispatchAlertWithSmsFallback } from "@/lib/alerts";
import { logger } from "@/lib/logger";
import { formatKoboAsNaira, nairaStringToKobo } from "@/lib/money";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const quoteSchema = z.object({
  amountNaira: z.union([z.string(), z.number()]),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    if (!isSupabaseServerConfigured() || !isSupabaseAdminConfigured()) {
      return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
    }

    const { jobId } = await context.params;
    if (!UUID_REGEX.test(jobId)) {
      return NextResponse.json({ error: "Invalid job ID." }, { status: 400 });
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = quoteSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Enter a valid quote amount in Naira." },
        { status: 400 },
      );
    }

    let amountKobo: number;
    try {
      amountKobo = nairaStringToKobo(String(parsed.data.amountNaira));
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid Naira amount." },
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

    const { data: quote, error } = await supabase.rpc("submit_job_quote", {
      p_job_id: jobId,
      p_amount_kobo: amountKobo,
      p_notes: parsed.data.notes ?? null,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message || "Could not submit quote." },
        { status: error.code === "42501" ? 403 : 400 },
      );
    }

    // Notify customer of new quote
    const admin = createSupabaseAdminClient();
    const { data: jobRow } = await admin
      .from("jobs")
      .select("customer_id")
      .eq("id", jobId)
      .maybeSingle();

    if (jobRow?.customer_id && quote?.id) {
      await dispatchAlertWithSmsFallback({
        userId: jobRow.customer_id,
        alertType: "quote_update",
        title: `New quote: ${formatKoboAsNaira(amountKobo)}`,
        body: "Open Oníṣẹ́ ọwọ́ to accept or decline this quote.",
        url: `/jobs/${jobId}`,
        referenceId: quote.id,
        idempotencyKey: `quote_sent:${quote.id}`,
      }).catch(() => {});
    }

    logger.info("quotes.submitted", { jobId, quoteId: quote?.id, amountKobo });
    return NextResponse.json({ ok: true, quote });
  } catch (err) {
    logger.error("quotes.submit_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json({ error: "Could not submit quote." }, { status: 500 });
  }
}
