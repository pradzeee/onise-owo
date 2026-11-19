import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { sendNigerianSms } from "@/lib/sms";
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
 * Records an emergency SOS event in audit_log (with zero PII) and alerts
 * the user's saved trusted contact by SMS if configured.
 */
export async function POST(
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

  const { data: job } = await supabase
    .from("jobs")
    .select("id, customer_id, artisan_id, approx_area_label, trade")
    .eq("id", jobId)
    .maybeSingle();

  if (!job || (job.customer_id !== user.id && job.artisan_id !== user.id)) {
    return NextResponse.json({ error: "Job access denied." }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  await admin.from("audit_log").insert({
    actor_id: user.id,
    action: "job_sos_triggered",
    target_type: "job",
    target_id: jobId,
    metadata: {
      trade: job.trade,
    },
  });

  const { data: contact } = await supabase
    .from("trusted_contacts")
    .select("contact_name, contact_phone_e164")
    .eq("user_id", user.id)
    .maybeSingle();

  let alertedTrustedContact = false;
  if (contact?.contact_phone_e164) {
    await sendNigerianSms({
      toE164: contact.contact_phone_e164,
      purpose: "job_sos_alert",
      message: `URGENT Onise Owo SOS: Your contact triggered an SOS alert during a ${job.trade.replace("_", " ")} job in ${job.approx_area_label}. Please call them immediately or dial 112.`,
    }).catch(() => {});
    alertedTrustedContact = true;
  }

  logger.warn("jobs.sos_triggered", { jobId, userId: user.id, alertedTrustedContact });

  return NextResponse.json({
    ok: true,
    emergencyNumber: "112",
    alertedTrustedContact,
    trustedContactPhone: contact?.contact_phone_e164 ?? null,
    trustedContactName: contact?.contact_name ?? null,
  });
}
