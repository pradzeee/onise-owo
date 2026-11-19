// Supabase Edge Function: Auth Send SMS Hook for Nigerian SMS Providers
// Supports Termii (recommended for Nigeria DND routes) and Africa's Talking.
//
// SECURITY RULES:
// - Verifies Standard Webhooks signature from Supabase Auth (SEND_SMS_HOOK_SECRET).
// - NEVER logs phone numbers, OTP codes, or message text.
// - Returns standard JSON responses expected by Supabase Auth.

import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

interface SendSmsHookPayload {
  user: {
    id: string;
    phone: string;
  };
  sms: {
    otp: string;
  };
}

function buildOtpMessage(otp: string): string {
  return `Your Onise Owo verification code is ${otp}. It expires in 5 minutes. Never share this code with anyone.`;
}

async function sendViaTermii(phone: string, message: string): Promise<void> {
  const apiKey = Deno.env.get("TERMII_API_KEY");
  const senderId = Deno.env.get("TERMII_SENDER_ID") ?? "OniseOwo";
  const channel = Deno.env.get("TERMII_CHANNEL") ?? "dnd";
  const baseUrl = Deno.env.get("TERMII_BASE_URL") ?? "https://v3.api.termii.com";

  if (!apiKey) {
    throw new Error("TERMII_API_KEY is not configured");
  }

  // Termii expects international format without leading '+' (e.g., 2348012345678)
  const recipient = phone.replace(/^\+/, "");

  const res = await fetch(`${baseUrl}/api/sms/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: recipient,
      from: senderId,
      sms: message,
      type: "plain",
      channel,
      api_key: apiKey,
    }),
  });

  if (!res.ok) {
    throw new Error(`Termii SMS dispatch failed with HTTP ${res.status}`);
  }
}

async function sendViaAfricasTalking(phone: string, message: string): Promise<void> {
  const apiKey = Deno.env.get("AFRICAS_TALKING_API_KEY");
  const username = Deno.env.get("AFRICAS_TALKING_USERNAME");
  const senderId = Deno.env.get("AFRICAS_TALKING_SENDER_ID");
  const baseUrl =
    Deno.env.get("AFRICAS_TALKING_BASE_URL") ??
    "https://api.africastalking.com/version1/messaging";

  if (!apiKey || !username) {
    throw new Error("Africa's Talking credentials are not configured");
  }

  const form = new URLSearchParams();
  form.set("username", username);
  form.set("to", phone.startsWith("+") ? phone : `+${phone}`);
  form.set("message", message);
  if (senderId) {
    form.set("from", senderId);
  }

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
    throw new Error(`Africa's Talking SMS dispatch failed with HTTP ${res.status}`);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: { message: "Method not allowed" } }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const rawSecret = Deno.env.get("SEND_SMS_HOOK_SECRET");
    if (!rawSecret) {
      console.error("[send-sms-hook] Missing SEND_SMS_HOOK_SECRET");
      return new Response(
        JSON.stringify({ error: { http_code: 500, message: "SMS hook not configured" } }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const payloadText = await req.text();
    const headers = Object.fromEntries(req.headers.entries());

    // Supabase formats hook secrets as "v1,whsec_<base64>"
    const hookSecret = rawSecret.replace(/^v1,whsec_/, "");
    const wh = new Webhook(hookSecret);
    const verified = wh.verify(payloadText, headers) as SendSmsHookPayload;

    const phone = verified?.user?.phone;
    const otp = verified?.sms?.otp;

    if (!phone || !otp) {
      return new Response(
        JSON.stringify({ error: { http_code: 400, message: "Invalid SMS hook payload" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const message = buildOtpMessage(otp);
    const provider = (Deno.env.get("SMS_PROVIDER") ?? "termii").toLowerCase();

    if (provider === "termii") {
      await sendViaTermii(phone, message);
    } else if (provider === "africas_talking") {
      await sendViaAfricasTalking(phone, message);
    } else {
      throw new Error(`Unsupported SMS_PROVIDER: ${provider}`);
    }

    // Log ONLY safe non-PII metadata
    console.info("[send-sms-hook] OTP dispatched", {
      provider,
      userId: verified.user.id,
    });

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SMS delivery failed";
    console.error("[send-sms-hook] Error", { message });
    return new Response(
      JSON.stringify({
        error: {
          http_code: 500,
          message: "Failed to deliver verification code",
        },
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});
