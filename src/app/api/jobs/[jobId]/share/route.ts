import { NextResponse, type NextRequest } from "next/server";
import { generateJobShareToken } from "@/lib/jobs";
import { logger } from "@/lib/logger";
import { maskPhoneForUi } from "@/lib/phone";
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
      .select("id, customer_id, trade, approx_area_label")
      .eq("id", jobId)
      .maybeSingle();

    if (!job || job.customer_id !== user.id) {
      return NextResponse.json(
        { error: "Only the customer can share this job." },
        { status: 403 },
      );
    }

    const { data: contact } = await supabase
      .from("trusted_contacts")
      .select("contact_name, contact_phone_e164")
      .eq("user_id", user.id)
      .maybeSingle();

    const { rawToken, tokenHash } = generateJobShareToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const admin = createSupabaseAdminClient();
    const { error: shareErr } = await admin.from("job_shares").insert({
      job_id: jobId,
      created_by: user.id,
      share_token_hash: tokenHash,
      expires_at: expiresAt,
    });

    if (shareErr) {
      return NextResponse.json({ error: "Could not create share link." }, { status: 500 });
    }

    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin
    ).replace(/\/$/, "");
    const shareUrl = `${appUrl}/track/${rawToken}`;

    let smsDispatched = false;
    if (contact?.contact_phone_e164) {
      await sendNigerianSms({
        toE164: contact.contact_phone_e164,
        purpose: "job_share_link",
        message: `Onise Owo safety share: Follow live status for a ${job.trade.replace("_", " ")} booking in ${job.approx_area_label}: ${shareUrl}`,
      }).catch(() => {});
      smsDispatched = true;
    }

    logger.info("jobs.shared", { jobId, smsDispatched });

    return NextResponse.json({
      ok: true,
      shareUrl,
      smsSentTo: contact ? `${contact.contact_name} (${maskPhoneForUi(contact.contact_phone_e164)})` : null,
    });
  } catch (err) {
    logger.error("jobs.share_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json({ error: "Could not share job right now." }, { status: 500 });
  }
}
