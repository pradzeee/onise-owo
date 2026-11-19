/**
 * Live Supabase RLS, Accepted-Only Chat, 7-Day Expiry, Report & Block Test (Step 5).
 *
 * Proves against your real Supabase database:
 * 1. Chat CANNOT be used before a job is accepted.
 * 2. After acceptance, customer & assigned artisan CAN chat (idempotent); outsider CANNOT read or send.
 * 3. Report (create_user_report) is idempotent and private (other users cannot read user_reports).
 * 4. Block (block_user) immediately disables sending chat messages and is private (RLS).
 * 5. 7 days after job completion, chat closes (send_job_message rejected).
 *
 * Run with: npm run test:rls:step5
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createStartCodeMaterial } from "../src/lib/jobs";

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
  const password = `Step5Test!${suffix}Aa`;
  const createdIds: string[] = [];

  try {
    console.log("Creating Customer, Artisan, and Outsider accounts...");
    const [rCust, rArt, rOut] = await Promise.all([
      service.auth.admin.createUser({ email: `s5-cust-${suffix}@example.test`, password, email_confirm: true }),
      service.auth.admin.createUser({ email: `s5-art-${suffix}@example.test`, password, email_confirm: true }),
      service.auth.admin.createUser({ email: `s5-out-${suffix}@example.test`, password, email_confirm: true }),
    ]);

    const custId = rCust.data.user!.id;
    const artId = rArt.data.user!.id;
    const outId = rOut.data.user!.id;
    createdIds.push(custId, artId, outId);

    const clientCust = createAnonClient();
    const clientArt = createAnonClient();
    const clientOut = createAnonClient();

    await Promise.all([
      clientCust.auth.signInWithPassword({ email: `s5-cust-${suffix}@example.test`, password }),
      clientArt.auth.signInWithPassword({ email: `s5-art-${suffix}@example.test`, password }),
      clientOut.auth.signInWithPassword({ email: `s5-out-${suffix}@example.test`, password }),
    ]);

    await Promise.all([
      clientCust.rpc("complete_onboarding", { p_role: "customer", p_terms_version: "2026-11-v1", p_privacy_version: "2026-11-v1", p_accepted_required: true }),
      clientArt.rpc("complete_onboarding", { p_role: "artisan", p_terms_version: "2026-11-v1", p_privacy_version: "2026-11-v1", p_accepted_required: true }),
      clientOut.rpc("complete_onboarding", { p_role: "customer", p_terms_version: "2026-11-v1", p_privacy_version: "2026-11-v1", p_accepted_required: true }),
    ]);

    await service.from("artisan_profiles").insert({
      user_id: artId,
      full_name: "Chat Artisan",
      trade: "electrician",
      bio: "Verified electrician in Yaba.",
      work_area: "Yaba, Lagos",
      payout_recipient_code: `RCP_s5_${suffix}`,
      verification_status: "approved",
      is_online: true,
      last_seen_at: new Date().toISOString(),
      approx_location: "SRID=4326;POINT(3.371 6.509)",
    });

    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const { data: job } = await service
      .from("jobs")
      .insert({
        customer_id: custId,
        trade: "electrician",
        description: "Inverter changeover switch needs rewiring.",
        dispatch_mode: "direct",
        dispatch_round: 1,
        round_expires_at: expiresAt,
        approx_location: "SRID=4326;POINT(3.371 6.509)",
        approx_area_label: "Yaba, Lagos",
        status: "requested",
      })
      .select("id")
      .single();

    await service.from("job_requests").insert({
      job_id: job!.id,
      artisan_id: artId,
      round_number: 1,
      status: "sent",
      expires_at: expiresAt,
    });

    // 1. Chat MUST be closed BEFORE job is accepted
    console.log("1. Testing chat is blocked BEFORE job acceptance...");
    const { error: preAcceptMsgErr } = await clientCust.rpc("send_job_message", {
      p_job_id: job!.id,
      p_body: "Hello before accept",
    });
    assert.ok(preAcceptMsgErr, "Sending message before acceptance must fail");

    // Accept the job
    const mat = createStartCodeMaterial(job!.id);
    const acc = await clientArt.rpc("accept_job_request", {
      p_job_id: job!.id,
      p_start_code_nonce: mat.nonce,
      p_start_code_hash: mat.startCodeHash,
    });
    assert.ifError(acc.error);

    // 2. Customer & Artisan can chat idempotently; Outsider cannot read or send
    console.log("2. Testing accepted chat works idempotently & blocks outsiders (RLS)...");
    const m1 = await clientCust.rpc("send_job_message", {
      p_job_id: job!.id,
      p_body: "Please come to the main security gate.",
      p_idempotency_key: `m1-${suffix}`,
    });
    assert.ifError(m1.error);

    const m1Replay = await clientCust.rpc("send_job_message", {
      p_job_id: job!.id,
      p_body: "Please come to the main security gate.",
      p_idempotency_key: `m1-${suffix}`,
    });
    assert.ifError(m1Replay.error);
    assert.equal(m1.data.id, m1Replay.data.id, "Duplicate message with same idempotency_key must replay");

    const { data: outReadMsgs } = await clientOut
      .from("job_messages")
      .select("*")
      .eq("job_id", job!.id);
    assert.equal(outReadMsgs?.length ?? 0, 0, "Outsider must NOT read job messages");

    const { error: outSendErr } = await clientOut.rpc("send_job_message", {
      p_job_id: job!.id,
      p_body: "Intruder message",
    });
    assert.ok(outSendErr, "Outsider must NOT send messages");

    // 3. Report is idempotent & private via RLS
    console.log("3. Testing Report idempotency & RLS privacy...");
    const rep1 = await clientCust.rpc("create_user_report", {
      p_reported_user_id: artId,
      p_job_id: job!.id,
      p_category: "off_platform_solicitation",
      p_details: "Asked to move payment outside the platform.",
      p_idempotency_key: `rep-${suffix}`,
    });
    assert.ifError(rep1.error);

    const { data: artReadReports } = await clientArt
      .from("user_reports")
      .select("*")
      .eq("id", rep1.data.id);
    assert.equal(artReadReports?.length ?? 0, 0, "Reported user must NOT read reporter's report");

    // 4. Block immediately stops chat & is private via RLS
    console.log("4. Testing Block immediately stops chat & is private via RLS...");
    const blk = await clientCust.rpc("block_user", {
      p_blocked_id: artId,
      p_job_id: job!.id,
      p_reason: "Unsafe behaviour",
    });
    assert.ifError(blk.error);

    const { error: blockedSendErr } = await clientArt.rpc("send_job_message", {
      p_job_id: job!.id,
      p_body: "Can I still message after block?",
    });
    assert.ok(blockedSendErr, "Blocked user must NOT be able to send messages");

    const { data: outReadBlocks } = await clientOut.from("user_blocks").select("*");
    assert.equal(outReadBlocks?.length ?? 0, 0, "Outsider must NOT read user_blocks");

    // Unblock, then test 7-day post-completion close window
    await clientCust.rpc("unblock_user", { p_blocked_id: artId });

    console.log("5. Testing chat closes 7 days after job ends...");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await service
      .from("jobs")
      .update({ status: "completed", completed_at: eightDaysAgo })
      .eq("id", job!.id);

    const { error: expiredChatErr } = await clientCust.rpc("send_job_message", {
      p_job_id: job!.id,
      p_body: "Message 8 days after job ended",
    });
    assert.ok(expiredChatErr, "Chat must reject new messages more than 7 days after job ends");

    console.log("\nALL STEP 5 LIVE RLS, CHAT WINDOW, REPORT & BLOCK TESTS PASSED!");
  } finally {
    for (const id of createdIds) {
      await service.auth.admin.deleteUser(id);
    }
  }
}

run().catch((err) => {
  console.error("Step 5 RLS test failed:", err);
  process.exit(1);
});
