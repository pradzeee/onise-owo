import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { dispatchAlertWithSmsFallback } from "@/lib/alerts";
import { formatKoboAsNaira } from "@/lib/money";
import { getFirstTimeCustomerMaxKobo } from "@/lib/payments";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const respondSchema = z.object({
  accept: z.boolean(),
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ quoteId: string }> },
) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
  }

  const { quoteId } = await context.params;
  if (!UUID_REGEX.test(quoteId)) {
    return NextResponse.json({ error: "Invalid quote ID." }, { status: 400 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = respondSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid response payload." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Enforce first-time customer max job value until they have 1 confirmed job
  if (parsed.data.accept) {
    const [{ data: quoteRow }, { data: confirmedCount }] = await Promise.all([
      supabase.from("quotes").select("amount_kobo").eq("id", quoteId).maybeSingle(),
      supabase.rpc("customer_confirmed_job_count", { p_customer_id: user.id }),
    ]);

    const maxFirstJobKobo = getFirstTimeCustomerMaxKobo();
    if (
      quoteRow &&
      Number(confirmedCount ?? 0) < 1 &&
      Number(quoteRow.amount_kobo) > maxFirstJobKobo
    ) {
      return NextResponse.json(
        {
          error: `First-time customers have a maximum job value of ${formatKoboAsNaira(maxFirstJobKobo)} until you complete and confirm your first job. Ask the artisan for a smaller initial quote.`,
        },
        { status: 400 },
      );
    }
  }

  const { data: quote, error } = await supabase.rpc("respond_to_quote", {
    p_quote_id: quoteId,
    p_accept: parsed.data.accept,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Could not respond to quote." },
      { status: error.code === "42501" ? 403 : 400 },
    );
  }

  if (quote?.artisan_id && quote?.job_id) {
    await dispatchAlertWithSmsFallback({
      userId: quote.artisan_id,
      alertType: "quote_update",
      title: parsed.data.accept ? "Your quote was accepted!" : "Quote declined",
      body: parsed.data.accept
        ? "Open Oníṣẹ́ ọwọ́ to head to the customer and mark En route."
        : "The customer declined your quote. Open the app to send a revised quote.",
      url: `/jobs/${quote.job_id}`,
      referenceId: quote.id,
      idempotencyKey: `quote_resp:${quote.id}:${parsed.data.accept ? "acc" : "dec"}`,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, quote });
}
