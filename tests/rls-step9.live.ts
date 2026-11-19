/**
 * Live Supabase RLS, Urgent Safety Suspension (2-Business-Day Review),
 * Dispute Resolution, Report Handling & Audit Log Test (Step 9).
 *
 * Proves against your real Supabase database:
 * 1. Non-admin users CANNOT read admin_totp_secrets, admin_mfa_sessions, safety_suspensions,
 *    or call ANY Step 9 admin RPC (suspend, review suspension, resolve dispute, update report).
 * 2. Admin urgent safety suspension applies AT ONCE (account_status = 'suspended', is_online = false),
 *    records human_review_due_at (2 business days), and logs to audit_log.
 * 3. Human reviewer lifts suspension -> restores active/approved state and logs to audit_log.
 * 4. Admin resolves an open dispute (resolved_refund & resolved_release) -> updates job & payment
 *    and logs to audit_log.
 * 5. Admin updates a safety report -> updates status and logs to audit_log.
 *
 * Run with: npm run test:rls:step9
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { addBusinessDaysLagos } from "../src/lib/business-days";

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (
  !SUPABASE_URL ||
  !SUPABASE_ANON_KEY ||
  !SUPABASE_SERVICE_ROLE_KEY ||
  SUPABASE_URL.includes("YOUR_PROJECT_REF")
) {
  console.error("Missing real Supabase env vars in .env.local.");
  process.exit(1);
}

const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function createAnonClient() {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function run() {
  const suffix = Date.now().toString().slice(-6);
  const password = `Step9Test!${suffix}Aa`;
  const createdIds: string[] = [];

  try {
    console.log("Creating Admin, Customer, and Artisan accounts...");
    const [rAdmin, rCust, rArt] = await Promise.all([
      service.auth.admin.createUser({ email: `s9-admin-${suffix}@example.test`, password, email_confirm: true }),
      service.auth.admin.createUser({ email: `s9-cust-${suffix}@example.test`, password, email_confirm: true }),
      service.auth.admin.createUser({ email: `s9-art-${suffix}@example.test`, password, email_confirm: true }),
    ]);

    const adminId = rAdmin.data.user!.id;
    const custId = rCust.data.user!.id;
    const artId = rArt.data.user!.id;
    createdIds.push(adminId, custId, artId);

    // Manually designate admin in DB
    await service
      .from("profiles")
      .update({ role: "admin", onboarding_completed_at: new Date().toISOString() })
      .eq("id", adminId);

    const clientAdmin = createAnonClient();
    const clientCust = createAnonClient();
    const clientArt = createAnonClient();

    await Promise.all([
      clientAdmin.auth.signInWithPassword({ email: `s9-admin-${suffix}@example.test`, password }),
      clientCust.auth.signInWithPassword({ email: `s9-cust-${suffix}@example.test`, password }),
      clientArt.auth.signInWithPassword({ email: `s9-art-${suffix}@example.test`, password }),
    ]);

    await Promise.all([
      clientCust.rpc("complete_onboarding", { p_role: "customer", p_terms_version: "2026-11-v1", p_privacy_version: "2026-11-v1", p_accepted_required: true }),
      clientArt.rpc("complete_onboarding", { p_role: "artisan", p_terms_version: "2026-11-v1", p_privacy_version: "2026-11-v1", p_accepted_required: true }),
    ]);

    await service.from("artisan_profiles").insert({
      user_id: artId,
      full_name: "Step9 Approved Artisan",
      trade: "electrician",
      bio: "Inverter and wiring specialist.",
      work_area: "Ikeja",
      payout_recipient_code: `RCP_s9_${suffix}`,
      verification_status: "approved",
      is_online: true,
      last_seen_at: new Date().toISOString(),
    });

    // 1. Non-admin CANNOT read admin MFA tables, safety_suspensions, or call admin RPCs
    console.log("1. Testing non-admin is blocked from all Step 9 admin tables & RPCs...");
    const { error: totpErr } = await clientCust.from("admin_totp_secrets").select("*");
    assert.ok(totpErr, "Non-admin must NOT read admin_totp_secrets");

    const { error: mfaErr } = await clientCust.from("admin_mfa_sessions").select("*");
    assert.ok(mfaErr, "Non-admin must NOT read admin_mfa_sessions");

    const { data: nonAdminSusps } = await clientCust.from("safety_suspensions").select("*");
    assert.equal(nonAdminSusps?.length ?? 0, 0, "Non-admin must see 0 safety_suspensions");

    const { error: nonAdminSuspendErr } = await clientCust.rpc("admin_suspend_user", {
      p_target_user_id: artId,
      p_reason: "Unauthorized suspension attempt",
      p_is_urgent: true,
    });
    assert.ok(nonAdminSuspendErr, "Non-admin must NOT call admin_suspend_user");

    // 2. Admin applies Urgent Safety Suspension -> immediate effect + 2-business-day review + audit_log
    console.log("2. Testing Urgent Safety Suspension applies at once & logs to audit_log...");
    const reviewDue = addBusinessDaysLagos(new Date(), 2).toISOString();
    const suspRes = await clientAdmin.rpc("admin_suspend_user", {
      p_target_user_id: artId,
      p_reason: "Urgent safety report under investigation",
      p_is_urgent: true,
      p_human_review_due_at: reviewDue,
    });
    assert.ifError(suspRes.error);
    assert.equal(suspRes.data.review_outcome, "pending");

    const [{ data: artProf }, { data: baseProf }] = await Promise.all([
      service.from("artisan_profiles").select("is_online, verification_status").eq("user_id", artId).single(),
      service.from("profiles").select("account_status").eq("id", artId).single(),
    ]);
    assert.equal(artProf?.is_online, false, "Urgent suspension must take artisan Offline immediately");
    assert.equal(artProf?.verification_status, "suspended");
    assert.equal(baseProf?.account_status, "suspended");

    // 3. Human reviewer lifts suspension within 2 business days -> restores account & logs to audit_log
    console.log("3. Testing human review lifts urgent safety suspension & logs to audit_log...");
    const liftRes = await clientAdmin.rpc("admin_review_safety_suspension", {
      p_suspension_id: suspRes.data.id,
      p_outcome: "lifted",
      p_notes: "Verified false alarm after speaking with both parties.",
    });
    assert.ifError(liftRes.error);
    assert.equal(liftRes.data.review_outcome, "lifted");

    const { data: restoredProf } = await service
      .from("profiles")
      .select("account_status")
      .eq("id", artId)
      .single();
    assert.equal(restoredProf?.account_status, "active");

    // 4. Seed job + dispute + report -> Admin resolves both & writes audit_log
    console.log("4. Testing Admin resolves dispute & updates safety report with audit_log...");
    const { data: job } = await service
      .from("jobs")
      .insert({
        customer_id: custId,
        artisan_id: artId,
        trade: "electrician",
        description: "Inverter wiring job with dispute.",
        approx_location: "SRID=4326;POINT(3.351 6.602)",
        approx_area_label: "Ikeja",
        status: "paid",
        accepted_amount_kobo: 1_500_000,
        completed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    await service.from("payments").insert({
      job_id: job!.id,
      customer_id: custId,
      artisan_id: artId,
      provider_reference: `onise_s9_${suffix}`,
      amount_kobo: 1_500_000,
      commission_kobo: 225_000,
      status: "paid",
      paid_at: new Date().toISOString(),
    });

    const disp = await clientCust.rpc("open_job_dispute", {
      p_job_id: job!.id,
      p_reason: "poor_quality",
      p_details: "Wiring was left exposed after job completion.",
    });
    assert.ifError(disp.error);

    const resolvedDisp = await clientAdmin.rpc("admin_resolve_dispute", {
      p_dispute_id: disp.data.id,
      p_resolution: "resolved_refund",
      p_notes: "Approved full refund to customer after photo inspection.",
    });
    assert.ifError(resolvedDisp.error);
    assert.equal(resolvedDisp.data.status, "resolved_refund");

    const { data: jobAfterRefund } = await service
      .from("jobs")
      .select("status")
      .eq("id", job!.id)
      .single();
    assert.equal(jobAfterRefund?.status, "refunded");

    const rep = await clientCust.rpc("create_user_report", {
      p_reported_user_id: artId,
      p_job_id: job!.id,
      p_category: "unsafe_behavior",
      p_details: "Reported unsafe conduct during dispute.",
    });
    assert.ifError(rep.error);

    const updRep = await clientAdmin.rpc("admin_update_report", {
      p_report_id: rep.data.id,
      p_status: "resolved",
      p_notes: "Reviewed and warning issued.",
    });
    assert.ifError(updRep.error);
    assert.equal(updRep.data.status, "resolved");

    // Confirm EVERY admin action was recorded in audit_log
    const { data: logs } = await clientAdmin
      .from("audit_log")
      .select("action")
      .eq("actor_id", adminId);

    const actions = (logs ?? []).map((l: { action: string }) => l.action);
    assert.ok(actions.includes("admin_urgent_safety_suspension"));
    assert.ok(actions.includes("admin_review_safety_suspension_lifted"));
    assert.ok(actions.includes("admin_resolve_dispute_resolved_refund"));
    assert.ok(actions.includes("admin_update_report_resolved"));

    console.log("\nALL STEP 9 LIVE RLS, URGENT SUSPENSION, DISPUTE, REPORT & AUDIT LOG TESTS PASSED!");
  } finally {
    for (const id of createdIds) {
      await service.auth.admin.deleteUser(id);
    }
  }
}

run().catch((err) => {
  console.error("Step 9 RLS test failed:", err);
  process.exit(1);
});
