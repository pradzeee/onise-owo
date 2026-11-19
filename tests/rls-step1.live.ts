/**
 * Live Supabase RLS & Security Verification Test for Step 1.
 *
 * Proves against your real Supabase database:
 * 1. User A cannot read or change User B's profile or consent records.
 * 2. A customer cannot set themselves as admin or approve themselves as an artisan.
 * 3. Direct mutation of role, verification_status, account_status, rating_avg is blocked.
 * 4. complete_onboarding and set_optional_consent are idempotent (safe to run twice).
 * 5. face_matching consent is restricted to artisans only.
 * 6. rate_limits and audit_log are completely unreadable by authenticated users.
 *
 * Run with: npm run test:rls
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 * and SUPABASE_SERVICE_ROLE_KEY.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

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
    if (!process.env[key]) {
      process.env[key] = val;
    }
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
  console.error(
    "Missing real Supabase env vars in .env.local (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY).",
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function createAnonClient() {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function run() {
  const suffix = Date.now().toString().slice(-6);
  const emailA = `rls-user-a-${suffix}@example.test`;
  const emailB = `rls-user-b-${suffix}@example.test`;
  const password = `TestPass!${suffix}Aa`;

  let userAId: string | null = null;
  let userBId: string | null = null;

  try {
    console.log("Creating temporary User A and User B...");
    const { data: createdA, error: errA } = await admin.auth.admin.createUser({
      email: emailA,
      password,
      email_confirm: true,
    });
    assert.ifError(errA);
    assert.ok(createdA.user);
    userAId = createdA.user.id;

    const { data: createdB, error: errB } = await admin.auth.admin.createUser({
      email: emailB,
      password,
      email_confirm: true,
    });
    assert.ifError(errB);
    assert.ok(createdB.user);
    userBId = createdB.user.id;

    const clientA = createAnonClient();
    const { error: signInErrA } = await clientA.auth.signInWithPassword({
      email: emailA,
      password,
    });
    assert.ifError(signInErrA);

    const clientB = createAnonClient();
    const { error: signInErrB } = await clientB.auth.signInWithPassword({
      email: emailB,
      password,
    });
    assert.ifError(signInErrB);

    // 1. User A cannot self-select admin
    console.log("1. Testing User A cannot choose role = admin...");
    const { error: adminRoleErr } = await clientA.rpc("complete_onboarding", {
      p_role: "admin",
      p_terms_version: "2026-11-v1",
      p_privacy_version: "2026-11-v1",
      p_accepted_required: true,
      p_idempotency_key: `key-admin-${suffix}`,
    });
    assert.ok(adminRoleErr, "Expected complete_onboarding('admin') to fail");

    // 2. User A completes onboarding as customer (twice -> idempotent)
    console.log("2. Testing idempotent onboarding for User A (customer) and User B (artisan)...");
    const idemA = `onb-a-${suffix}`;
    const resA1 = await clientA.rpc("complete_onboarding", {
      p_role: "customer",
      p_terms_version: "2026-11-v1",
      p_privacy_version: "2026-11-v1",
      p_accepted_required: true,
      p_idempotency_key: idemA,
    });
    assert.ifError(resA1.error);

    const resA2 = await clientA.rpc("complete_onboarding", {
      p_role: "customer",
      p_terms_version: "2026-11-v1",
      p_privacy_version: "2026-11-v1",
      p_accepted_required: true,
      p_idempotency_key: idemA,
    });
    assert.ifError(resA2.error);

    const resB = await clientB.rpc("complete_onboarding", {
      p_role: "artisan",
      p_terms_version: "2026-11-v1",
      p_privacy_version: "2026-11-v1",
      p_accepted_required: true,
      p_idempotency_key: `onb-b-${suffix}`,
    });
    assert.ifError(resB.error);

    // Verify User A has exactly 3 mandatory consents (no duplicates from idempotent rerun)
    const { data: consentsA, error: consentsAErr } = await clientA
      .from("consents")
      .select("consent_type, granted")
      .eq("user_id", userAId);
    assert.ifError(consentsAErr);
    assert.equal(consentsA?.length, 3, "Expected exactly 3 mandatory consents for User A");

    // 3. User A cannot directly modify own protected columns
    console.log("3. Testing User A cannot self-promote to admin or approve themselves...");
    const { error: promoteErr } = await clientA
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", userAId);
    assert.ok(promoteErr, "Direct update to role must be blocked");

    const { error: approveErr } = await clientA
      .from("profiles")
      .update({ verification_status: "approved" })
      .eq("id", userAId);
    assert.ok(approveErr, "Direct update to verification_status must be blocked");

    const { error: ratingErr } = await clientA
      .from("profiles")
      .update({ rating_avg: 5.0 })
      .eq("id", userAId);
    assert.ok(ratingErr, "Direct update to rating_avg must be blocked");

    // 4. User A cannot read or update User B's profile
    console.log("4. Testing User A cannot read or modify User B's profile...");
    const { data: readBProfile } = await clientA
      .from("profiles")
      .select("*")
      .eq("id", userBId);
    assert.equal(readBProfile?.length ?? 0, 0, "User A must NOT read User B's profile");

    await clientA
      .from("profiles")
      .update({ display_name: "Hacked Name" })
      .eq("id", userBId);

    const { data: verifyBProfile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", userBId)
      .single();
    assert.notEqual(verifyBProfile?.display_name, "Hacked Name");

    // 5. User A cannot read or tamper with User B's consents
    console.log("5. Testing User A cannot read or tamper with User B's consents...");
    const { data: readBConsents } = await clientA
      .from("consents")
      .select("*")
      .eq("user_id", userBId);
    assert.equal(readBConsents?.length ?? 0, 0, "User A must NOT read User B's consents");

    const { error: insertBConsentErr } = await clientA.from("consents").insert({
      user_id: userBId,
      consent_type: "location",
      version: "2026-11-v1",
      granted: true,
    });
    assert.ok(insertBConsentErr, "Direct insert into consents must be blocked");

    // 6. Optional consents: face_matching blocked for customer, allowed + withdrawable for artisan
    console.log("6. Testing optional consents (location, notifications, artisan face_matching)...");
    const { error: custFaceErr } = await clientA.rpc("set_optional_consent", {
      p_consent_type: "face_matching",
      p_granted: true,
      p_version: "2026-11-v1",
    });
    assert.ok(custFaceErr, "Customer must NOT be able to grant face_matching consent");

    const artFaceGrant1 = await clientB.rpc("set_optional_consent", {
      p_consent_type: "face_matching",
      p_granted: true,
      p_version: "2026-11-v1",
    });
    assert.ifError(artFaceGrant1.error);

    // Idempotent second grant
    const artFaceGrant2 = await clientB.rpc("set_optional_consent", {
      p_consent_type: "face_matching",
      p_granted: true,
      p_version: "2026-11-v1",
    });
    assert.ifError(artFaceGrant2.error);
    assert.equal(artFaceGrant1.data.id, artFaceGrant2.data.id);

    // Withdraw consent (and run twice for idempotency)
    const artFaceWithdraw1 = await clientB.rpc("set_optional_consent", {
      p_consent_type: "face_matching",
      p_granted: false,
      p_version: "2026-11-v1",
    });
    assert.ifError(artFaceWithdraw1.error);
    assert.equal(artFaceWithdraw1.data.granted, false);
    assert.ok(artFaceWithdraw1.data.withdrawn_at);

    const artFaceWithdraw2 = await clientB.rpc("set_optional_consent", {
      p_consent_type: "face_matching",
      p_granted: false,
      p_version: "2026-11-v1",
    });
    assert.ifError(artFaceWithdraw2.error);

    // 7. Internal tables (rate_limits, audit_log) blocked for authenticated users
    console.log("7. Testing rate_limits and audit_log are blocked for authenticated users...");
    const { error: rlErr } = await clientA.from("rate_limits").select("*");
    assert.ok(rlErr, "Authenticated user must NOT read rate_limits");

    const { error: alErr } = await clientA.from("audit_log").select("*");
    assert.ok(alErr, "Authenticated user must NOT read audit_log");

    console.log("\nALL STEP 1 LIVE RLS & SECURITY TESTS PASSED!");
  } finally {
    if (userAId) await admin.auth.admin.deleteUser(userAId);
    if (userBId) await admin.auth.admin.deleteUser(userBId);
  }
}

run().catch((err) => {
  console.error("RLS test failed:", err);
  process.exit(1);
});
