import crypto from "crypto";
import { assertWholeKobo } from "./money";
import { logger } from "./logger";

export const PLATFORM_COMMISSION_PERCENT = 15;
export const DEFAULT_FIRST_TIME_CUSTOMER_MAX_KOBO = 5_000_000; // ₦50,000 in whole kobo

export const DISPUTE_REASONS = [
  { id: "incomplete_work", label: "Work was not completed" },
  { id: "poor_quality", label: "Work quality does not match agreed quote" },
  { id: "property_damage", label: "Accidental damage to property" },
  { id: "overcharge_dispute", label: "Price or extra-charges dispute" },
  { id: "no_show", label: "Artisan did not show up / abandoned job" },
  { id: "other", label: "Other issue" },
] as const;

export type DisputeReason = (typeof DISPUTE_REASONS)[number]["id"];

/**
 * Returns the configured whole-kobo cap for first-time customers (0 confirmed jobs).
 */
export function getFirstTimeCustomerMaxKobo(): number {
  const raw = process.env.FIRST_TIME_CUSTOMER_MAX_JOB_KOBO;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_FIRST_TIME_CUSTOMER_MAX_KOBO;
}

/**
 * Computes the 15% platform commission strictly in whole kobo integers.
 */
export function calculateCommissionKobo(amountKobo: number): number {
  const safe = assertWholeKobo(amountKobo);
  // Exact integer half-up rounding for 15%: floor((amount * 15 + 50) / 100)
  return Math.floor((safe * PLATFORM_COMMISSION_PERCENT + 50) / 100);
}

/**
 * Verifies a Paystack webhook HMAC-SHA512 signature (`x-paystack-signature`)
 * using timing-safe comparison.
 */
export function verifyPaystackWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secretKey = process.env.PAYSTACK_SECRET_KEY,
): boolean {
  if (!secretKey || !signatureHeader) {
    return false;
  }

  const expectedHex = crypto
    .createHmac("sha512", secretKey)
    .update(rawBody)
    .digest("hex");

  const provided = signatureHeader.trim().toLowerCase();
  if (!/^[0-9a-f]{128}$/.test(provided)) {
    return false;
  }

  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export interface PaystackInitializeInput {
  email: string;
  amountKobo: number;
  commissionKobo: number;
  subaccountCode: string | null;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
}

export interface PaystackInitializeResult {
  authorizationUrl: string;
  reference: string;
  isMock: boolean;
}

/**
 * Initializes a Paystack transaction on the server using the artisan's subaccount
 * and 15% platform commission (`transaction_charge = commissionKobo`).
 * Never trusts client-supplied amounts.
 */
export async function initializePaystackTransaction(
  input: PaystackInitializeInput,
): Promise<PaystackInitializeResult> {
  const amountKobo = assertWholeKobo(input.amountKobo);
  const commissionKobo = assertWholeKobo(input.commissionKobo);
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  const isProd = process.env.NODE_ENV === "production";

  if (!secretKey) {
    if (isProd) {
      throw new Error("PAYSTACK_SECRET_KEY is not configured in production.");
    }

    logger.info("payments.dev_mock_initialized", {
      reference: input.reference,
      amountKobo,
      commissionKobo,
    });

    return {
      authorizationUrl: `${input.callbackUrl}${input.callbackUrl.includes("?") ? "&" : "?"}mock_ref=${encodeURIComponent(input.reference)}`,
      reference: input.reference,
      isMock: true,
    };
  }

  const payload: Record<string, unknown> = {
    email: input.email,
    amount: amountKobo, // Paystack expects amount in whole kobo!
    currency: "NGN",
    reference: input.reference,
    callback_url: input.callbackUrl,
    metadata: input.metadata,
  };

  if (input.subaccountCode && !input.subaccountCode.startsWith("ACCT_dev_")) {
    payload.subaccount = input.subaccountCode;
    payload.transaction_charge = commissionKobo;
    payload.bearer = "account";
  }

  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json()) as {
    status?: boolean;
    message?: string;
    data?: { authorization_url?: string; reference?: string };
  };

  if (!res.ok || !json.status || !json.data?.authorization_url) {
    logger.warn("payments.paystack_init_failed", {
      status: res.status,
      reference: input.reference,
    });
    throw new Error(
      json.message || "Could not start Paystack payment right now. Please try again.",
    );
  }

  return {
    authorizationUrl: json.data.authorization_url,
    reference: json.data.reference ?? input.reference,
    isMock: false,
  };
}

export interface ReconciliationSummary {
  reportDate: string;
  ourPaidCount: number;
  ourPaidTotalKobo: number;
  ourCommissionTotalKobo: number;
  paystackPaidCount: number;
  paystackPaidTotalKobo: number;
  missingInOurDbRefs: string[];
  missingInPaystackRefs: string[];
  amountMismatchRefs: string[];
  status: "matched" | "discrepancy" | "skipped_mock";
}

/**
 * Pure comparison helper comparing our paid payment records against Paystack settled records.
 */
export function compareReconciliationRecords(
  reportDate: string,
  ourRecords: { provider_reference: string; amount_kobo: number; commission_kobo: number }[],
  paystackRecords: { reference: string; amount: number }[],
): ReconciliationSummary {
  const ourMap = new Map<string, number>();
  let ourPaidTotalKobo = 0;
  let ourCommissionTotalKobo = 0;

  for (const r of ourRecords) {
    ourMap.set(r.provider_reference, Number(r.amount_kobo));
    ourPaidTotalKobo += Number(r.amount_kobo);
    ourCommissionTotalKobo += Number(r.commission_kobo);
  }

  const paystackMap = new Map<string, number>();
  let paystackPaidTotalKobo = 0;
  for (const p of paystackRecords) {
    paystackMap.set(p.reference, Number(p.amount));
    paystackPaidTotalKobo += Number(p.amount);
  }

  const missingInOurDbRefs: string[] = [];
  const missingInPaystackRefs: string[] = [];
  const amountMismatchRefs: string[] = [];

  for (const [ref, psAmount] of paystackMap.entries()) {
    const ourAmount = ourMap.get(ref);
    if (ourAmount === undefined) {
      missingInOurDbRefs.push(ref);
    } else if (ourAmount !== psAmount) {
      amountMismatchRefs.push(ref);
    }
  }

  for (const ref of ourMap.keys()) {
    if (!paystackMap.has(ref)) {
      missingInPaystackRefs.push(ref);
    }
  }

  const hasDiscrepancy =
    missingInOurDbRefs.length > 0 ||
    missingInPaystackRefs.length > 0 ||
    amountMismatchRefs.length > 0 ||
    ourPaidTotalKobo !== paystackPaidTotalKobo;

  return {
    reportDate,
    ourPaidCount: ourRecords.length,
    ourPaidTotalKobo,
    ourCommissionTotalKobo,
    paystackPaidCount: paystackRecords.length,
    paystackPaidTotalKobo,
    missingInOurDbRefs,
    missingInPaystackRefs,
    amountMismatchRefs,
    status: hasDiscrepancy ? "discrepancy" : "matched",
  };
}
