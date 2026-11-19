import crypto from "crypto";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  calculateCommissionKobo,
  compareReconciliationRecords,
  getFirstTimeCustomerMaxKobo,
  verifyPaystackWebhookSignature,
} from "@/lib/payments";

describe("Step 6 — 15% Commission (whole kobo), Webhook HMAC-SHA512 & Cap", () => {
  it("computes 15% commission strictly in whole kobo integers", () => {
    expect(calculateCommissionKobo(1_000_000)).toBe(150_000); // ₦10,000 -> ₦1,500
    expect(calculateCommissionKobo(2_500_000)).toBe(375_000); // ₦25,000 -> ₦3,750
    expect(calculateCommissionKobo(333_333)).toBe(50_000); // exact integer rounding
    expect(getFirstTimeCustomerMaxKobo()).toBeGreaterThan(0);
  });

  it("verifies Paystack HMAC-SHA512 webhook signatures and rejects forged or tampered bodies", () => {
    const secret = "sk_test_super_secret_key_12345";
    const body = JSON.stringify({
      event: "charge.success",
      data: { id: 999, reference: "onise_ref_1", amount: 1_500_000, currency: "NGN" },
    });

    const validSig = crypto
      .createHmac("sha512", secret)
      .update(body)
      .digest("hex");

    expect(verifyPaystackWebhookSignature(body, validSig, secret)).toBe(true);
    expect(verifyPaystackWebhookSignature(`${body} `, validSig, secret)).toBe(false);
    expect(verifyPaystackWebhookSignature(body, "0".repeat(128), secret)).toBe(false);
    expect(verifyPaystackWebhookSignature(body, null, secret)).toBe(false);
  });

  it("compares daily reconciliation records and detects missing or mismatched amounts", () => {
    const matched = compareReconciliationRecords(
      "2026-11-18",
      [{ provider_reference: "ref_1", amount_kobo: 1_500_000, commission_kobo: 225_000 }],
      [{ reference: "ref_1", amount: 1_500_000 }],
    );
    expect(matched.status).toBe("matched");
    expect(matched.ourPaidTotalKobo).toBe(1_500_000);
    expect(matched.paystackPaidTotalKobo).toBe(1_500_000);

    const discrepant = compareReconciliationRecords(
      "2026-11-18",
      [
        { provider_reference: "ref_1", amount_kobo: 1_500_000, commission_kobo: 225_000 },
        { provider_reference: "ref_only_db", amount_kobo: 500_000, commission_kobo: 75_000 },
      ],
      [
        { reference: "ref_1", amount: 1_400_000 }, // amount mismatch!
        { reference: "ref_only_ps", amount: 800_000 }, // missing in our DB!
      ],
    );
    expect(discrepant.status).toBe("discrepancy");
    expect(discrepant.amountMismatchRefs).toEqual(["ref_1"]);
    expect(discrepant.missingInOurDbRefs).toEqual(["ref_only_ps"]);
    expect(discrepant.missingInPaystackRefs).toEqual(["ref_only_db"]);
  });
});

describe("Step 6 — Migration static security & webhook idempotency audit", () => {
  it("enforces RLS on all Step 6 tables, stores zero card details, verifies amounts, and deduplicates webhooks", () => {
    const sqlPath = path.resolve(
      __dirname,
      "../supabase/migrations/0006_step6_payments_disputes_reconciliation.sql",
    );
    const sql = fs.readFileSync(sqlPath, "utf8");

    for (const table of [
      "payments",
      "webhook_events",
      "disputes",
      "reconciliation_reports",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`alter table public.${table} force row level security;`);
    }

    // Never store card details
    expect(sql).not.toMatch(/\bcard_number\b|\bcvv\b|\blast4\b|\bauthorization_code\b/i);

    // Unique provider_event_id + duplicate_ignored
    expect(sql).toContain("provider_event_id text not null unique");
    expect(sql).toContain("on conflict (provider_event_id) do nothing");
    expect(sql).toContain("'duplicate_ignored'");

    // Amount check against payment AND job quote
    expect(sql).toContain("p_paid_amount_kobo is distinct from v_payment.amount_kobo");
    expect(sql).toContain("p_paid_amount_kobo is distinct from v_job.accepted_amount_kobo");

    // 24-hour auto-confirm skipping open disputes
    expect(sql).toContain("interval '24 hours'");
    expect(sql).toContain("where d.job_id = j.id and d.status = 'open'");
  });
});
