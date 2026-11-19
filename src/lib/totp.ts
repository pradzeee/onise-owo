import crypto from "crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32(base32: string): Buffer {
  const clean = base32.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * Generates a 160-bit cryptographically random Base32 TOTP secret (RFC 6238).
 */
export function generateTotpSecret(): string {
  return encodeBase32(crypto.randomBytes(20));
}

/**
 * Builds an otpauth:// URI compatible with Google Authenticator, Authy, 1Password, etc.
 */
export function buildTotpOtpAuthUri(accountLabel: string, secretBase32: string): string {
  const issuer = "OniseOwoAdmin";
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountLabel)}?secret=${encodeURIComponent(secretBase32)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Computes a 6-digit RFC 6238 TOTP code for a given 30-second counter step.
 */
export function computeTotpCodeForStep(secretBase32: string, step: number): string {
  const key = decodeBase32(secretBase32);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(step), 0);

  const hmac = crypto.createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const code = binary % 1_000_000;
  return String(code).padStart(6, "0");
}

/**
 * Verifies a 6-digit TOTP code allowing ±1 30-second step for clock drift,
 * returning the matched step so the server can reject replay within the same step.
 */
export function verifyTotpCode(
  secretBase32: string,
  candidateCode: string,
  nowMs = Date.now(),
  lastUsedStep?: number | null,
): { valid: boolean; matchedStep: number | null } {
  const clean = candidateCode.replace(/\s+/g, "").trim();
  if (!/^\d{6}$/.test(clean)) {
    return { valid: false, matchedStep: null };
  }

  const currentStep = Math.floor(nowMs / 1000 / 30);
  for (const delta of [-1, 0, 1]) {
    const step = currentStep + delta;
    if (lastUsedStep !== null && lastUsedStep !== undefined && step <= lastUsedStep) {
      continue;
    }
    const expected = computeTotpCodeForStep(secretBase32, step);
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(clean, "utf8");
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { valid: true, matchedStep: step };
    }
  }

  return { valid: false, matchedStep: null };
}
