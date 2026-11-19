import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { formatKoboAsNaira } from "@/lib/money";
import {
  calculateCommissionKobo,
  getFirstTimeCustomerMaxKobo,
  initializePaystackTransaction,
} from "@/lib/payments";
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

/**
 * Starts a Paystack transaction on the server (Pay After Job model) using the
 * artisan's Paystack subaccount code and 15% platform commission.
 * NEVER marks a job paid here — ONLY the verified Paystack webhook marks it paid!
 */
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

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: job } = await supabase
      .from("jobs")
      .select("id, customer_id, artisan_id, status, accepted_amount_kobo")
      .eq("id", jobId)
      .maybeSingle();

    if (!job || job.customer_id !== user.id) {
      return NextResponse.json(
        { error: "Only the customer can pay for this job." },
        { status: 403 },
      );
    }

    if (!job.artisan_id || !job.accepted_amount_kobo) {
      return NextResponse.json(
        { error: "Job must have an assigned artisan and accepted quote before payment." },
        { status: 400 },
      );
    }

    // Pay-after-job model: payment starts once the job is completed
    if (job.status !== "completed") {
      return NextResponse.json(
        {
          error:
            job.status === "paid" || job.status === "confirmed"
              ? "This job has already been paid."
              : "Under our pay-after-job model, payment opens once the artisan completes the work.",
        },
        { status: 400 },
      );
    }

    const amountKobo = Number(job.accepted_amount_kobo);

    // Enforce first-time customer cap until they have 1 confirmed job
    const { data: confirmedCount } = await supabase.rpc(
      "customer_confirmed_job_count",
      { p_customer_id: user.id },
    );
    const maxFirstJobKobo = getFirstTimeCustomerMaxKobo();
    if (Number(confirmedCount ?? 0) < 1 && amountKobo > maxFirstJobKobo) {
      return NextResponse.json(
        {
          error: `First-time customers have a maximum job value of ${formatKoboAsNaira(maxFirstJobKobo)} until they have one confirmed job.`,
        },
        { status: 400 },
      );
    }

    const admin = createSupabaseAdminClient();

    // Check if already paid or open dispute exists
    const [{ data: existingPaid }, { data: openDispute }, { data: artisan }] =
      await Promise.all([
        admin
          .from("payments")
          .select("id, provider_reference")
          .eq("job_id", jobId)
          .eq("status", "paid")
          .maybeSingle(),
        admin
          .from("disputes")
          .select("id")
          .eq("job_id", jobId)
          .eq("status", "open")
          .maybeSingle(),
        admin
          .from("artisan_profiles")
          .select("payout_subaccount_code")
          .eq("user_id", job.artisan_id)
          .maybeSingle(),
      ]);

    if (existingPaid) {
      return NextResponse.json(
        { error: "This job has already been paid." },
        { status: 409 },
      );
    }

    if (openDispute) {
      return NextResponse.json(
        { error: "Payment is paused while a dispute is open on this job." },
        { status: 409 },
      );
    }

    const commissionKobo = calculateCommissionKobo(amountKobo);
    const providerReference = `onise_${jobId.slice(0, 8)}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

    // Store ONLY provider_reference, amount_kobo, commission_kobo, status, refund_status
    const { error: insertErr } = await admin.from("payments").insert({
      job_id: jobId,
      customer_id: user.id,
      artisan_id: job.artisan_id,
      provider_reference: providerReference,
      amount_kobo: amountKobo,
      commission_kobo: commissionKobo,
      status: "pending",
      refund_status: "none",
    });

    if (insertErr) {
      logger.error("payments.insert_failed", { jobId, code: insertErr.code });
      return NextResponse.json(
        { error: "Could not create payment record." },
        { status: 500 },
      );
    }

    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin
    ).replace(/\/$/, "");
    const callbackUrl = `${appUrl}/jobs/${jobId}?payment=returned`;

    // Paystack requires an email field; use customer's email or a deterministic synthetic placeholder (never phone!)
    const paystackEmail = user.email ?? `customer-${user.id.slice(0, 12)}@pay.oniseowo.ng`;

    const init = await initializePaystackTransaction({
      email: paystackEmail,
      amountKobo,
      commissionKobo,
      subaccountCode: artisan?.payout_subaccount_code ?? null,
      reference: providerReference,
      callbackUrl,
      metadata: {
        job_id: jobId,
        commission_kobo: commissionKobo,
      },
    });

    logger.info("payments.checkout_started", {
      jobId,
      reference: init.reference,
      amountKobo,
      commissionKobo,
      isMock: init.isMock,
    });

    return NextResponse.json({
      ok: true,
      authorizationUrl: init.authorizationUrl,
      reference: init.reference,
      amountKobo,
      commissionKobo,
      isMock: init.isMock,
    });
  } catch (err) {
    logger.error("payments.start_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Could not start Paystack payment right now.",
      },
      { status: 500 },
    );
  }
}
