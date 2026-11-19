import { hmacHash } from "./crypto";
import { logger } from "./logger";
export { NIGERIAN_BANKS, type NigerianBank } from "./banks";

export interface PayoutRegistrationInput {
  fullName: string;
  accountNumber: string;
  bankCode: string;
  artisanUserId: string;
}

export interface PayoutRegistrationResult {
  recipientCode: string;
  subaccountCode: string | null;
}

export function validateNubanAccount(accountNumber: string, bankCode: string): {
  cleanAccountNumber: string;
  cleanBankCode: string;
} {
  const cleanAccountNumber = accountNumber.replace(/\s+/g, "").trim();
  const cleanBankCode = bankCode.trim();

  if (!/^\d{10}$/.test(cleanAccountNumber)) {
    throw new Error("Nigerian bank account number (NUBAN) must be exactly 10 digits.");
  }

  if (!/^\d{3,6}$/.test(cleanBankCode)) {
    throw new Error("Please select a valid Nigerian bank.");
  }

  return { cleanAccountNumber, cleanBankCode };
}

/**
 * Registers the artisan's payout account with Paystack and returns ONLY the
 * provider's recipient_code (and subaccount_code for Step 6 split payments).
 * Bank account number and bank code are NEVER stored in Postgres or logged.
 */
export async function createPaystackPayoutRecipient(
  input: PayoutRegistrationInput,
): Promise<PayoutRegistrationResult> {
  const { cleanAccountNumber, cleanBankCode } = validateNubanAccount(
    input.accountNumber,
    input.bankCode,
  );

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  const commissionPct = Number(process.env.PAYSTACK_PLATFORM_COMMISSION_PERCENT ?? "15");
  const isProd = process.env.NODE_ENV === "production";

  if (!secretKey) {
    if (isProd) {
      throw new Error("PAYSTACK_SECRET_KEY is not configured in production.");
    }

    // Local dev deterministic mock code (contains ZERO bank digits)
    const digest = hmacHash(
      "dev_paystack_recipient",
      `${input.artisanUserId}:${cleanBankCode}:${cleanAccountNumber}`,
    );

    logger.info("paystack.dev_mock_recipient_created", {
      artisanUserId: input.artisanUserId,
    });

    return {
      recipientCode: `RCP_dev_${digest.slice(0, 14)}`,
      subaccountCode: `ACCT_dev_${digest.slice(14, 28)}`,
    };
  }

  // 1. Create Paystack Transfer Recipient (NUBAN / NGN)
  const recipientRes = await fetch("https://api.paystack.co/transferrecipient", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "nuban",
      name: input.fullName.trim(),
      account_number: cleanAccountNumber,
      bank_code: cleanBankCode,
      currency: "NGN",
    }),
  });

  const recipientJson = (await recipientRes.json()) as {
    status?: boolean;
    message?: string;
    data?: { recipient_code?: string };
  };

  if (!recipientRes.ok || !recipientJson.status || !recipientJson.data?.recipient_code) {
    logger.warn("paystack.recipient_failed", {
      status: recipientRes.status,
      artisanUserId: input.artisanUserId,
    });
    throw new Error(
      recipientJson.message ||
        "Could not verify bank account with Paystack. Please double-check your account number and bank.",
    );
  }

  // 2. Also create Paystack Subaccount for Step 6 split payments (15% commission)
  let subaccountCode: string | null = null;
  try {
    const subRes = await fetch("https://api.paystack.co/subaccount", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        business_name: input.fullName.trim(),
        settlement_bank: cleanBankCode,
        account_number: cleanAccountNumber,
        percentage_charge: Number.isFinite(commissionPct) ? commissionPct : 15,
      }),
    });
    const subJson = (await subRes.json()) as {
      status?: boolean;
      data?: { subaccount_code?: string };
    };
    if (subRes.ok && subJson.status && subJson.data?.subaccount_code) {
      subaccountCode = subJson.data.subaccount_code;
    }
  } catch (err) {
    logger.warn("paystack.subaccount_optional_failed", {
      artisanUserId: input.artisanUserId,
      message: err instanceof Error ? err.message : "unknown",
    });
  }

  return {
    recipientCode: recipientJson.data.recipient_code,
    subaccountCode,
  };
}
