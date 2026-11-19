import crypto from "crypto";
import { hmacHash } from "./crypto";

export function generateGuarantorToken(): {
  rawToken: string;
  tokenHash: string;
} {
  const rawToken = crypto.randomBytes(24).toString("base64url");
  const tokenHash = hashGuarantorToken(rawToken);
  return { rawToken, tokenHash };
}

export function hashGuarantorToken(rawToken: string): string {
  return hmacHash("guarantor:token", rawToken.trim());
}

export function generateGuarantorOtp(guarantorVerificationId: string): {
  otp: string;
  otpHash: string;
  expiresAtIso: string;
} {
  const otp = String(crypto.randomInt(100000, 1000000));
  const otpHash = hashGuarantorOtp(guarantorVerificationId, otp);
  const expiresAtIso = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  return { otp, otpHash, expiresAtIso };
}

export function hashGuarantorOtp(
  guarantorVerificationId: string,
  otp: string,
): string {
  return hmacHash("guarantor:otp", `${guarantorVerificationId}:${otp.trim()}`);
}

export function verifyGuarantorOtpHash(
  guarantorVerificationId: string,
  candidateOtp: string,
  storedHash: string | null | undefined,
): boolean {
  if (!storedHash || !/^\d{6}$/.test(candidateOtp.trim())) {
    return false;
  }
  const expected = hashGuarantorOtp(guarantorVerificationId, candidateOtp);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
