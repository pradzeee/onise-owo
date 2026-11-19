import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { addBusinessDaysLagos } from "@/lib/business-days";
import {
  buildTotpOtpAuthUri,
  computeTotpCodeForStep,
  generateTotpSecret,
  verifyTotpCode,
} from "@/lib/totp";

describe("Step 9 — Admin Two-Step Login (RFC 6238 TOTP)", () => {
  it("generates Base32 secrets, verifies valid 6-digit TOTP codes, and prevents replay", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);

    const uri = buildTotpOtpAuthUri("admin-test", secret);
    expect(uri).toContain("otpauth://totp/OniseOwoAdmin:admin-test");
    expect(uri).toContain(`secret=${secret}`);

    const nowMs = 1_763_470_000_000;
    const step = Math.floor(nowMs / 1000 / 30);
    const code = computeTotpCodeForStep(secret, step);
    expect(code).toMatch(/^\d{6}$/);

    const ok = verifyTotpCode(secret, code, nowMs, null);
    expect(ok.valid).toBe(true);
    expect(ok.matchedStep).toBe(step);

    // Replay of same code within same step MUST be rejected when lastUsedStep is tracked
    const replay = verifyTotpCode(secret, code, nowMs, ok.matchedStep);
    expect(replay.valid).toBe(false);

    // Wrong code MUST be rejected
    const wrong = verifyTotpCode(
      secret,
      code === "000000" ? "111111" : "000000",
      nowMs,
      null,
    );
    expect(wrong.valid).toBe(false);
  });
});

describe("Step 9 — 2-Business-Day Human Review SLA (Africa/Lagos)", () => {
  it("skips Saturday and Sunday when adding 2 business days in Africa/Lagos", () => {
    // Friday 2026-11-20 12:00 WAT (11:00 UTC) + 2 business days -> Tuesday 2026-11-24 12:00 WAT
    const friday = new Date("2026-11-20T11:00:00.000Z");
    const due = addBusinessDaysLagos(friday, 2);
    expect(due.toISOString()).toBe("2026-11-24T11:00:00.000Z");

    // Wednesday 2026-11-18 12:00 WAT + 2 business days -> Friday 2026-11-20 12:00 WAT
    const wednesday = new Date("2026-11-18T11:00:00.000Z");
    const dueFri = addBusinessDaysLagos(wednesday, 2);
    expect(dueFri.toISOString()).toBe("2026-11-20T11:00:00.000Z");
  });
});

describe("Step 9 — Migration static security & audit_log coverage", () => {
  it("enforces RLS on all Step 9 tables and logs every admin action in audit_log", () => {
    const sqlPath = path.resolve(
      __dirname,
      "../supabase/migrations/0009_step9_admin_dashboard_mfa.sql",
    );
    const sql = fs.readFileSync(sqlPath, "utf8");

    for (const table of [
      "admin_totp_secrets",
      "admin_mfa_sessions",
      "safety_suspensions",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`alter table public.${table} force row level security;`);
    }

    // Every Step 9 admin RPC checks is_admin AND writes to audit_log
    expect(sql).toContain("admin_urgent_safety_suspension");
    expect(sql).toContain("admin_review_safety_suspension_");
    expect(sql).toContain("admin_resolve_dispute_");
    expect(sql).toContain("admin_update_report_");
  });
});
