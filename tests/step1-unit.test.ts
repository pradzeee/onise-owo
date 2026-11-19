import fs from "fs";
import path from "path";
import { describe, expect, it, beforeEach } from "vitest";
import { verifyCaptchaToken } from "@/lib/captcha";
import { sanitizeLogMeta, redactValue } from "@/lib/logger";
import { assertWholeKobo, formatKoboAsNaira, nairaStringToKobo } from "@/lib/money";
import { maskPhoneForUi, normalizeNigerianPhone } from "@/lib/phone";
import {
  consumeInMemoryRateLimit,
  resetInMemoryRateLimits,
} from "@/lib/rate-limit";
import { formatLagosDateTime } from "@/lib/time";

describe("Step 1 — Nigerian phone validation & normalization", () => {
  it("normalizes common Nigerian mobile formats to E.164", () => {
    expect(normalizeNigerianPhone("0803 123 4567")).toBe("+2348031234567");
    expect(normalizeNigerianPhone("8031234567")).toBe("+2348031234567");
    expect(normalizeNigerianPhone("2348129998888")).toBe("+2348129998888");
    expect(normalizeNigerianPhone("+2349012223333")).toBe("+2349012223333");
    expect(normalizeNigerianPhone("+234 0706-555-4444")).toBe("+2347065554444");
  });

  it("rejects non-Nigerian or invalid numbers", () => {
    expect(() => normalizeNigerianPhone("")).toThrow();
    expect(() => normalizeNigerianPhone("05012345678")).toThrow();
    expect(() => normalizeNigerianPhone("+14155550100")).toThrow();
    expect(() => normalizeNigerianPhone("0803123")).toThrow();
  });

  it("masks phone numbers safely for UI", () => {
    expect(maskPhoneForUi("+2348031234567")).toBe("+234 •••• 4567");
  });
});

describe("Step 1 — Safe logging (never log PII)", () => {
  it("redacts forbidden PII keys and embedded phone/NIN patterns", () => {
    const clean = sanitizeLogMeta({
      phone: "+2348031234567",
      nin: "12345678901",
      address: "12 Allen Avenue, Ikeja",
      messageText: "Come fix my sink",
      otp: "654321",
      safeField: "User +2348031234567 with ID 12345678901",
      ok: true,
    });

    expect(clean.phone).toBe("[REDACTED]");
    expect(clean.nin).toBe("[REDACTED]");
    expect(clean.address).toBe("[REDACTED]");
    expect(clean.messageText).toBe("[REDACTED]");
    expect(clean.otp).toBe("[REDACTED]");
    expect(clean.safeField).toBe("User [REDACTED_PHONE] with ID [REDACTED_ID]");
    expect(clean.ok).toBe(true);
    expect(redactValue("Call 08091234567")).toBe("Call [REDACTED_PHONE]");
  });
});

describe("Step 1 — Money (whole kobo) & Timezone (UTC -> Africa/Lagos)", () => {
  it("stores money strictly as whole kobo integers without float drift", () => {
    expect(nairaStringToKobo("1500")).toBe(150000);
    expect(nairaStringToKobo("1,500.50")).toBe(150050);
    expect(nairaStringToKobo("19.99")).toBe(1999);
    expect(formatKoboAsNaira(150000)).toBe("₦1,500");
    expect(formatKoboAsNaira(150050)).toBe("₦1,500.50");
    expect(() => assertWholeKobo(12.5)).toThrow();
    expect(() => assertWholeKobo(-100)).toThrow();
  });

  it("displays UTC timestamps in Africa/Lagos (UTC+1)", () => {
    // 11:00 UTC -> 12:00 pm WAT in Africa/Lagos
    const lagos = formatLagosDateTime("2026-11-18T11:00:00.000Z");
    expect(lagos).toContain("12:00");
    expect(lagos).toContain("WAT");
  });
});

describe("Step 1 — Rate limiting & CAPTCHA", () => {
  beforeEach(() => {
    resetInMemoryRateLimits();
  });

  it("enforces cooldown and max requests per window", () => {
    const start = 1_700_000_000_000;
    const r1 = consumeInMemoryRateLimit("hash-a", 3, 900, 60, start);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    // Within 60s cooldown -> blocked
    const rCooldown = consumeInMemoryRateLimit("hash-a", 3, 900, 60, start + 10_000);
    expect(rCooldown.allowed).toBe(false);
    expect(rCooldown.retryAfterSeconds).toBe(50);

    // After cooldown -> allowed
    const r2 = consumeInMemoryRateLimit("hash-a", 3, 900, 60, start + 61_000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = consumeInMemoryRateLimit("hash-a", 3, 900, 60, start + 122_000);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    // 4th request inside 15-min window -> blocked
    const r4 = consumeInMemoryRateLimit("hash-a", 3, 900, 60, start + 183_000);
    expect(r4.allowed).toBe(false);
    expect(r4.retryAfterSeconds).toBeGreaterThan(0);

    // After 15-min window expires -> resets
    const r5 = consumeInMemoryRateLimit("hash-a", 3, 900, 60, start + 901_000);
    expect(r5.allowed).toBe(true);
  });

  it("rejects empty CAPTCHA tokens and honors dev bypass only in non-prod", async () => {
    const emptyRes = await verifyCaptchaToken("");
    expect(emptyRes.success).toBe(false);

    process.env.NEXT_PUBLIC_ENABLE_DEV_CAPTCHA = "true";
    delete process.env.TURNSTILE_SECRET_KEY;

    const badDev = await verifyCaptchaToken("wrong-token");
    expect(badDev.success).toBe(false);

    const goodDev = await verifyCaptchaToken("dev-captcha-passed");
    expect(goodDev.success).toBe(true);
  });
});

describe("Step 1 — Migration static security audit", () => {
  it("enables and forces RLS on every table and blocks admin self-selection", () => {
    const sqlPath = path.resolve(
      __dirname,
      "../supabase/migrations/0001_step1_setup_and_login.sql",
    );
    const sql = fs.readFileSync(sqlPath, "utf8");

    const tables = ["profiles", "consents", "rate_limits", "audit_log"];
    for (const table of tables) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`alter table public.${table} force row level security;`);
    }

    expect(sql).toContain("p_role not in ('customer', 'artisan')");
    expect(sql).toContain("Direct modification of protected profile fields is forbidden");
  });
});
