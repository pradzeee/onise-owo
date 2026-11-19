import { logger } from "./logger";

export interface SendSmsInput {
  toE164: string;
  message: string;
  purpose: string;
}

export interface SendSmsResult {
  delivered: boolean;
  provider: string;
}

/**
 * Server-side Nigerian SMS dispatcher (Termii / Africa's Talking).
 * RULE: NEVER log phone numbers or message text.
 */
export async function sendNigerianSms(input: SendSmsInput): Promise<SendSmsResult> {
  const provider = (process.env.APP_SMS_PROVIDER ?? "dev_mock").toLowerCase();
  const isProd = process.env.NODE_ENV === "production";

  if (provider === "termii") {
    const apiKey = process.env.TERMII_API_KEY;
    const senderId = process.env.TERMII_SENDER_ID ?? "OniseOwo";
    const channel = process.env.TERMII_CHANNEL ?? "dnd";
    const baseUrl = process.env.TERMII_BASE_URL ?? "https://v3.api.termii.com";

    if (!apiKey) {
      throw new Error("TERMII_API_KEY is not configured.");
    }

    const res = await fetch(`${baseUrl}/api/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: input.toE164.replace(/^\+/, ""),
        from: senderId,
        sms: input.message,
        type: "plain",
        channel,
        api_key: apiKey,
      }),
    });

    if (!res.ok) {
      logger.warn("sms.termii_failed", { purpose: input.purpose, status: res.status });
      throw new Error("Could not send SMS right now.");
    }

    logger.info("sms.sent", { provider: "termii", purpose: input.purpose });
    return { delivered: true, provider: "termii" };
  }

  if (provider === "africas_talking") {
    const apiKey = process.env.AFRICAS_TALKING_API_KEY;
    const username = process.env.AFRICAS_TALKING_USERNAME;
    const senderId = process.env.AFRICAS_TALKING_SENDER_ID;
    const baseUrl =
      process.env.AFRICAS_TALKING_BASE_URL ??
      "https://api.africastalking.com/version1/messaging";

    if (!apiKey || !username) {
      throw new Error("Africa's Talking credentials are not configured.");
    }

    const form = new URLSearchParams();
    form.set("username", username);
    form.set("to", input.toE164.startsWith("+") ? input.toE164 : `+${input.toE164}`);
    form.set("message", input.message);
    if (senderId) form.set("from", senderId);

    const res = await fetch(baseUrl, {
      method: "POST",
      headers: {
        apiKey,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    if (!res.ok) {
      logger.warn("sms.at_failed", { purpose: input.purpose, status: res.status });
      throw new Error("Could not send SMS right now.");
    }

    logger.info("sms.sent", { provider: "africas_talking", purpose: input.purpose });
    return { delivered: true, provider: "africas_talking" };
  }

  if (provider === "dev_mock" && !isProd) {
    logger.info("sms.dev_mock_dispatched", { purpose: input.purpose });
    return { delivered: true, provider: "dev_mock" };
  }

  throw new Error(
    "APP_SMS_PROVIDER must be set to 'termii' or 'africas_talking' in production.",
  );
}
