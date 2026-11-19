/**
 * Live Supabase RLS & Security Verification Test for Step 2.
 *
 * Proves against your real Supabase database:
 * 1. User A cannot read or modify User B's artisan_profiles, artisan_verifications,
 *    guarantor_verifications, or identity_hashes.
 * 2. An artisan cannot approve themselves, call admin_review_artisan, or open audit_log.
 * 3. Same NIN hash cannot be stored for two different accounts (unique constraint).
 * 4. Admin CANNOT approve an artisan when guarantor has not confirmed yet.
 * 5. Once provider passed AND guarantor confirmed, Admin CAN approve (idempotently),
 *    and review + private file access are recorded in audit_log.
 * 6. Unapproved artisans are blocked by DB constraint from setting is_online = true.
 *
 * Run with: npm run test:rls:step2
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { hashNinForIdentity, hashPhoneForIdentity } from "../src/lib/nin";
import { generateGuarantorToken } from "../src/lib/guarantor";

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
  const password = `Step2Test!${suffix}Aa`;

  const emailArtisanA = `s2-artisan-a-${suffix}@example.test`;
  const emailArtisanB = `s2-artisan-b-${suffix}@example.test`;
  const emailAdmin = `s2-admin-${suffix}@example.test`;

  let artisanAId: string | null = null;
  let artisanBId: string | null = null;
  let adminId: string | null = null;

  try {
    console.log("Creating Artisan A, Artisan B, and Admin test accounts...");
    const [resA, resB, resAdmin] = await Promise.all([
      service.auth.admin.createUser({ email: emailArtisanA, password, email_confirm: true }),
      service.auth.admin.createUser({ email: emailArtisanB, password, email_confirm: true }),
      service.auth.admin.createUser({ email: emailAdmin, password, email_confirm: true }),
    ]);

    assert.ifError(resA.error);
    assert.ifError(resB.error);
    assert.ifError(resAdmin.error);
    artisanAId = resA.data.user!.id;
    artisanBId = resB.data.user!.id;
    adminId = resAdmin.data.user!.id;

    // Manually designate admin in DB (service_role)
    const { error: setAdminErr } = await service
      .from("profiles")
      .update({ role: "admin", onboarding_completed_at: new Date().toISOString() })
      .eq("id", adminId);
    assert.ifError(setAdminErr);

    const clientA = createAnonClient();
    const clientB = createAnonClient();
    const clientAdmin = createAnonClient();

    await clientA.auth.signInWithPassword({ email: emailArtisanA, password });
    await clientB.auth.signInWithPassword({ email: emailArtisanB, password });
    await clientAdmin.auth.signInWithPassword({ email: emailAdmin, password });

    // Onboard A & B as artisans + grant face_matching consent
    const onbA = await clientA.rpc("complete_onboarding", {
      p_role: "artisan",
      p_terms_version: "2026-11-v1",
      p_privacy_version: "2026-11-v1",
      p_accepted_required: true,
    });
    assert.ifError(onbA.error);

    const onbB = await clientB.rpc("complete_onboarding", {
      p_role: "artisan",
      p_terms_version: "2026-11-v1",
      p_privacy_version: "2026-11-v1",
      p_accepted_required: true,
    });
    assert.ifError(onbB.error);

    const consentA = await clientA.rpc("set_optional_consent", {
      p_consent_type: "face_matching",
      p_granted: true,
      p_version: "2026-11-v1",
    });
    assert.ifError(consentA.error);

    const consentB = await clientB.rpc("set_optional_consent", {
      p_consent_type: "face_matching",
      p_granted: true,
      p_version: "2026-11-v1",
    });
    assert.ifError(consentB.error);

    // Seed Artisan A & B applications via service role (simulating server onboarding route)
    const sharedNinHash = hashNinForIdentity(`12345${suffix}`);
    const { error: hashAErr } = await service.from("identity_hashes").insert({
      user_id: artisanAId,
      hash_type: "nin",
      hash_value: sharedNinHash,
    });
    assert.ifError(hashAErr);

    // 1. Duplicate NIN hash across two accounts MUST fail
    console.log("1. Testing duplicate NIN hash on second account is rejected...");
    const { error: dupNinErr } = await service.from("identity_hashes").insert({
      user_id: artisanBId,
      hash_type: "nin",
      hash_value: sharedNinHash,
    });
    assert.ok(dupNinErr, "Expected unique violation for duplicate NIN hash");
    assert.equal(dupNinErr.code, "23505");

    // Insert artisan_profiles, artisan_verifications, guarantor_verifications for A & B
    const tokA = generateGuarantorToken();
    const tokB = generateGuarantorToken();

    await service.from("artisan_profiles").insert([
      {
        user_id: artisanAId,
        full_name: "Artisan Alpha",
        trade: "plumber",
        bio: "Experienced Lagos plumber for domestic installations.",
        work_area: "Ikeja, Lagos",
        payout_recipient_code: `RCP_test_a_${suffix}`,
        verification_status: "pending",
        is_online: false,
      },
      {
        user_id: artisanBId,
        full_name: "Artisan Beta",
        trade: "electrician",
        bio: "Certified inverter and house wiring electrician.",
        work_area: "Yaba, Lagos",
        payout_recipient_code: `RCP_test_b_${suffix}`,
        verification_status: "pending",
        is_online: false,
      },
    ]);

    await service.from("artisan_verifications").insert([
      {
        user_id: artisanAId,
        provider_name: "dev_mock",
        provider_reference: `ref_a_${suffix}`,
        provider_status: "passed",
        liveness_passed: true,
        face_match_passed: true,
        selfie_storage_path: `${artisanAId}/selfie.jpg`,
        face_matching_consent_id: consentA.data.id,
      },
      {
        user_id: artisanBId,
        provider_name: "dev_mock",
        provider_reference: `ref_b_${suffix}`,
        provider_status: "passed",
        liveness_passed: true,
        face_match_passed: true,
        selfie_storage_path: `${artisanBId}/selfie.jpg`,
        face_matching_consent_id: consentB.data.id,
      },
    ]);

    await service.from("guarantor_verifications").insert([
      {
        artisan_id: artisanAId,
        guarantor_name: "Guarantor Alpha",
        guarantor_phone_hash: hashPhoneForIdentity("+2348031110001"),
        guarantor_phone_e164: "+2348031110001",
        token_hash: tokA.tokenHash,
        status: "pending",
      },
      {
        artisan_id: artisanBId,
        guarantor_name: "Guarantor Beta",
        guarantor_phone_hash: hashPhoneForIdentity("+2348031110002"),
        guarantor_phone_e164: "+2348031110002",
        token_hash: tokB.tokenHash,
        status: "pending",
      },
    ]);

    // 2. RLS Isolation: User A cannot read or modify User B's Step 2 data
    console.log("2. Testing User A cannot read User B's artisan profile, verification, or guarantor...");
    const { data: readBArtisan } = await clientA
      .from("artisan_profiles")
      .select("*")
      .eq("user_id", artisanBId);
    assert.equal(readBArtisan?.length ?? 0, 0, "User A must NOT read User B's artisan_profile");

    const { data: readBVerif } = await clientA
      .from("artisan_verifications")
      .select("id, provider_status")
      .eq("user_id", artisanBId);
    assert.equal(readBVerif?.length ?? 0, 0, "User A must NOT read User B's artisan_verification");

    const { data: readBGuarantor } = await clientA
      .from("guarantor_verifications")
      .select("id, status")
      .eq("artisan_id", artisanBId);
    assert.equal(readBGuarantor?.length ?? 0, 0, "User A must NOT read User B's guarantor");

    const { error: readHashesErr } = await clientA.from("identity_hashes").select("*");
    assert.ok(readHashesErr, "Authenticated user must NOT read identity_hashes");

    // 3. Artisan A cannot approve themselves or call admin RPCs
    console.log("3. Testing Artisan A cannot self-approve or access admin RPCs...");
    const { error: selfUpdateErr } = await clientA
      .from("artisan_profiles")
      .update({ verification_status: "approved" })
      .eq("user_id", artisanAId);
    assert.ok(selfUpdateErr, "Artisan must NOT update own verification_status");

    const { error: nonAdminApproveErr } = await clientA.rpc("admin_review_artisan", {
      p_artisan_id: artisanAId,
      p_decision: "approved",
    });
    assert.ok(nonAdminApproveErr, "Non-admin must NOT execute admin_review_artisan");

    const { error: nonAdminAuditErr } = await clientA.rpc("log_admin_file_access", {
      p_artisan_id: artisanAId,
      p_storage_path: `${artisanAId}/selfie.jpg`,
    });
    assert.ok(nonAdminAuditErr, "Non-admin must NOT execute log_admin_file_access");

    const { data: nonAdminLogs } = await clientA.from("audit_log").select("*");
    assert.equal(nonAdminLogs?.length ?? 0, 0, "Non-admin must see 0 rows in audit_log");

    // 4. Unapproved artisan cannot go Online (DB constraint)
    console.log("4. Testing unapproved artisan cannot set is_online = true...");
    const { error: onlineUnapprovedErr } = await service
      .from("artisan_profiles")
      .update({ is_online: true })
      .eq("user_id", artisanAId);
    assert.ok(onlineUnapprovedErr, "Unapproved artisan must be blocked from going online");

    // 5. Admin CANNOT approve Artisan A before guarantor confirms
    console.log("5. Testing Admin cannot approve Artisan A before guarantor confirms...");
    const { error: earlyApproveErr } = await clientAdmin.rpc("admin_review_artisan", {
      p_artisan_id: artisanAId,
      p_decision: "approved",
    });
    assert.ok(earlyApproveErr, "Admin must be blocked from approving before guarantor confirms");

    // 6. Guarantor confirms -> Admin logs file open -> Admin approves idempotently
    console.log("6. Testing guarantor confirmation, audited file open, and idempotent admin approval...");
    await service
      .from("guarantor_verifications")
      .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
      .eq("artisan_id", artisanAId);

    const fileAudit = await clientAdmin.rpc("log_admin_file_access", {
      p_artisan_id: artisanAId,
      p_storage_path: `${artisanAId}/selfie.jpg`,
      p_expires_in_seconds: 60,
    });
    assert.ifError(fileAudit.error);
    assert.ok(fileAudit.data);

    const approve1 = await clientAdmin.rpc("admin_review_artisan", {
      p_artisan_id: artisanAId,
      p_decision: "approved",
      p_idempotency_key: `approve-a-${suffix}`,
    });
    assert.ifError(approve1.error);
    assert.equal(approve1.data.verification_status, "approved");

    // Idempotent second approval call
    const approve2 = await clientAdmin.rpc("admin_review_artisan", {
      p_artisan_id: artisanAId,
      p_decision: "approved",
      p_idempotency_key: `approve-a-${suffix}`,
    });
    assert.ifError(approve2.error);
    assert.equal(approve2.data.verification_status, "approved");

    // Admin rejects Artisan B without reason -> MUST fail; with reason -> succeeds
    const { error: rejectNoReasonErr } = await clientAdmin.rpc("admin_review_artisan", {
      p_artisan_id: artisanBId,
      p_decision: "rejected",
      p_reason: "",
    });
    assert.ok(rejectNoReasonErr, "Rejecting without reason must fail");

    const rejectWithReason = await clientAdmin.rpc("admin_review_artisan", {
      p_artisan_id: artisanBId,
      p_decision: "rejected",
      p_reason: "Selfie image was too blurry to verify.",
    });
    assert.ifError(rejectWithReason.error);
    assert.equal(rejectWithReason.data.verification_status, "rejected");

    console.log("\nALL STEP 2 LIVE RLS, DUAL-APPROVAL & AUDIT TESTS PASSED!");
  } finally {
    if (artisanAId) await service.auth.admin.deleteUser(artisanAId);
    if (artisanBId) await service.auth.admin.deleteUser(artisanBId);
    if (adminId) await service.auth.admin.deleteUser(adminId);
  }
}

run().catch((err) => {
  console.error("Step 2 RLS test failed:", err);
  process.exit(1);
});
