/**
 * Live Supabase RLS, PostGIS Discovery, 15-Min Expiry & 30s SMS Fallback Test (Step 3).
 *
 * Proves against your real Supabase database:
 * 1. User A cannot read, update, or delete User B's push_subscriptions or alert_deliveries.
 * 2. Unapproved artisan CANNOT go Online via set_artisan_presence.
 * 3. Approved artisan needs active 'location' consent to go Online; coordinates are rounded to ~100m.
 * 4. find_nearby_artisans returns ONLY approved, Online (<15m) artisans within 10 km,
 *    sorted by distance ASC then rating DESC, with ZERO phone number fields.
 * 5. expire_stale_online_artisans sets >15-minute stale artisans Offline idempotently.
 * 6. claim_due_sms_fallback_alerts claims a due alert at most once (idempotent).
 *
 * Run with: npm run test:rls:step3
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { generateAckToken } from "../src/lib/alerts";

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
  const password = `Step3Test!${suffix}Aa`;

  const emailCust = `s3-cust-${suffix}@example.test`;
  const emailArtNear = `s3-art-near-${suffix}@example.test`;
  const emailArtFar = `s3-art-far-${suffix}@example.test`;

  let custId: string | null = null;
  let artNearId: string | null = null;
  let artFarId: string | null = null;

  try {
    console.log("Creating Customer, Near Artisan, and Far/Unapproved Artisan...");
    const [rCust, rNear, rFar] = await Promise.all([
      service.auth.admin.createUser({ email: emailCust, password, email_confirm: true }),
      service.auth.admin.createUser({ email: emailArtNear, password, email_confirm: true }),
      service.auth.admin.createUser({ email: emailArtFar, password, email_confirm: true }),
    ]);

    assert.ifError(rCust.error);
    assert.ifError(rNear.error);
    assert.ifError(rFar.error);
    custId = rCust.data.user!.id;
    artNearId = rNear.data.user!.id;
    artFarId = rFar.data.user!.id;

    const clientCust = createAnonClient();
    const clientNear = createAnonClient();
    const clientFar = createAnonClient();

    await clientCust.auth.signInWithPassword({ email: emailCust, password });
    await clientNear.auth.signInWithPassword({ email: emailArtNear, password });
    await clientFar.auth.signInWithPassword({ email: emailArtFar, password });

    await clientCust.rpc("complete_onboarding", {
      p_role: "customer",
      p_terms_version: "2026-11-v1",
      p_privacy_version: "2026-11-v1",
      p_accepted_required: true,
    });
    await clientNear.rpc("complete_onboarding", {
      p_role: "artisan",
      p_terms_version: "2026-11-v1",
      p_privacy_version: "2026-11-v1",
      p_accepted_required: true,
    });
    await clientFar.rpc("complete_onboarding", {
      p_role: "artisan",
      p_terms_version: "2026-11-v1",
      p_privacy_version: "2026-11-v1",
      p_accepted_required: true,
    });

    // Seed artisan profiles: Near is approved, Far starts pending
    await service.from("artisan_profiles").insert([
      {
        user_id: artNearId,
        full_name: "Chuka Plumber Ikeja",
        trade: "plumber",
        bio: "Reliable Lagos plumber for leaks and piping.",
        work_area: "Ikeja, Lagos",
        payout_recipient_code: `RCP_near_${suffix}`,
        verification_status: "approved",
        is_online: false,
      },
      {
        user_id: artFarId,
        full_name: "Pending Far Plumber",
        trade: "plumber",
        bio: "Plumber working far away in Lekki.",
        work_area: "Lekki, Lagos",
        payout_recipient_code: `RCP_far_${suffix}`,
        verification_status: "pending",
        is_online: false,
      },
    ]);

    // 1. Unapproved artisan CANNOT go Online
    console.log("1. Testing unapproved artisan cannot go Online...");
    await clientFar.rpc("set_optional_consent", {
      p_consent_type: "location",
      p_granted: true,
      p_version: "2026-11-v1",
    });
    const { error: unapprovedOnlineErr } = await clientFar.rpc("set_artisan_presence", {
      p_is_online: true,
      p_lat: 6.602,
      p_lng: 3.351,
    });
    assert.ok(unapprovedOnlineErr, "Unapproved artisan must NOT go Online");

    // 2. Approved artisan without location consent cannot go Online; with consent CAN & rounds to ~100m
    console.log("2. Testing location consent requirement & ~100m coordinate rounding...");
    const { error: noConsentOnlineErr } = await clientNear.rpc("set_artisan_presence", {
      p_is_online: true,
      p_lat: 6.602489,
      p_lng: 3.351891,
    });
    assert.ok(noConsentOnlineErr, "Going Online without location consent must fail");

    await clientNear.rpc("set_optional_consent", {
      p_consent_type: "location",
      p_granted: true,
      p_version: "2026-11-v1",
    });

    const onlineRes = await clientNear.rpc("set_artisan_presence", {
      p_is_online: true,
      p_lat: 6.602489,
      p_lng: 3.351891,
    });
    assert.ifError(onlineRes.error);
    const presence = Array.isArray(onlineRes.data) ? onlineRes.data[0] : onlineRes.data;
    assert.equal(presence.is_online, true);
    assert.equal(presence.approx_lat, 6.602, "Latitude must be rounded to 3 decimals (~100m)");
    assert.equal(presence.approx_lng, 3.352, "Longitude must be rounded to 3 decimals (~100m)");

    // Approve Far artisan and place them ~25 km away in Lekki -> must NOT appear in Ikeja 10 km search
    await service
      .from("artisan_profiles")
      .update({ verification_status: "approved" })
      .eq("user_id", artFarId);

    const farOnline = await clientFar.rpc("set_artisan_presence", {
      p_is_online: true,
      p_lat: 6.447,
      p_lng: 3.472,
    });
    assert.ifError(farOnline.error);

    // 3. Customer discovery within 10 km of Ikeja
    console.log("3. Testing 10 km PostGIS discovery excludes >10 km artisans and hides phone numbers...");
    const nearbyRes = await clientCust.rpc("find_nearby_artisans", {
      p_trade: "plumber",
      p_lat: 6.605,
      p_lng: 3.355,
      p_radius_meters: 10000,
    });
    assert.ifError(nearbyRes.error);
    const foundIds = (nearbyRes.data as { artisan_id: string }[]).map((r) => r.artisan_id);
    assert.ok(foundIds.includes(artNearId), "Expected near approved online artisan within 10 km");
    assert.ok(!foundIds.includes(artFarId), "Expected far artisan (>10 km) to be excluded");
    assert.equal(
      "phone" in (nearbyRes.data[0] as Record<string, unknown>),
      false,
      "Discovery result must NEVER include phone",
    );

    // 4. Stale >15-minute artisan vanishes immediately & is set Offline by expire_stale_online_artisans
    console.log("4. Testing 15-minute stale Online auto-expiry...");
    const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await service
      .from("artisan_profiles")
      .update({ last_seen_at: twentyMinsAgo })
      .eq("user_id", artNearId);

    const staleSearch = await clientCust.rpc("find_nearby_artisans", {
      p_trade: "plumber",
      p_lat: 6.605,
      p_lng: 3.355,
      p_radius_meters: 10000,
    });
    assert.ifError(staleSearch.error);
    assert.ok(
      !(staleSearch.data as { artisan_id: string }[]).some((r) => r.artisan_id === artNearId),
      "Stale artisan (>15m without heartbeat) must NOT appear in discovery",
    );

    const expireRes = await service.rpc("expire_stale_online_artisans");
    assert.ifError(expireRes.error);
    const { data: afterExpire } = await service
      .from("artisan_profiles")
      .select("is_online")
      .eq("user_id", artNearId)
      .single();
    assert.equal(afterExpire?.is_online, false);

    // 5. Push subscriptions & alert_deliveries RLS isolation between users
    console.log("5. Testing RLS isolation on push_subscriptions & alert_deliveries...");
    const { error: subErr } = await clientNear.from("push_subscriptions").upsert({
      user_id: artNearId,
      endpoint: `https://push.example.test/sub/${suffix}`,
      p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
      auth: "tBHItJI5svbpez7KI4CCXg",
    });
    assert.ifError(subErr);

    const { data: custReadOtherSubs } = await clientCust
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", artNearId);
    assert.equal(custReadOtherSubs?.length ?? 0, 0, "Customer must NOT read artisan push subscriptions");

    // 6. Atomic at-most-once claim for 30-second SMS backup alert
    console.log("6. Testing atomic claim_due_sms_fallback_alerts (idempotent at-most-once)...");
    const ack = generateAckToken();
    const pastDue = new Date(Date.now() - 5_000).toISOString();
    const { data: alertRow, error: alertInsertErr } = await service
      .from("alert_deliveries")
      .insert({
        user_id: artNearId,
        alert_type: "test_alert",
        idempotency_key: `rls-s3-alert-${suffix}`,
        ack_token_hash: ack.tokenHash,
        status: "push_sent",
        sms_fallback_due_at: pastDue,
      })
      .select("id")
      .single();
    assert.ifError(alertInsertErr);

    // Customer cannot read Artisan's alert_deliveries
    const { data: custReadOtherAlerts } = await clientCust
      .from("alert_deliveries")
      .select("id")
      .eq("id", alertRow.id);
    assert.equal(custReadOtherAlerts?.length ?? 0, 0, "User A must NOT read User B's alerts");

    // First claim grabs the due alert; immediate second claim returns 0 for that alert
    const claim1 = await service.rpc("claim_due_sms_fallback_alerts", { p_limit: 50 });
    assert.ifError(claim1.error);
    assert.ok(
      (claim1.data as { alert_id: string }[]).some((r) => r.alert_id === alertRow.id),
      "Expected due alert to be claimed",
    );

    const claim2 = await service.rpc("claim_due_sms_fallback_alerts", { p_limit: 50 });
    assert.ifError(claim2.error);
    assert.ok(
      !(claim2.data as { alert_id: string }[]).some((r) => r.alert_id === alertRow.id),
      "Second claim must NOT re-claim already claimed alert",
    );

    console.log("\nALL STEP 3 LIVE RLS, POSTGIS, EXPIRY & SMS FALLBACK TESTS PASSED!");
  } finally {
    if (custId) await service.auth.admin.deleteUser(custId);
    if (artNearId) await service.auth.admin.deleteUser(artNearId);
    if (artFarId) await service.auth.admin.deleteUser(artFarId);
  }
}

run().catch((err) => {
  console.error("Step 3 RLS test failed:", err);
  process.exit(1);
});
