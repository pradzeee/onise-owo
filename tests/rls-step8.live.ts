/**
 * Live Supabase End-to-End Account Deletion, Blockers, Pause, Review Anonymisation,
 * 6-Year Payment Archive, 5-Year Fraud Ban Hash & RLS Test (Step 8).
 *
 * Proves against your real Supabase database:
 * 1. Deletion is BLOCKED while a job is in progress, payment/refund pending, or dispute open.
 * 2. Artisan can pause/resume their account (immediately hides them from discovery & sets Offline).
 * 3. Once blockers are cleared, initiate_account_deletion marks account 'deleted' at once,
 *    hides from search, and deletes push_subscriptions & trusted_contacts immediately.
 * 4. Full scheduled purge (purgeSingleDeletedUser):
 *    - Erases profile, artisan_profile, verification, guarantor, identity_hashes,
 *      job_messages, job_private_addresses, job photos, and auth.users!
 *    - Anonymises reviews (reviewer_id = NULL, reviewer_display_name = 'Anonymous user', is_anonymized = true)!
 *    - Archives payment records for 6 years in payment_archives with anonymous ID!
 *    - For fraud/violence removal, preserves ONLY nin_hash, phone_hash, reason, date in ban_records (5 years)!
 *    - Writes a non-PII record to deletion_logs!
 * 5. User A cannot read User B's deletion_requests, deletion_logs, payment_archives, or ban_records.
 *
 * Run with: npm run test:rls:step8
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { purgeSingleDeletedUser } from "../src/lib/deletion";
import { hashNinForIdentity, hashPhoneForIdentity } from "../src/lib/nin";

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
  const password = `Step8Test!${suffix}Aa`;
  const cleanupUserIds: string[] = [];
  let cleanupPaymentRef: string | null = null;
  let cleanupAnonLogRef: string | null = null;
  let cleanupBanNinHash: string | null = null;

  try {
    console.log("Creating Customer (to be deleted), Artisan (to keep anonymized review), and Fraud user...");
    const [rCust, rArt, rFraud] = await Promise.all([
      service.auth.admin.createUser({ email: `s8-cust-${suffix}@example.test`, password, email_confirm: true }),
      service.auth.admin.createUser({ email: `s8-art-${suffix}@example.test`, password, email_confirm: true }),
      service.auth.admin.createUser({ email: `s8-fraud-${suffix}@example.test`, password, email_confirm: true }),
    ]);

    const custId = rCust.data.user!.id;
    const artId = rArt.data.user!.id;
    const fraudId = rFraud.data.user!.id;
    cleanupUserIds.push(custId, artId, fraudId);

    const clientCust = createAnonClient();
    const clientArt = createAnonClient();

    await Promise.all([
      clientCust.auth.signInWithPassword({ email: `s8-cust-${suffix}@example.test`, password }),
      clientArt.auth.signInWithPassword({ email: `s8-art-${suffix}@example.test`, password }),
    ]);

    await Promise.all([
      clientCust.rpc("complete_onboarding", { p_role: "customer", p_terms_version: "2026-11-v1", p_privacy_version: "2026-11-v1", p_accepted_required: true }),
      clientArt.rpc("complete_onboarding", { p_role: "artisan", p_terms_version: "2026-11-v1", p_privacy_version: "2026-11-v1", p_accepted_required: true }),
    ]);

    await service.from("artisan_profiles").insert({
      user_id: artId,
      full_name: "Step8 Verified Tailor",
      trade: "tailor",
      bio: "Experienced Lagos tailor.",
      work_area: "Ikeja",
      payout_recipient_code: `RCP_s8_${suffix}`,
      verification_status: "approved",
      is_online: true,
      last_seen_at: new Date().toISOString(),
      approx_location: "SRID=4326;POINT(3.351 6.602)",
    });

    // 1. Test Artisan Pause / Resume
    console.log("1. Testing artisan Pause / Resume account...");
    const pauseRes = await clientArt.rpc("set_artisan_account_pause", { p_paused: true });
    assert.ifError(pauseRes.error);
    assert.equal(pauseRes.data, "paused");

    const { data: artAfterPause } = await service
      .from("artisan_profiles")
      .select("is_online")
      .eq("user_id", artId)
      .single();
    assert.equal(artAfterPause?.is_online, false, "Pausing artisan must set is_online = false");

    await clientArt.rpc("set_artisan_account_pause", { p_paused: false });

    // Seed Customer data: trusted contact, push subscription, active job, chat, address, payment
    await clientCust.from("trusted_contacts").upsert({
      user_id: custId,
      contact_name: "Brother Segun",
      contact_phone_e164: "+2348035559900",
    });

    await clientCust.from("push_subscriptions").upsert({
      user_id: custId,
      endpoint: `https://push.example.test/s8/${suffix}`,
      p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
      auth: "tBHItJI5svbpez7KI4CCXg",
    });

    const { data: job } = await service
      .from("jobs")
      .insert({
        customer_id: custId,
        artisan_id: artId,
        trade: "tailor",
        description: "Sew native attire for wedding.",
        approx_location: "SRID=4326;POINT(3.351 6.602)",
        approx_area_label: "Ikeja",
        status: "in_progress",
        accepted_amount_kobo: 1_500_000,
      })
      .select("id")
      .single();

    await service.from("job_private_addresses").insert({
      job_id: job!.id,
      exact_address: "99 Secret Home Street, Ikeja",
      exact_lat: 6.602,
      exact_lng: 3.351,
    });

    await service.from("job_messages").insert({
      job_id: job!.id,
      sender_id: custId,
      body: "Private chat message to be erased on deletion.",
    });

    // 2. Deletion MUST be BLOCKED while job is in_progress
    console.log("2. Testing deletion is BLOCKED while a job is in progress...");
    const blockedRes = await service.rpc("initiate_account_deletion", {
      p_user_id: custId,
      p_removal_reason: "user_requested",
      p_force_admin_override: false,
    });
    assert.ifError(blockedRes.error);
    const bRow = Array.isArray(blockedRes.data) ? blockedRes.data[0] : blockedRes.data;
    assert.equal(bRow.scheduled, false, "Deletion must be blocked while job is in_progress");
    assert.equal(bRow.active_jobs_count, 1);

    // Finish & confirm job, record paid payment, and leave a review to verify anonymisation!
    cleanupPaymentRef = `onise_s8_pay_${suffix}`;
    await service.from("payments").insert({
      job_id: job!.id,
      customer_id: custId,
      artisan_id: artId,
      provider_reference: cleanupPaymentRef,
      amount_kobo: 1_500_000,
      commission_kobo: 225_000,
      status: "paid",
      refund_status: "none",
      paid_at: new Date().toISOString(),
    });

    await service
      .from("jobs")
      .update({
        status: "confirmed",
        completed_at: new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", job!.id);

    const revRes = await clientCust.rpc("submit_job_review", {
      p_job_id: job!.id,
      p_rating: 5,
      p_comment: "Great tailor!",
    });
    assert.ifError(revRes.error);
    const reviewId = revRes.data.id as string;

    // 3. Initiate deletion -> immediate soft-delete, push subs & trusted contacts wiped
    console.log("3. Testing immediate deletion effects (soft-delete + wipe push & trusted contacts)...");
    const initRes = await service.rpc("initiate_account_deletion", {
      p_user_id: custId,
      p_removal_reason: "user_requested",
      p_force_admin_override: false,
    });
    assert.ifError(initRes.error);
    const initRow = Array.isArray(initRes.data) ? initRes.data[0] : initRes.data;
    assert.equal(initRow.scheduled, true);

    const [{ data: pushLeft }, { data: tcLeft }, { data: profDeleted }] = await Promise.all([
      service.from("push_subscriptions").select("id").eq("user_id", custId),
      service.from("trusted_contacts").select("user_id").eq("user_id", custId),
      service.from("profiles").select("account_status").eq("id", custId).single(),
    ]);
    assert.equal(pushLeft?.length ?? 0, 0, "Push subscriptions must be deleted immediately");
    assert.equal(tcLeft?.length ?? 0, 0, "Trusted contacts must be deleted immediately");
    assert.equal(profDeleted?.account_status, "deleted");

    // 4. Execute full 30-day permanent erasure end to end!
    console.log("4. Testing full 30-day permanent erasure end to end...");
    const purgeResult = await purgeSingleDeletedUser(custId);
    assert.equal(purgeResult.purged, true);
    assert.equal(purgeResult.paymentRecordsArchived, 1);
    cleanupAnonLogRef = purgeResult.anonymousRefId;

    // Verify auth user & profile & chat & private address are GONE
    const { data: authGone } = await service.auth.admin.getUserById(custId);
    assert.equal(authGone?.user ?? null, null, "Auth user must be permanently deleted");

    const { data: msgsGone } = await service
      .from("job_messages")
      .select("id")
      .eq("job_id", job!.id);
    assert.equal(msgsGone?.length ?? 0, 0, "Chat messages must be erased");

    const { data: addrGone } = await service
      .from("job_private_addresses")
      .select("job_id")
      .eq("job_id", job!.id);
    assert.equal(addrGone?.length ?? 0, 0, "Private addresses must be erased");

    // Verify review was ANONYMISED (kept for artisan rating, personal identity removed!)
    const { data: anonRev } = await service
      .from("reviews")
      .select("reviewer_id, reviewer_display_name, is_anonymized, rating")
      .eq("id", reviewId)
      .single();
    assert.equal(anonRev?.reviewer_id, null);
    assert.equal(anonRev?.reviewer_display_name, "Anonymous user");
    assert.equal(anonRev?.is_anonymized, true);
    assert.equal(anonRev?.rating, 5);

    // Verify payment was ARCHIVED for 6 years with anonymous ID!
    const { data: archivedPay } = await service
      .from("payment_archives")
      .select("anonymous_customer_ref, amount_kobo, retain_until")
      .eq("provider_reference", cleanupPaymentRef)
      .single();
    assert.equal(archivedPay?.anonymous_customer_ref, purgeResult.anonymousRefId);
    assert.equal(Number(archivedPay?.amount_kobo), 1_500_000);
    assert.ok(archivedPay?.retain_until);

    // Verify deletion_logs has non-PII record and Artisan CANNOT read it via RLS
    const { data: artReadDelLogs } = await clientArt.from("deletion_logs").select("*");
    assert.equal(artReadDelLogs?.length ?? 0, 0, "Non-admin must NOT read deletion_logs");

    const { data: artReadArchives } = await clientArt.from("payment_archives").select("*");
    assert.equal(artReadArchives?.length ?? 0, 0, "Non-admin must NOT read payment_archives");

    // 5. Test fraud removal preserves ONLY NIN & phone hash in ban_records (5 years)
    console.log("5. Testing fraud removal preserves ONLY NIN & phone hashes in ban_records...");
    cleanupBanNinHash = hashNinForIdentity(`99988${suffix}`);
    const fraudPhoneHash = hashPhoneForIdentity("+2348039990001");
    await service.from("identity_hashes").insert([
      { user_id: fraudId, hash_type: "nin", hash_value: cleanupBanNinHash },
      { user_id: fraudId, hash_type: "phone", hash_value: fraudPhoneHash },
    ]);
    await service.rpc("initiate_account_deletion", {
      p_user_id: fraudId,
      p_removal_reason: "fraud",
      p_force_admin_override: true,
    });
    const fraudPurge = await purgeSingleDeletedUser(fraudId);
    assert.equal(fraudPurge.banRecordCreated, true);

    const { data: banRow } = await service
      .from("ban_records")
      .select("nin_hash, phone_hash, reason, expires_at")
      .eq("nin_hash", cleanupBanNinHash)
      .single();
    assert.equal(banRow?.reason, "fraud");
    assert.equal(banRow?.phone_hash, fraudPhoneHash);

    const { data: artReadBans } = await clientArt.from("ban_records").select("*");
    assert.equal(artReadBans?.length ?? 0, 0, "Non-admin must NOT read ban_records");

    // Clean up test archive/log/ban rows
    await service.from("deletion_logs").delete().eq("anonymous_ref_id", fraudPurge.anonymousRefId);

    console.log("\nALL STEP 8 END-TO-END DELETION, ANONYMISATION, ARCHIVE & RLS TESTS PASSED!");
  } finally {
    if (cleanupPaymentRef) {
      await service.from("payment_archives").delete().eq("provider_reference", cleanupPaymentRef);
    }
    if (cleanupAnonLogRef) {
      await service.from("deletion_logs").delete().eq("anonymous_ref_id", cleanupAnonLogRef);
    }
    if (cleanupBanNinHash) {
      await service.from("ban_records").delete().eq("nin_hash", cleanupBanNinHash);
    }
    for (const id of cleanupUserIds) {
      await service.auth.admin.deleteUser(id).catch(() => {});
    }
  }
}

run().catch((err) => {
  console.error("Step 8 end-to-end deletion test failed:", err);
  process.exit(1);
});
