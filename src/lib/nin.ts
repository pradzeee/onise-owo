import crypto from "crypto";
import { hmacHash } from "./crypto";
import { logger } from "./logger";

export interface NinVerificationInput {
  nin: string;
  selfieBase64: string;
  idempotencyKey?: string;
}

export interface NinVerificationResult {
  providerName: string;
  providerReference: string;
  providerStatus: "pending" | "passed" | "failed";
  livenessPassed: boolean;
  faceMatchPassed: boolean;
}

/**
 * Validates Nigerian 11-digit NIN format. Never logs the NIN.
 */
export function validateNinFormat(rawNin: string): string {
  const digits = rawNin.replace(/[\s-]/g, "").trim();
  if (!/^\d{11}$/.test(digits)) {
    throw new Error("NIN must be exactly 11 digits.");
  }
  return digits;
}

/**
 * Keyed HMAC-SHA256 hash of NIN for duplicate-account prevention in identity_hashes.
 * Raw NIN is NEVER stored in the database.
 */
export function hashNinForIdentity(ninDigits: string): string {
  return hmacHash("identity:nin", ninDigits);
}

/**
 * Keyed HMAC-SHA256 hash of E.164 phone number for identity_hashes.
 */
export function hashPhoneForIdentity(e164Phone: string): string {
  return hmacHash("identity:phone", e164Phone);
}

async function verifyViaDojah(
  nin: string,
  selfieBase64: string,
): Promise<NinVerificationResult> {
  const appId = process.env.DOJAH_APP_ID;
  const secretKey = process.env.DOJAH_SECRET_KEY;
  const baseUrl = process.env.DOJAH_BASE_URL ?? "https://api.dojah.io";

  if (!appId || !secretKey) {
    throw new Error("Dojah credentials (DOJAH_APP_ID / DOJAH_SECRET_KEY) are not configured.");
  }

  const res = await fetch(`${baseUrl}/api/v1/kyc/nin/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      AppId: appId,
      Authorization: secretKey,
    },
    body: JSON.stringify({
      nin,
      selfie_image: selfieBase64,
    }),
  });

  if (!res.ok) {
    logger.warn("nin.provider_http_error", { provider: "dojah", status: res.status });
    throw new Error("Verification provider could not process the request right now.");
  }

  const data = (await res.json()) as {
    entity?: {
      selfie_verification?: {
        match?: boolean;
        confidence_value?: number;
      };
      liveness?: {
        passed?: boolean;
      };
      reference_id?: string;
    };
  };

  const faceMatch = Boolean(data.entity?.selfie_verification?.match);
  // Some Dojah tiers return liveness inside selfie_verification confidence; treat explicit false as failed
  const liveness =
    data.entity?.liveness?.passed !== undefined
      ? Boolean(data.entity.liveness.passed)
      : faceMatch && (data.entity?.selfie_verification?.confidence_value ?? 0) >= 85;
  const passed = faceMatch && liveness;

  return {
    providerName: "dojah",
    providerReference:
      data.entity?.reference_id ?? `dojah_${crypto.randomBytes(8).toString("hex")}`,
    providerStatus: passed ? "passed" : "failed",
    livenessPassed: liveness,
    faceMatchPassed: faceMatch,
  };
}

async function verifyViaPrembly(
  nin: string,
  selfieBase64: string,
): Promise<NinVerificationResult> {
  const apiKey = process.env.PREMBLY_API_KEY;
  const appId = process.env.PREMBLY_APP_ID;
  const baseUrl = process.env.PREMBLY_BASE_URL ?? "https://api.prembly.com";

  if (!apiKey || !appId) {
    throw new Error("Prembly credentials (PREMBLY_API_KEY / PREMBLY_APP_ID) are not configured.");
  }

  const res = await fetch(
    `${baseUrl}/identitypass/api/v2/biometrics/merchant/data/verification/nin_w_face`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "app-id": appId,
      },
      body: JSON.stringify({
        number: nin,
        image: selfieBase64,
        liveness_check: true,
      }),
    },
  );

  if (!res.ok) {
    logger.warn("nin.provider_http_error", { provider: "prembly", status: res.status });
    throw new Error("Verification provider could not process the request right now.");
  }

  const data = (await res.json()) as {
    status?: boolean;
    verification?: {
      status?: string;
      reference?: string;
    };
    face_data?: {
      status?: boolean;
      liveness?: boolean;
    };
  };

  const faceMatch = Boolean(data.face_data?.status);
  const liveness =
    data.face_data?.liveness !== undefined ? Boolean(data.face_data.liveness) : faceMatch;
  const passed =
    Boolean(data.status) &&
    data.verification?.status === "VERIFIED" &&
    faceMatch &&
    liveness;

  return {
    providerName: "prembly",
    providerReference:
      data.verification?.reference ?? `prembly_${crypto.randomBytes(8).toString("hex")}`,
    providerStatus: passed ? "passed" : "failed",
    livenessPassed: liveness,
    faceMatchPassed: faceMatch,
  };
}

/**
 * Sends NIN and live selfie ONLY to the configured licensed verification provider
 * requesting face match + liveness check. Never persists or logs the NIN.
 */
export async function verifyNinWithFaceAndLiveness(
  input: NinVerificationInput,
): Promise<NinVerificationResult> {
  const cleanNin = validateNinFormat(input.nin);
  if (!input.selfieBase64 || input.selfieBase64.length < 100) {
    throw new Error("A live selfie photo is required for face matching and liveness check.");
  }

  const provider = (process.env.NIN_VERIFICATION_PROVIDER ?? "dev_mock").toLowerCase();
  const isProd = process.env.NODE_ENV === "production";

  if (provider === "dojah") {
    return verifyViaDojah(cleanNin, input.selfieBase64);
  }

  if (provider === "prembly") {
    return verifyViaPrembly(cleanNin, input.selfieBase64);
  }

  if (provider === "dev_mock" && !isProd) {
    // Deterministic dev mock for local testing (forbidden in production):
    // NIN "00000000000" simulates a failed liveness/face match; any other valid 11-digit NIN passes.
    const shouldFail = cleanNin === "00000000000";
    const refHash = hmacHash(
      "dev_nin_ref",
      input.idempotencyKey ?? `${Date.now()}-${Math.random()}`,
    ).slice(0, 16);

    logger.info("nin.dev_mock_checked", { passed: !shouldFail });

    return {
      providerName: "dev_mock",
      providerReference: `dev_nin_${refHash}`,
      providerStatus: shouldFail ? "failed" : "passed",
      livenessPassed: !shouldFail,
      faceMatchPassed: !shouldFail,
    };
  }

  throw new Error(
    "NIN verification provider is not configured for production. Set NIN_VERIFICATION_PROVIDER to 'dojah' or 'prembly'.",
  );
}
