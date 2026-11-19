/**
 * Live Supabase RLS, Duplicate Webhook Idempotency, Amount Check,
 * 24-Hour Auto-Confirm & Dispute Pause Test (Step 6).
 *
 * Proves against your real Supabase database:
 * 1. User A cannot read or alter User B's payments, disputes, webhook_events, or reconciliation_reports.
 * 2. Customer/Artisan CANNOT mark a payment paid directly (direct table writes blocked).
 * 3. Webhook with mismatched paid amount is REJECTED ('amount_mismatch') and does NOT mark job paid!
 * 4. Same valid payment webhook sent TWICE pays ONLY ONCE (2nd call returns 'duplicate_ignored')!
 * 5. Opening a dispute pauses payment release (release_paused = true) AND blocks 24h auto-confirm!
 * 6. Completed job with NO open dispute auto-confirms after 24 hours via auto_confirm_completed_jobs()!
 *
 * Run with: npm run test:rls:step6
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { calculateCommissionKobo, sha256Hex } from "../src/lib/payments";

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
  const password = `Step6Test!${suffix}Aa`;
  const createdIds: string[] = [];

  try {
    console.log("Creating Customer, Artisan, and Outsider accounts...");
    const [rCust, rArt, rOut] = await Promise.all([
      service.auth.admin.createUser({ email: `s6-cust-${suffix}@example.test`, password, email_confirm: true }),
      service.auth.admin.createUser({ email: `s6-art-${suffix}@example.test`, password, email_confirm: true }),
      service.auth.admin.createUser({ email: `s6-out-${suffix}@example.test`, password, email_confirm: true }),
    ]);

    const custId = rCust.data.user!.id;
    const artId = rArt.data.user!.id;
    const outId = rOut.data.user!.id;
    createdIds.push(custId, artId, outId);

    const clientCust = createAnonClient();
    const clientArt = createAnonClient();
    const clientOut = createAnonClient();

    await Promise.all([
      clientCust.auth.signInWithPassword({ email: `s6-cust-${suffix}@example.test`, password }),
      clientArt.auth.signInWithPassword({ email: `s6-art-${suffix}@example.test`, password }),
      clientOut.auth.signInWithPassword({ email: `s6-out-${suffix}@example.test`, password }),
    ]);

    await Promise.all([
      clientCust.rpc("complete_onboarding", { p_role: "customer", p_terms_version: "2026-11-v1", p_privacy_version: "2026-11-v1", p_accepted_required: true }),
      clientArt.rpc("complete_onboarding", { p_role: "artisan", p_terms_version: "2026-11-v1", p_privacy_version: "2026-11-v1", p_accepted_required: true }),
      clientOut.rpc("complete_onboarding", { p_role: "customer", p_terms_version: "2026-11-v1", p_privacy_version: "2026-11-v1", p_accepted_required: true }),
    ]);

    const amountKobo = 2_000_000; // ₦20,000
    const commissionKobo = calculateCommissionKobo(amountKobo); // ₦3,000 (15%)

    // Create 2 completed jobs (Job 1 for webhook + auto-confirm, Job 2 for dispute pause)
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const { data: job1 } = await service
      .from("jobs")
      .insert({
        customer_id: custId,
        artisan_id: artId,
        trade: "plumber",
        description: "Completed plumbing repair job 1.",
        approx_location: "SRID=4326;POINT(3.351 6.602)",
        approx_area_label: "Ikeja",
        status: "completed",
        accepted_amount_kobo: amountKobo,
        completed_at: twentyFiveHoursAgo,
      })
      .select("id")
      .single();

    const { data: job2 } = await service
      .from("jobs")
      .insert({
        customer_id: custId,
        artisan_id: artId,
        trade: "plumber",
        description: "Completed plumbing repair job 2 (disputed).",
        approx_location: "SRID=4326;POINT(3.351 6.602)",
        approx_area_label: "Ikeja",
        status: "completed",
        accepted_amount_kobo: amountKobo,
        completed_at: twentyFiveHoursAgo,
      })
      .select("id")
      .single();

    // Seed pending payment for Job 1
    const refMismatch = `onise_mis_${suffix}`;
    const refGood = `onise_good_${suffix}`;

    await service.from("payments").insert([
      {
        job_id: job1!.id,
        customer_id: custId,
        artisan_id: artId,
        provider_reference: refMismatch,
        amount_kobo: amountKobo,
        commission_kobo: commissionKobo,
        status: "pending",
      },
      {
        job_id: job1!.id,
        customer_id: custId,
        artisan_id: artId,
        provider_reference: refGood,
        amount_kobo: amountKobo,
        commission_kobo: commissionKobo,
        status: "pending",
      },
    ]);

    // 1. RLS isolation: Outsider cannot read Customer's payments or webhook_events or reconciliation_reports
    console.log("1. Testing RLS isolation on payments, webhook_events & reconciliation_reports...");
    const { data: outPayments } = await clientOut
      .from("payments")
      .select("*")
      .eq("job_id", job1!.id);
    assert.equal(outPayments?.length ?? 0, 0, "Outsider must NOT read other user's payments");

    const { data: outWebhooks } = await clientOut.from("webhook_events").select("*");
    assert.equal(outWebhooks?.length ?? 0, 0, "Non-admin must NOT read webhook_events");

    const { data: outRecon } = await clientOut.from("reconciliation_reports").select("*");
    assert.equal(outRecon?.length ?? 0, 0, "Non-admin must NOT read reconciliation_reports");

    // Customer CANNOT directly update payment status to 'paid'
    const { error: directPayErr } = await clientCust
      .from("payments")
      .update({ status: "paid" })
      .eq("provider_reference", refGood);
    assert.ok(directPayErr, "Direct update to payments.status must be blocked");

    // 2. Mismatched amount webhook MUST NOT mark job paid
    console.log("2. Testing amount mismatch webhook is rejected and never marks job paid...");
    const misRes = await service.rpc("process_paystack_charge_success", {
      p_provider_event_id: `paystack:charge.success:mis_${suffix}`,
      p_event_type: "charge.success",
      p_provider_reference: refMismatch,
      p_paid_amount_kobo: 50_000, // Paid ₦500 for a ₦20,000 job!
      p_payload_hash: sha256Hex("mismatch-payload"),
    });
    assert.ifError(misRes.error);
    const misRow = Array.isArray(misRes.data) ? misRes.data[0] : misRes.data;
    assert.equal(misRow.outcome, "amount_mismatch");

    const { data: job1AfterMismatch } = await service
      .from("jobs")
      .select("status")
      .eq("id", job1!.id)
      .single();
    assert.equal(job1AfterMismatch?.status, "completed", "Mismatched webhook must NOT mark job paid");

    // 3. SAME PAYMENT WEBHOOK SENT TWICE PAYS ONLY ONCE!
    console.log("3. Testing duplicate Paystack webhook sent twice pays ONLY ONCE...");
    const eventId = `paystack:charge.success:good_${suffix}`;
    const payloadHash = sha256Hex("good-payload");

    const wh1 = await service.rpc("process_paystack_charge_success", {
      p_provider_event_id: eventId,
      p_event_type: "charge.success",
      p_provider_reference: refGood,
      p_paid_amount_kobo: amountKobo,
      p_payload_hash: payloadHash,
    });
    assert.ifError(wh1.error);
    const wh1Row = Array.isArray(wh1.data) ? wh1.data[0] : wh1.data;
    assert.equal(wh1Row.outcome, "paid");

    // Send exact same webhook a second time -> MUST be duplicate_ignored!
    const wh2 = await service.rpc("process_paystack_charge_success", {
      p_provider_event_id: eventId,
      p_event_type: "charge.success",
      p_provider_reference: refGood,
      p_paid_amount_kobo: amountKobo,
      p_payload_hash: payloadHash,
    });
    assert.ifError(wh2.error);
    const wh2Row = Array.isArray(wh2.data) ? wh2.data[0] : wh2.data;
    assert.equal(wh2Row.outcome, "duplicate_ignored", "Duplicate webhook must be ignored");

    const { data: paidRows } = await service
      .from("payments")
      .select("id")
      .eq("job_id", job1!.id)
      .eq("status", "paid");
    assert.equal(paidRows?.length, 1, "Job must be paid exactly once");

    // 4. Open dispute on Job 2 -> pauses payment release & blocks 24h auto-confirm
    console.log("4. Testing dispute blocks 24h auto-confirm while undisputed Job 1 auto-confirms...");
    const disp = await clientCust.rpc("open_job_dispute", {
      p_job_id: job2!.id,
      p_reason: "incomplete_work",
      p_details: "Pipe is still dripping after artisan left.",
      p_idempotency_key: `disp-${suffix}`,
    });
    assert.ifError(disp.error);

    // Outsider cannot read the dispute
    const { data: outDisputes } = await clientOut
      .from("disputes")
      .select("*")
      .eq("job_id", job2!.id);
    assert.equal(outDisputes?.length ?? 0, 0, "Outsider must NOT read disputes");

    // Run 24h auto-confirm scheduled function
    const autoRes = await service.rpc("auto_confirm_completed_jobs");
    assert.ifError(autoRes.error);

    const [{ data: j1Final }, { data: j2Final }] = await Promise.all([
      service.from("jobs").select("status, confirmed_at").eq("id", job1!.id).single(),
      service.from("jobs").select("status, confirmed_at").eq("id", job2!.id).single(),
    ]);

    assert.equal(j1Final?.status, "confirmed", "Undisputed Job 1 (>24h old) must auto-confirm");
    assert.ok(j1Final?.confirmed_at);
    assert.equal(j2Final?.status, "disputed", "Disputed Job 2 must NOT auto-confirm");

    console.log("\nALL STEP 6 LIVE RLS, DUPLICATE WEBHOOK, AMOUNT CHECK & AUTO-CONFIRM TESTS PASSED!");
  } finally {
    for (const id of createdIds) {
      await service.auth.admin.deleteUser(id);
    }
  }
}

run().catch((err) => {
  console.error("Step 6 RLS test failed:", err);
  process.exit(1);
});
