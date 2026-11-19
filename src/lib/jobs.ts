import crypto from "crypto";
import { hmacHash } from "./crypto";

export const MAX_JOB_PHOTOS = 3;
export const DISPATCH_ROUND_SECONDS = 60;
export const MAX_DISPATCH_ROUNDS = 3;
export const CANCEL_FEE_MIN_KOBO = 100_000; // ₦1,000
export const CANCEL_FEE_MAX_KOBO = 500_000; // ₦5,000

/**
 * Generates a fresh nonce and derives the 4-digit start code + its verification hash.
 * RULE: ONLY the nonce and start_code_hash are saved in Postgres — NEVER the plaintext 4-digit code!
 */
export function createStartCodeMaterial(jobId: string): {
  nonce: string;
  startCode: string;
  startCodeHash: string;
} {
  const nonce = crypto.randomBytes(16).toString("hex");
  const startCode = deriveCustomerStartCode(jobId, nonce);
  const startCodeHash = hashStartCode(jobId, startCode);
  return { nonce, startCode, startCodeHash };
}

/**
 * Re-derives the 4-digit code on the server exclusively for the authenticated customer
 * so the customer always sees their start code without storing plaintext in Postgres.
 */
export function deriveCustomerStartCode(jobId: string, nonce: string): string {
  const digest = hmacHash("job:start_code_derive", `${jobId}:${nonce}`);
  const num = parseInt(digest.slice(0, 8), 16) % 9000 + 1000;
  return String(num);
}

/**
 * Produces the stored HMAC-SHA256 verification hash of a 4-digit start code.
 */
export function hashStartCode(jobId: string, fourDigitCode: string): string {
  const clean = fourDigitCode.trim();
  if (!/^\d{4}$/.test(clean)) {
    throw new Error("Start code must be exactly 4 digits.");
  }
  return hmacHash("job:start_code_verify", `${jobId}:${clean}`);
}

/**
 * Calculates whole-kobo cancellation fee according to Terms:
 * - Free (0 kobo) before artisan is en_route, or if artisan cancels
 * - After en_route (en_route / arrived) when customer cancels:
 *   10% of accepted quote, clamped between ₦1,000 (100,000 kobo) and ₦5,000 (500,000 kobo)
 */
export function calculateCancelFeeKobo(params: {
  cancelledByRole: "customer" | "artisan";
  jobStatus: string;
  acceptedAmountKobo: number | null;
}): number {
  if (params.cancelledByRole !== "customer") return 0;
  if (params.jobStatus !== "en_route" && params.jobStatus !== "arrived") return 0;

  const tenPercent = Math.floor((params.acceptedAmountKobo ?? 0) / 10);
  return Math.min(Math.max(tenPercent, CANCEL_FEE_MIN_KOBO), CANCEL_FEE_MAX_KOBO);
}

export function generateJobShareToken(): {
  rawToken: string;
  tokenHash: string;
} {
  const rawToken = crypto.randomBytes(24).toString("base64url");
  return {
    rawToken,
    tokenHash: hashJobShareToken(rawToken),
  };
}

export function hashJobShareToken(rawToken: string): string {
  return hmacHash("job:share_token", rawToken.trim());
}
