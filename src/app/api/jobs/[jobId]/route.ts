import { NextResponse, type NextRequest } from "next/server";
import { processDueJobDispatchRounds } from "@/lib/dispatch";
import { deriveCustomerStartCode } from "@/lib/jobs";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  if (!isSupabaseServerConfigured() || !isSupabaseAdminConfigured()) {
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

  // Advance expired dispatch round for this job if due
  await processDueJobDispatchRounds(jobId).catch(() => {});

  // RLS-enforced read: uninvolved users receive null/empty
  const [
    { data: job },
    { data: privateAddress },
    { data: requests },
    { data: quotes },
    { data: payments },
    { data: disputes },
    { data: reviews },
  ] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, customer_id, artisan_id, trade, description, photo_paths, dispatch_mode, dispatch_round, round_expires_at, approx_area_label, status, accepted_quote_id, accepted_amount_kobo, cancel_fee_kobo, cancelled_by, cancel_reason, accepted_at, en_route_at, arrived_at, started_at, completed_at, confirmed_at, cancelled_at, expired_at, created_at, updated_at",
      )
      .eq("id", jobId)
      .maybeSingle(),
    supabase
      .from("job_private_addresses")
      .select("exact_address, exact_lat, exact_lng")
      .eq("job_id", jobId)
      .maybeSingle(),
    supabase
      .from("job_requests")
      .select("id, job_id, artisan_id, round_number, status, sent_at, expires_at, responded_at")
      .eq("job_id", jobId)
      .order("round_number", { ascending: true }),
    supabase
      .from("quotes")
      .select("id, job_id, artisan_id, amount_kobo, notes, status, created_at, responded_at")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false }),
    supabase
      .from("payments")
      .select(
        "id, job_id, provider_reference, amount_kobo, commission_kobo, status, refund_status, release_paused, paid_at, created_at",
      )
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("disputes")
      .select(
        "id, job_id, opened_by, reason, details, status, resolution_notes, resolved_at, created_at",
      )
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("reviews")
      .select(
        "id, job_id, reviewer_id, reviewee_id, reviewer_role, reviewer_display_name, rating, comment, is_anonymized, created_at",
      )
      .eq("job_id", jobId)
      .order("created_at", { ascending: true }),
  ]);

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const admin = createSupabaseAdminClient();

  // Short-lived signed URLs for private job photos
  const photoUrls: string[] = [];
  for (const path of (job.photo_paths ?? []) as string[]) {
    const { data: signed } = await admin.storage
      .from("job-photos")
      .createSignedUrl(path, 300);
    if (signed?.signedUrl) photoUrls.push(signed.signedUrl);
  }

  // Compute 4-digit start code EXCLUSIVELY for the authenticated customer after acceptance
  let customerStartCode: string | null = null;
  if (user.id === job.customer_id && job.artisan_id) {
    const { data: codeRow } = await admin
      .from("jobs")
      .select("start_code_nonce")
      .eq("id", job.id)
      .maybeSingle();

    if (codeRow?.start_code_nonce) {
      customerStartCode = deriveCustomerStartCode(job.id, codeRow.start_code_nonce);
    }
  }

  // Safe artisan summary (never phone number!)
  let artisanSummary: {
    full_name: string;
    trade: string;
    work_area: string;
  } | null = null;

  if (job.artisan_id) {
    const { data: art } = await admin
      .from("artisan_profiles")
      .select("full_name, trade, work_area")
      .eq("user_id", job.artisan_id)
      .maybeSingle();
    if (art) artisanSummary = art;
  }

  return NextResponse.json({
    ok: true,
    viewerRole:
      user.id === job.customer_id
        ? "customer"
        : user.id === job.artisan_id
          ? "artisan"
          : "invited_artisan",
    job,
    exactAddress: privateAddress ?? null,
    requests: requests ?? [],
    quotes: quotes ?? [],
    payment: payments?.[0] ?? null,
    dispute: disputes?.[0] ?? null,
    reviews: reviews ?? [],
    photoUrls,
    customerStartCode,
    artisanSummary,
  });
}
