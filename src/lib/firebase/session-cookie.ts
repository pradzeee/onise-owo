import type { AccountStatus, ArtisanTrade, UserRole, VerificationStatus } from "@/lib/constants";

export const FIREBASE_SESSION_COOKIE_NAME = "onise_fb_session";
export const FIREBASE_TOKEN_COOKIE_NAME = "onise_fb_token";

export interface FirebaseSessionPayload {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole | null;
  trade: ArtisanTrade | string | null;
  phone: string | null;
  accountStatus: AccountStatus;
  verificationStatus: VerificationStatus;
  iat: number;
  exp: number;
}

function getSigningSecret(): string | null {
  const secret = process.env.HASH_HMAC_SECRET || process.env.SESSION_HMAC_SECRET;
  if (secret && secret.length >= 16) {
    return secret;
  }
  if (process.env.NODE_ENV !== "production") {
    return "dev-only-insecure-hmac-secret-change-me";
  }
  return null;
}

export function hasSessionSigningSecret(): boolean {
  return getSigningSecret() !== null;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): Uint8Array | null {
  try {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function importHmacKey(secret: string, usage: KeyUsage): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return globalThis.crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

/** Signs a session payload with HMAC-SHA256 using Web Crypto (works in Edge & Node). */
export async function signFirebaseSessionCookie(
  payload: FirebaseSessionPayload,
): Promise<string | null> {
  const secret = getSigningSecret();
  if (!secret) return null;

  const enc = new TextEncoder();
  const payloadB64 = toBase64Url(enc.encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret, "sign");
  const sigBuf = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(payloadB64),
  );
  const sigB64 = toBase64Url(new Uint8Array(sigBuf));
  return `${payloadB64}.${sigB64}`;
}

/** Verifies and decodes an HMAC-signed session cookie in Edge or Node runtime. */
export async function verifyFirebaseSessionCookie(
  rawCookie: string | undefined | null,
): Promise<FirebaseSessionPayload | null> {
  if (!rawCookie) return null;
  const secret = getSigningSecret();
  if (!secret) return null;

  const dotIdx = rawCookie.indexOf(".");
  if (dotIdx <= 0) return null;

  const payloadB64 = rawCookie.slice(0, dotIdx);
  const sigB64 = rawCookie.slice(dotIdx + 1);
  const sigBytes = fromBase64Url(sigB64);
  const payloadBytes = fromBase64Url(payloadB64);
  if (!sigBytes || !payloadBytes) return null;

  const enc = new TextEncoder();
  const key = await importHmacKey(secret, "verify");
  const sigCopy = new Uint8Array(sigBytes.length);
  sigCopy.set(sigBytes);
  const valid = await globalThis.crypto.subtle.verify(
    "HMAC",
    key,
    sigCopy.buffer,
    enc.encode(payloadB64),
  );
  if (!valid) return null;

  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(payloadBytes),
    ) as FirebaseSessionPayload;
    if (!parsed.uid || typeof parsed.exp !== "number") return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (parsed.exp <= nowSec) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Lightweight JWT expiry/claim sanity check for Edge middleware fallback when
 * HASH_HMAC_SECRET is unset; full RS256 verification runs in Node Server/API routes.
 */
export function hasPlausibleFirebaseTokenCookie(rawToken: string | undefined | null): boolean {
  if (!rawToken) return false;
  const parts = rawToken.split(".");
  if (parts.length !== 3) return false;
  const payloadBytes = fromBase64Url(parts[1]);
  if (!payloadBytes) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
      sub?: unknown;
      exp?: unknown;
      aud?: unknown;
    };
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const nowSec = Math.floor(Date.now() / 1000);
    return (
      typeof payload.sub === "string" &&
      payload.sub.length > 0 &&
      typeof payload.exp === "number" &&
      payload.exp > nowSec &&
      (!projectId || payload.aud === projectId)
    );
  } catch {
    return false;
  }
}
