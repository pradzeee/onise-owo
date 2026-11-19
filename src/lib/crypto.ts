import crypto from "crypto";

function getHmacSecret(): string {
  const secret = process.env.HASH_HMAC_SECRET;
  if (secret && secret.length >= 16) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("HASH_HMAC_SECRET environment variable must be configured in production.");
  }

  // Deterministic development-only fallback so local tests work before .env.local is populated
  return "dev-only-insecure-hmac-secret-change-me";
}

/**
 * Produces a keyed HMAC-SHA256 hex digest scoped to a specific domain (e.g. "rate:phone").
 * Used so raw phone numbers, IPs, and later NINs are never stored or logged in plaintext.
 */
export function hmacHash(scope: string, value: string): string {
  return crypto
    .createHmac("sha256", getHmacSecret())
    .update(`${scope}:${value}`)
    .digest("hex");
}
