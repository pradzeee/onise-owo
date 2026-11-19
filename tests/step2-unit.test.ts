import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  generateGuarantorOtp,
  generateGuarantorToken,
  hashGuarantorToken,
  verifyGuarantorOtpHash,
} from "@/lib/guarantor";
import {
  hashNinForIdentity,
  hashPhoneForIdentity,
  validateNinFormat,
  verifyNinWithFaceAndLiveness,
} from "@/lib/nin";
import {
  createPaystackPayoutRecipient,
  validateNubanAccount,
} from "@/lib/paystack";

describe("Step 2 — NIN validation, keyed HMAC hashing & provider check", () => {
  it("validates 11-digit Nigerian NINs strictly", () => {
    expect(validateNinFormat("12345678901")).toBe("12345678901");
    expect(validateNinFormat("1234 567 8901")).toBe("12345678901");
    expect(() => validateNinFormat("1234567890")).toThrow();
    expect(() => validateNinFormat("123456789012")).toThrow();
    expect(() => validateNinFormat("1234567890a")).toThrow();
  });

  it("produces deterministic 64-char HMAC hashes scoped separately for NIN and phone", () => {
    const ninHash = hashNinForIdentity("12345678901");
    const ninHash2 = hashNinForIdentity("12345678901");
    const phoneHash = hashPhoneForIdentity("+2348031234567");

    expect(ninHash).toBe(ninHash2);
    expect(ninHash).toMatch(/^[0-9a-f]{64}$/);
    expect(phoneHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ninHash).not.toContain("12345678901");
    expect(ninHash).not.toBe(phoneHash);
  });

  it("checks NIN + selfie liveness/face match via dev_mock and handles failures", async () => {
    const dummySelfie = Buffer.from("x".repeat(200)).toString("base64");

    const passRes = await verifyNinWithFaceAndLiveness({
      nin: "12345678901",
      selfieBase64: dummySelfie,
      idempotencyKey: "test-key-1",
    });
    expect(passRes.providerStatus).toBe("passed");
    expect(passRes.livenessPassed).toBe(true);
    expect(passRes.faceMatchPassed).toBe(true);

    const failRes = await verifyNinWithFaceAndLiveness({
      nin: "00000000000",
      selfieBase64: dummySelfie,
      idempotencyKey: "test-key-2",
    });
    expect(failRes.providerStatus).toBe("failed");
    expect(failRes.livenessPassed).toBe(false);
    expect(failRes.faceMatchPassed).toBe(false);
  });
});

describe("Step 2 — Paystack payout recipient (never stores bank details)", () => {
  it("validates 10-digit NUBAN account numbers", () => {
    expect(validateNubanAccount("0123456789", "058")).toEqual({
      cleanAccountNumber: "0123456789",
      cleanBankCode: "058",
    });
    expect(() => validateNubanAccount("12345", "058")).toThrow();
    expect(() => validateNubanAccount("0123456789", "")).toThrow();
  });

  it("returns opaque recipient code containing zero bank account digits", async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    const result = await createPaystackPayoutRecipient({
      fullName: "Adebayo Okafor",
      accountNumber: "0123456789",
      bankCode: "058",
      artisanUserId: "00000000-0000-0000-0000-000000000001",
    });

    expect(result.recipientCode).toMatch(/^RCP_dev_/);
    expect(result.recipientCode).not.toContain("0123456789");
    expect(result.recipientCode).not.toContain("058");
  });
});

describe("Step 2 — Guarantor token & one-time code hashing", () => {
  it("hashes tokens and verifies 6-digit OTPs with timing-safe comparison", () => {
    const { rawToken, tokenHash } = generateGuarantorToken();
    expect(tokenHash).toBe(hashGuarantorToken(rawToken));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toContain(rawToken);

    const guarantorId = "g-12345";
    const { otp, otpHash } = generateGuarantorOtp(guarantorId);
    expect(otp).toMatch(/^\d{6}$/);
    expect(verifyGuarantorOtpHash(guarantorId, otp, otpHash)).toBe(true);
    expect(verifyGuarantorOtpHash(guarantorId, "000000", otpHash)).toBe(
      otp === "000000",
    );
    expect(verifyGuarantorOtpHash("other-id", otp, otpHash)).toBe(false);
  });
});

describe("Step 2 — Migration static security audit", () => {
  it("enforces RLS on every Step 2 table, private selfie bucket, dual approval gate, and zero raw NIN/bank storage", () => {
    const sqlPath = path.resolve(
      __dirname,
      "../supabase/migrations/0002_step2_artisan_onboarding.sql",
    );
    const sql = fs.readFileSync(sqlPath, "utf8");

    const step2Tables = [
      "artisan_profiles",
      "identity_hashes",
      "artisan_verifications",
      "guarantor_verifications",
    ];
    for (const table of step2Tables) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`alter table public.${table} force row level security;`);
    }

    // Private selfie bucket
    expect(sql).toContain("'artisan-verifications'");
    expect(sql).toContain("false, -- STRICTLY PRIVATE");

    // Online requires approved
    expect(sql).toContain("constraint artisan_online_requires_approved check");

    // Dual approval gating in Postgres
    expect(sql).toContain("v_verif.provider_status <> 'passed'");
    expect(sql).toContain("v_guarantor.status <> 'confirmed'");

    // Never store raw NIN or bank account numbers in artisan tables
    expect(sql).not.toMatch(/\baccount_number\s+text\b/i);
    expect(sql).not.toMatch(/\bbank_code\s+text\b/i);
    expect(sql).not.toMatch(/\bnin\s+text\b/i);

    // Audit logging for private file opens
    expect(sql).toContain("admin_open_verification_file");
  });
});
