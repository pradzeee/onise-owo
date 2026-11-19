import { NextResponse } from "next/server";
import { getLagosDateString } from "@/lib/reconciliation";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

/**
 * Download My Data (NDPA 2023 Data Portability):
 * Exports ONLY the authenticated user's own personal data (RLS-enforced).
 * Never exports raw NINs, card details, password hashes, or other users' private records.
 */
export async function GET() {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [
    { data: profile },
    { data: artisanProfile },
    { data: consents },
    { data: trustedContact },
    { data: jobs },
    { data: quotes },
    { data: messagesSent },
    { data: payments },
    { data: reviewsWritten },
    { data: reviewsReceived },
    { data: disputes },
    { data: reports },
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("artisan_profiles").select("*").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("consents")
      .select("consent_type, version, granted, consented_at, withdrawn_at")
      .eq("user_id", user.id)
      .order("consented_at", { ascending: false }),
    supabase
      .from("trusted_contacts")
      .select("contact_name, contact_phone_e164, updated_at")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("jobs")
      .select(
        "id, trade, description, approx_area_label, status, accepted_amount_kobo, cancel_fee_kobo, created_at, completed_at, confirmed_at, cancelled_at",
      )
      .or(`customer_id.eq.${user.id},artisan_id.eq.${user.id}`)
      .order("created_at", { ascending: false }),
    supabase
      .from("quotes")
      .select("id, job_id, amount_kobo, notes, status, created_at")
      .eq("artisan_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("job_messages")
      .select("id, job_id, body, created_at")
      .eq("sender_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("payments")
      .select(
        "id, job_id, provider_reference, amount_kobo, commission_kobo, status, refund_status, paid_at, created_at",
      )
      .or(`customer_id.eq.${user.id},artisan_id.eq.${user.id}`)
      .order("created_at", { ascending: false }),
    supabase
      .from("reviews")
      .select("id, job_id, rating, comment, created_at")
      .eq("reviewer_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("reviews")
      .select("id, job_id, reviewer_display_name, rating, comment, created_at")
      .eq("reviewee_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("disputes")
      .select("id, job_id, reason, details, status, created_at")
      .eq("opened_by", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("user_reports")
      .select("id, job_id, category, details, status, created_at")
      .eq("reporter_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  const exportPayload = {
    exported_at_utc: new Date().toISOString(),
    app: "Oníṣẹ́ ọwọ́",
    account: {
      id: user.id,
      phone: user.phone ?? null,
      created_at: user.created_at,
    },
    profile: profile ?? null,
    artisan_profile: artisanProfile ?? null,
    consents: consents ?? [],
    trusted_contact: trustedContact ?? null,
    jobs: jobs ?? [],
    quotes_submitted: quotes ?? [],
    chat_messages_sent: messagesSent ?? [],
    payments: payments ?? [],
    reviews_written: reviewsWritten ?? [],
    reviews_received: reviewsReceived ?? [],
    disputes_opened: disputes ?? [],
    reports_filed: reports ?? [],
  };

  const filename = `onise-owo-my-data-${getLagosDateString()}.json`;

  return new NextResponse(JSON.stringify(exportPayload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
