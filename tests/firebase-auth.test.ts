import fs from "fs";
import path from "path";
import type { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { normalizeDisplayName } from "@/lib/firebase/server";
import {
  hasPlausibleFirebaseTokenCookie,
  signFirebaseSessionCookie,
  verifyFirebaseSessionCookie,
  type FirebaseSessionPayload,
} from "@/lib/firebase/session-cookie";
import { resolveAppBaseUrl } from "@/lib/http";

function makeFakeJwt(payloadObj: Record<string, unknown>): string {
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${b64({ alg: "RS256", kid: "k1" })}.${b64(payloadObj)}.sig`;
}

describe("Standardized Firebase Auth Session & Firestore Security", () => {
  it("signs and verifies HMAC session cookies and rejects tampered or expired tokens", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const payload: FirebaseSessionPayload = {
      uid: "fb-user-123",
      email: "tunde@gmail.com",
      displayName: "Tunde Bakare",
      role: "artisan",
      trade: "carpenter",
      phone: "+2348031234567",
      accountStatus: "active",
      verificationStatus: "unverified",
      iat: nowSec,
      exp: nowSec + 3600,
    };

    const signed = await signFirebaseSessionCookie(payload);
    expect(signed).toBeTruthy();

    const verified = await verifyFirebaseSessionCookie(signed);
    expect(verified?.uid).toBe("fb-user-123");
    expect(verified?.role).toBe("artisan");
    expect(verified?.trade).toBe("carpenter");

    // Tampered signature must be rejected
    const tampered = `${signed}x`;
    expect(await verifyFirebaseSessionCookie(tampered)).toBeNull();

    // Expired payload must be rejected
    const expiredCookie = await signFirebaseSessionCookie({
      ...payload,
      exp: nowSec - 10,
    });
    expect(await verifyFirebaseSessionCookie(expiredCookie)).toBeNull();
  });

  it("validates JWT structure and expiry cleanly in Edge helper", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const prevProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "onise-owo-ng-2026";

    const validJwt = makeFakeJwt({
      sub: "uid-abc",
      aud: "onise-owo-ng-2026",
      exp: nowSec + 3600,
    });
    expect(hasPlausibleFirebaseTokenCookie(validJwt)).toBe(true);

    const wrongAudJwt = makeFakeJwt({
      sub: "uid-abc",
      aud: "other-project",
      exp: nowSec + 3600,
    });
    expect(hasPlausibleFirebaseTokenCookie(wrongAudJwt)).toBe(false);

    const expiredJwt = makeFakeJwt({
      sub: "uid-abc",
      aud: "onise-owo-ng-2026",
      exp: nowSec - 5,
    });
    expect(hasPlausibleFirebaseTokenCookie(expiredJwt)).toBe(false);

    if (prevProjectId === undefined) {
      delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    } else {
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = prevProjectId;
    }
  });

  it("normalizes displayName to satisfy Firestore 2..100 trimmed length", () => {
    expect(normalizeDisplayName("A", "a@gmail.com")).toBe("A User");
    expect(normalizeDisplayName("", "kazeem@gmail.com")).toBe("kazeem");
    expect(normalizeDisplayName("  Babatunde   Adebayo  ")).toBe("Babatunde Adebayo");
  });

  it("ships locked-down Firestore security rules forbidding admin self-assignment", () => {
    const rulesPath = path.resolve(__dirname, "../firestore.rules");
    const rules = fs.readFileSync(rulesPath, "utf8");
    expect(rules).toContain("rules_version = '2';");
    expect(rules).toContain("data.role in ['customer', 'artisan']");
    expect(rules).toContain("allow delete: if false;");
    expect(rules).toContain("allow read, write: if false;");
  });

  it("ignores localhost NEXT_PUBLIC_APP_URL when running on Vercel", () => {
    const prevVercel = process.env.VERCEL;
    const prevAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL = "1";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

    const fakeReq = {
      nextUrl: { origin: "https://onise-owo.vercel.app" },
    } as unknown as NextRequest;

    expect(resolveAppBaseUrl(fakeReq)).toBe("https://onise-owo.vercel.app");

    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
    if (prevAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prevAppUrl;
  });
});
