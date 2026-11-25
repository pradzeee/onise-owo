import crypto from "crypto";
import { cookies } from "next/headers";
import type {
  AccountStatus,
  ArtisanTrade,
  OptionalConsentType,
  UserRole,
  VerificationStatus,
} from "@/lib/constants";
import { logger } from "@/lib/logger";
import {
  FIREBASE_SESSION_COOKIE_NAME,
  FIREBASE_TOKEN_COOKIE_NAME,
  hasSessionSigningSecret,
  signFirebaseSessionCookie,
  verifyFirebaseSessionCookie,
  type FirebaseSessionPayload,
} from "./session-cookie";

const GOOGLE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let cachedCerts: Record<string, string> | null = null;
let certsExpireAtMs = 0;

export interface VerifiedFirebaseToken {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
  signInProvider: string;
}

export interface FirebaseUserProfileDoc {
  uid: string;
  email: string;
  displayName: string;
  role: "customer" | "artisan";
  trade: ArtisanTrade | string | null;
  phone: string | null;
  accountStatus: "active" | "paused";
  verificationStatus: VerificationStatus;
  accepted18Plus: boolean;
  acceptedTermsVersion: string;
  acceptedPrivacyVersion: string;
  consents: Partial<Record<OptionalConsentType | "age_18_plus" | "terms_of_service" | "privacy_policy", boolean>>;
  createdAt: string;
  updatedAt: string;
}

export interface FirebaseTrustedContactDoc {
  contactName: string;
  contactPhone: string;
  updatedAt: string;
}

export function isFirebaseServerConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  );
}

/** Ensures displayName always satisfies Firestore trimmed length 2..100. */
export function normalizeDisplayName(rawName: string | undefined | null, fallbackEmail?: string): string {
  const candidate = (rawName ?? "").trim() || (fallbackEmail ? fallbackEmail.split("@")[0].trim() : "");
  const cleaned = candidate.replace(/\s+/g, " ").slice(0, 100);
  if (cleaned.length >= 2) return cleaned;
  if (cleaned.length === 1) return `${cleaned} User`;
  return "Onise User";
}

function getFirebaseProjectId(): string {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("NEXT_PUBLIC_FIREBASE_PROJECT_ID is not configured.");
  }
  return projectId;
}

function decodeBase64UrlJson<T>(segment: string): T {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as T;
}

function decodeBase64UrlBuffer(segment: string): Buffer {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

async function getGooglePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && cachedCerts && now < certsExpireAtMs) {
    return cachedCerts;
  }

  const res = await fetch(GOOGLE_CERTS_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch Firebase public keys (HTTP ${res.status}).`);
  }

  const certs = (await res.json()) as Record<string, string>;
  const cacheControl = res.headers.get("cache-control") ?? "";
  const maxAgeMatch = /max-age=(\d+)/i.exec(cacheControl);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;

  cachedCerts = certs;
  certsExpireAtMs = now + Math.max(60, maxAgeSec) * 1000;
  return certs;
}

/**
 * Cryptographically verifies a Firebase Auth ID Token (RS256) against Google's
 * rotating X.509 certificates without requiring a service account private key.
 */
export async function verifyFirebaseIdToken(
  idToken: string,
): Promise<VerifiedFirebaseToken> {
  const projectId = getFirebaseProjectId();
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed authentication token.");
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(headerB64);
  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Invalid authentication token algorithm.");
  }

  let certs = await getGooglePublicCerts(false);
  let pemCert = certs[header.kid];
  if (!pemCert) {
    certs = await getGooglePublicCerts(true);
    pemCert = certs[header.kid];
  }
  if (!pemCert) {
    throw new Error("Unable to match Firebase token signing key.");
  }

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();

  const signatureValid = verifier.verify(
    pemCert,
    decodeBase64UrlBuffer(signatureB64),
  );
  if (!signatureValid) {
    throw new Error("Invalid authentication token signature.");
  }

  const payload = decodeBase64UrlJson<{
    iss?: string;
    aud?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
    firebase?: { sign_in_provider?: string };
  }>(payloadB64);

  const nowSec = Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;

  if (payload.aud !== projectId) {
    throw new Error("Authentication token audience mismatch.");
  }
  if (payload.iss !== expectedIssuer) {
    throw new Error("Authentication token issuer mismatch.");
  }
  if (!payload.sub || payload.sub.length > 128) {
    throw new Error("Authentication token subject missing.");
  }
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) {
    throw new Error("Authentication session expired. Please sign in again.");
  }
  if (typeof payload.iat !== "number" || payload.iat > nowSec + 300) {
    throw new Error("Authentication token issued-at time is invalid.");
  }
  if (typeof payload.auth_time !== "number" || payload.auth_time > nowSec + 300) {
    throw new Error("Authentication token auth time is invalid.");
  }

  const email = (payload.email ?? "").trim().toLowerCase();
  const displayName = normalizeDisplayName(payload.name, email);

  return {
    uid: payload.sub,
    email,
    emailVerified: Boolean(payload.email_verified),
    name: displayName,
    signInProvider: payload.firebase?.sign_in_provider ?? "password",
  };
}

// ---------------------------------------------------------------------------
// Firestore REST API helpers using the verified user's Bearer ID Token
// ---------------------------------------------------------------------------

type FirestoreValue =
  | { stringValue: string }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { mapValue: { fields: Record<string, FirestoreValue> } };

function toFirestoreValue(val: unknown): FirestoreValue {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === "boolean") {
    return { booleanValue: val };
  }
  if (typeof val === "object" && !Array.isArray(val)) {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function fromFirestoreValue(val: FirestoreValue | undefined): unknown {
  if (!val) return null;
  if ("stringValue" in val) return val.stringValue;
  if ("booleanValue" in val) return val.booleanValue;
  if ("nullValue" in val) return null;
  if ("mapValue" in val && val.mapValue?.fields) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields)) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return null;
}

function getFirestoreDocUrl(collection: string, docId: string): string {
  const projectId = getFirebaseProjectId();
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId,
  )}/databases/(default)/documents/${encodeURIComponent(collection)}/${encodeURIComponent(docId)}`;
}

