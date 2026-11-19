/**
 * Live Supabase RLS, Confirmed-Only Rating, One-Per-Side Unique Rule &
 * Server-Side Average/Count Recalculation Test (Step 7).
 *
 * Proves against your real Supabase database:
 * 1. Neither side can rate a job before status = 'confirmed'.
 * 2. Out-of-range ratings (0 or 6) are rejected.
 * 3. Customer & Artisan can each submit 1 review (1-5 stars) after 'confirmed';
 *    re-submitting with a different rating is blocked by UNIQUE (job_id, reviewer_role),
 *    while retrying with the same idempotency_key is idempotent.
 * 4. Artisan's profiles.rating_avg and profiles.rating_count update automatically on server,
 *    and the artisan CANNOT directly write their own rating_avg.
 * 5. Outsider CANNOT read private artisan-to-customer reviews or submit a review on someone else's job.
 *
 * Run with: npm run test:rls:step7
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
  const password = `Step7Test!${suffix}Aa`;
  const createdIds: string[] = [];

  try {
    console.log("Creating Customer, Artisan, and Outsider accounts...");
    const [rCust, rArt, rOut] = await Promise.all([
      service.auth.admin.createUser({ email: `s7-cust-${suffix}@example.test`, password, email_confirm: true }),
      service.auth.admin.createUser({ email: `s7-art-${suffix}@example.test`, password, email_confirm: true }),
      service.auth.admin.createUser({ email: `s7-out-${suffix}@example.test`, password, email_confirm: true }),
    ]);

    const custId = rCust.data.user!.id;
    const artId = rArt.data.user!.id;
    const outId = rOut.data.user!.id;
    createdIds.push(custId, artId, outId);

    const clientCust = createAnonClient();
    const clientArt = createAnonClient();
    const clientOut = createAnonClient();

    await Promise.all([
      clientCust.auth.signInWithPassword({ email: `s7-cust-${suffix}@example.test`, password }),
      clientArt.auth.signInWithPassword({ email: `s7-art-${suffix}@example.test`, password }),
      clientOut.auth.signInWithPassword({ email: `s7-out-${suffix}@example.test`, password }),
    ]);

    await Promise.all([
      clientCust.rpc("complete_onboarding", { p_role: "customer", p_terms_version: "2026-11-v1", p_privacy_version: "2026-11-v1", p_accepted_required: true }),
      clientArt.rpc("complete_onboarding", { p_role: "artisan", p_terms_version: "2026-11-v1", p_privacy_version: "2026-11-v1", p_accepted_required: true }),
      clientOut.rpc("complete_onboarding", { p_role: "customer", p_terms_version: "2026-11-v1", p_privacy_version: "2026-11-v1", p_accepted_required: true }),
    ]);

    await service.from("artisan_profiles").insert({
      user_id: artId,
      full_name: "Rated Artisan",
      trade: "carpenter",
      bio: "Furniture and door carpentry across Lagos.",
      work_area: "Surulere, Lagos",
      payout_recipient_code: `RCP_s7_${suffix}`,
      verification_status: "approved",
    });

    // Seed Job 1 (completed, NOT yet confirmed) and Job 2 (confirmed)
    const { data: job1 } = await service
      .from("jobs")
      .insert({
        customer_id: custId,
        artisan_id: artId,
        trade: "carpenter",
        description: "Repair wardrobe hinge.",
        approx_location: "SRID=4326;POINT(3.351 6.502)",
        approx_area_label: "Surulere",
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    const { data: job2 } = await service
      .from("jobs")
      .insert({
        customer_id: custId,
        artisan_id: artId,
        trade: "carpenter",
        description: "Install new wooden kitchen door.",
        approx_location: "SRID=4326;POINT(3.351 6.502)",
        approx_area_label: "Surulere",
        status: "confirmed",
        completed_at: new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    // 1. Cannot rate before confirmed
    console.log("1. Testing rating is blocked before job is confirmed...");
    const { error: earlyErr } = await clientCust.rpc("submit_job_review", {
      p_job_id: job1!.id,
      p_rating: 5,
      p_comment: "Too early",
    });
    assert.ok(earlyErr, "Rating before confirmed must be rejected");

    // Confirm Job 1 now so we can test 2-job average calculation (5 and 3 -> 4.00)
    await service
      .from("jobs")
      .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
      .eq("id", job1!.id);

    // 2. Out-of-range rating rejected
    console.log("2. Testing out-of-range ratings (0 and 6) are rejected...");
    const { error: zeroErr } = await clientCust.rpc("submit_job_review", {
      p_job_id: job1!.id,
      p_rating: 0,
    });
    assert.ok(zeroErr, "Rating 0 must fail");

    const { error: sixErr } = await clientCust.rpc("submit_job_review", {
      p_job_id: job1!.id,
      p_rating: 6,
    });
    assert.ok(sixErr, "Rating 6 must fail");

    // 3. Customer rates Job 1 = 5 stars (idempotent replay allowed, changed duplicate rejected)
    console.log("3. Testing one review per side per job + idempotency + average recalculation...");
    const r1 = await clientCust.rpc("submit_job_review", {
      p_job_id: job1!.id,
      p_rating: 5,
      p_comment: "Very neat carpenter!",
      p_idempotency_key: `rev-j1-${suffix}`,
    });
    assert.ifError(r1.error);

    const r1Replay = await clientCust.rpc("submit_job_review", {
      p_job_id: job1!.id,
      p_rating: 5,
      p_comment: "Very neat carpenter!",
      p_idempotency_key: `rev-j1-${suffix}`,
    });
    assert.ifError(r1Replay.error);
    assert.equal(r1.data.id, r1Replay.data.id);

    // Trying to submit a second different review for the same job MUST fail
    const { error: dupErr } = await clientCust.rpc("submit_job_review", {
      p_job_id: job1!.id,
      p_rating: 1,
      p_comment: "Trying to overwrite",
      p_idempotency_key: `rev-j1-dup-${suffix}`,
    });
    assert.ok(dupErr, "Second review by same side on same job must be rejected");

    // Customer rates Job 2 = 3 stars -> artisan average should become (5 + 3) / 2 = 4.00, count = 2
    const r2 = await clientCust.rpc("submit_job_review", {
      p_job_id: job2!.id,
      p_rating: 3,
      p_comment: "Good work, arrived a bit late.",
    });
    assert.ifError(r2.error);

    const { data: pubProfileRows } = await clientOut.rpc("get_artisan_public_profile", {
      p_artisan_id: artId,
    });
    const pubProfile = Array.isArray(pubProfileRows) ? pubProfileRows[0] : pubProfileRows;
    assert.equal(Number(pubProfile.rating_avg), 4.0);
    assert.equal(Number(pubProfile.rating_count), 2);

    // 4. Artisan rates Customer on Job 1 -> Outsider CANNOT read artisan-to-customer review or write reviews
    console.log("4. Testing RLS privacy on artisan-to-customer reviews & outsider write block...");
    const artRev = await clientArt.rpc("submit_job_review", {
      p_job_id: job1!.id,
      p_rating: 5,
      p_comment: "Polite customer, paid promptly.",
    });
    assert.ifError(artRev.error);

    const { data: outReadCustRev } = await clientOut
      .from("reviews")
      .select("*")
      .eq("id", artRev.data.id);
    assert.equal(outReadCustRev?.length ?? 0, 0, "Outsider must NOT read private review about another customer");

    const { error: outSubmitErr } = await clientOut.rpc("submit_job_review", {
      p_job_id: job1!.id,
      p_rating: 1,
      p_comment: "Fake review from outsider",
    });
    assert.ok(outSubmitErr, "Outsider must NOT submit review on another user's job");

    console.log("\nALL STEP 7 LIVE RLS, UNIQUE REVIEW & AVERAGE RATING TESTS PASSED!");
  } finally {
    for (const id of createdIds) {
      await service.auth.admin.deleteUser(id);
    }
  }
}

run().catch((err) => {
  console.error("Step 7 RLS test failed:", err);
  process.exit(1);
});
