import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  formatDeletionBlockerReasons,
  generateDeletionOtp,
  verifyDeletionOtpHash,
} from "@/lib/deletion";

describe("Step 8 — Deletion OTP hashing & exact blocker messages", () => {
  it("generates and verifies 6-digit deletion OTPs with timing-safe HMAC comparison", () => {
    const uid = "00000000-0000-0000-0000-000000000099";
    const { otp, otpHash } = generateDeletionOtp(uid);
    expect(otp).toMatch(/^\d{6}$/);
    expect(otpHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyDeletionOtpHash(uid, otp, otpHash)).toBe(true);
    expect(verifyDeletionOtpHash(uid, otp === "000000" ? "111111" : "000000", otpHash)).toBe(
      false,
    );
    expect(verifyDeletionOtpHash("other-uid", otp, otpHash)).toBe(false);
  });

  it("explains exactly what is blocking account deletion", () => {
    const reasons = formatDeletionBlockerReasons({
      activeJobsCount: 1,
      pendingPaymentsOrRefundsCount: 2,
      openDisputesCount: 1,
    });
    expect(reasons).toHaveLength(3);
    expect(reasons[0]).toContain("1 active job");
    expect(reasons[1]).toContain("2 pending payout, payment, or refund");
    expect(reasons[2]).toContain("1 open dispute");
  });
});

describe("Step 8 — Migration static security & erasure audit", () => {
  it("enforces RLS on all Step 8 tables, 30-day purge, 6-year payment archive, 5-year ban records & non-PII deletion logs", () => {
    const sqlPath = path.resolve(
      __dirname,
      "../supabase/migrations/0008_step8_privacy_deletion.sql",
    );
    const sql = fs.readFileSync(sqlPath, "utf8");

    for (const table of [
      "deletion_requests",
      "payment_archives",
      "ban_records",
      "deletion_logs",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`alter table public.${table} force row level security;`);
    }

    // Immediate deletion of push subscriptions & trusted contacts
    expect(sql).toContain("delete from public.push_subscriptions where user_id = p_user_id;");
    expect(sql).toContain("delete from public.trusted_contacts where user_id = p_user_id;");

    // 30-day purge, 6-year payment archive, 5-year fraud/violence ban record
    expect(sql).toContain("interval '30 days'");
    expect(sql).toContain("interval '6 years'");
    expect(sql).toContain("interval '5 years'");

    // Review anonymisation
    expect(sql).toContain("reviewer_display_name = 'Anonymous user'");
    expect(sql).toContain("is_anonymized = true");

    // Deletion log has NO user_id, phone, email, or name columns
    const delLogStart = sql.indexOf("create table if not exists public.deletion_logs");
    const delLogEnd = sql.indexOf(");", delLogStart);
    const delLogBlock = sql.slice(delLogStart, delLogEnd);
    expect(delLogBlock).not.toMatch(/\buser_id\b|\bphone\b|\bemail\b|\bfull_name\b/i);
  });
});