/** Reads `users/{uid}` from Cloud Firestore using the user's Bearer ID Token. */
export async function fetchFirestoreUserProfile(
  uid: string,
  idToken: string,
): Promise<FirebaseUserProfileDoc | null> {
  try {
    const res = await fetch(getFirestoreDocUrl("users", uid), {
      method: "GET",
      headers: { Authorization: `Bearer ${idToken}` },
      cache: "no-store",
    });

    if (res.status === 404) return null;
    if (!res.ok) {
      logger.warn("firestore.user_read_skipped", { status: res.status });
      return null;
    }

    const doc = (await res.json()) as { fields?: Record<string, FirestoreValue> };
    if (!doc.fields) return null;

    const parsed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(doc.fields)) {
      parsed[k] = fromFirestoreValue(v);
    }

    const role = parsed.role === "artisan" ? "artisan" : "customer";
    return {
      uid: String(parsed.uid ?? uid),
      email: String(parsed.email ?? ""),
      displayName: normalizeDisplayName(String(parsed.displayName ?? ""), String(parsed.email ?? "")),
      role,
      trade: role === "artisan" ? ((parsed.trade as string | null) ?? "plumber") : null,
      phone: (parsed.phone as string | null) ?? null,
      accountStatus: parsed.accountStatus === "paused" ? "paused" : "active",
      verificationStatus:
        (parsed.verificationStatus as VerificationStatus) ?? "unverified",
      accepted18Plus: Boolean(parsed.accepted18Plus),
      acceptedTermsVersion: String(parsed.acceptedTermsVersion ?? "2026-11-v1"),
      acceptedPrivacyVersion: String(parsed.acceptedPrivacyVersion ?? "2026-11-v1"),
      consents:
        (parsed.consents as FirebaseUserProfileDoc["consents"]) ?? {},
      createdAt: String(parsed.createdAt ?? new Date().toISOString()),
      updatedAt: String(parsed.updatedAt ?? new Date().toISOString()),
    };
  } catch (err) {
    logger.warn("firestore.user_read_error", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}

/** Creates or updates `users/{uid}` in Cloud Firestore under the user's ID Token. */
export async function saveFirestoreUserProfile(
  uid: string,
  idToken: string,
  profile: Partial<FirebaseUserProfileDoc>,
  updateFieldPaths?: string[],
): Promise<boolean> {
  try {
    const url = new URL(getFirestoreDocUrl("users", uid));
    if (updateFieldPaths && updateFieldPaths.length > 0) {
      for (const path of updateFieldPaths) {
        url.searchParams.append("updateMask.fieldPaths", path);
      }
    }

    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(profile)) {
      if (updateFieldPaths && !updateFieldPaths.includes(k)) continue;
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }

    const res = await fetch(url.toString(), {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      logger.warn("firestore.user_write_skipped", {
        status: res.status,
        reason: errText.slice(0, 120),
      });
      return false;
    }

    return true;
  } catch (err) {
    logger.warn("firestore.user_write_error", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return false;
  }
}

/** Reads `trusted_contacts/{uid}` from Cloud Firestore. */
export async function fetchFirestoreTrustedContact(
  uid: string,
  idToken: string,
): Promise<FirebaseTrustedContactDoc | null> {
  try {
    const res = await fetch(getFirestoreDocUrl("trusted_contacts", uid), {
      method: "GET",
      headers: { Authorization: `Bearer ${idToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const doc = (await res.json()) as { fields?: Record<string, FirestoreValue> };
    if (!doc.fields) return null;
    const contactName = String(fromFirestoreValue(doc.fields.contactName) ?? "");
    const contactPhone = String(fromFirestoreValue(doc.fields.contactPhone) ?? "");
    const updatedAt = String(fromFirestoreValue(doc.fields.updatedAt) ?? new Date().toISOString());
    if (!contactName || !contactPhone) return null;
    return { contactName, contactPhone, updatedAt };
  } catch {
    return null;
  }
}

/** Upserts `trusted_contacts/{uid}` in Cloud Firestore. */
export async function saveFirestoreTrustedContact(
  uid: string,
  idToken: string,
  contact: FirebaseTrustedContactDoc,
): Promise<boolean> {
  try {
    const res = await fetch(getFirestoreDocUrl("trusted_contacts", uid), {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          contactName: toFirestoreValue(contact.contactName),
          contactPhone: toFirestoreValue(contact.contactPhone),
          updatedAt: toFirestoreValue(contact.updatedAt),
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Deletes `trusted_contacts/{uid}` in Cloud Firestore. */
export async function deleteFirestoreTrustedContact(
  uid: string,
  idToken: string,
): Promise<boolean> {
  try {
    const res = await fetch(getFirestoreDocUrl("trusted_contacts", uid), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${idToken}` },
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

export interface ActiveFirebaseUser extends FirebaseSessionPayload {
  idToken: string | null;
}

/** Writes the standardized HTTP-only Firebase session cookies and clears legacy stubs. */
export async function setFirebaseSessionCookies(
  payload: Omit<FirebaseSessionPayload, "iat" | "exp">,
  idToken?: string | null,
): Promise<void> {
  const cookieStore = await cookies();
  const isProd = process.env.NODE_ENV === "production";
  const nowSec = Math.floor(Date.now() / 1000);
  const fullPayload: FirebaseSessionPayload = {
    ...payload,
    iat: nowSec,
    exp: nowSec + 60 * 60 * 24 * 7, // 7 days
  };

  if (hasSessionSigningSecret()) {
    const signed = await signFirebaseSessionCookie(fullPayload);
    if (signed) {
      cookieStore.set(FIREBASE_SESSION_COOKIE_NAME, signed, {
        httpOnly: true,
        sameSite: "lax",
        secure: isProd,
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    }
  }

  if (idToken) {
    cookieStore.set(FIREBASE_TOKEN_COOKIE_NAME, idToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      path: "/",
      maxAge: 60 * 60, // 1 hour matching Firebase ID Token TTL
    });
  }

  // Clean out legacy/conflicting auth & demo cookies
  cookieStore.delete("onise_dev_role");
  cookieStore.delete("onise_registered_users");
  cookieStore.delete("onise_user_email");
  cookieStore.delete("onise_user_role");
  cookieStore.delete("onise_user_name");
  cookieStore.delete("onise_user_phone");
  cookieStore.delete("onise_user_trade");
}

/**
 * Reads the currently signed-in Firebase user from HTTP-only server cookies.
 * Always returns null when unauthenticated (never auto-logs into mock accounts).
 */
export async function getActiveFirebaseSession(): Promise<ActiveFirebaseUser | null> {
  if (!isFirebaseServerConfigured()) return null;

  try {
    const cookieStore = await cookies();
    const rawSession = cookieStore.get(FIREBASE_SESSION_COOKIE_NAME)?.value;
    const rawToken = cookieStore.get(FIREBASE_TOKEN_COOKIE_NAME)?.value;

    const verifiedSession = await verifyFirebaseSessionCookie(rawSession);
    if (verifiedSession) {
      return {
        ...verifiedSession,
        idToken: rawToken ?? null,
      };
    }

    if (rawToken) {
      const verified = await verifyFirebaseIdToken(rawToken);
      const profile = await fetchFirestoreUserProfile(verified.uid, rawToken);
      const nowSec = Math.floor(Date.now() / 1000);
      return {
        uid: verified.uid,
        email: verified.email,
        displayName: profile?.displayName ?? verified.name,
        role: (profile?.role as UserRole | undefined) ?? null,
        trade: profile?.trade ?? null,
        phone: profile?.phone ?? null,
        accountStatus: (profile?.accountStatus as AccountStatus | undefined) ?? "active",
        verificationStatus: profile?.verificationStatus ?? "unverified",
        iat: nowSec,
        exp: nowSec + 3600,
        idToken: rawToken,
      };
    }

    return null;
  } catch {
    return null;
  }
}
