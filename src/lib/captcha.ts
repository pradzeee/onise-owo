import { logger } from "./logger";

export interface CaptchaVerifyResult {
  success: boolean;
  error?: string;
}

/**
 * Verifies Cloudflare Turnstile CAPTCHA tokens on the server.
 * - In production, TURNSTILE_SECRET_KEY is strictly required.
 * - In local development (NODE_ENV !== "production"), if TURNSTILE_SECRET_KEY is not set
 *   and NEXT_PUBLIC_ENABLE_DEV_CAPTCHA === "true", accepts the explicit dev check token
 *   produced by the interactive dev CAPTCHA widget.
 */
export async function verifyCaptchaToken(
  token: string,
  remoteIp?: string,
): Promise<CaptchaVerifyResult> {
  const trimmed = token.trim();
  if (!trimmed) {
    return { success: false, error: "Please complete the human verification check." };
  }

  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  const isProd = process.env.NODE_ENV === "production";

  if (!secretKey) {
    if (!isProd && process.env.NEXT_PUBLIC_ENABLE_DEV_CAPTCHA === "true") {
      if (trimmed === "dev-captcha-passed") {
        return { success: true };
      }
      return { success: false, error: "Please tick the human verification box." };
    }

    logger.error("captcha.misconfigured", { reason: "Missing TURNSTILE_SECRET_KEY" });
    return {
      success: false,
      error: "Verification service is not configured. Please contact support.",
    };
  }

  try {
    const form = new URLSearchParams();
    form.set("secret", secretKey);
    form.set("response", trimmed);
    if (remoteIp && remoteIp !== "unknown") {
      form.set("remoteip", remoteIp);
    }

    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      },
    );

    if (!res.ok) {
      logger.warn("captcha.http_error", { status: res.status });
      return {
        success: false,
        error: "Could not verify CAPTCHA right now. Please try again.",
      };
    }

    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (!data.success) {
      logger.warn("captcha.failed", { codes: data["error-codes"] ?? [] });
      return {
        success: false,
        error: "CAPTCHA verification expired or failed. Please try again.",
      };
    }

    return { success: true };
  } catch (err) {
    logger.error("captcha.exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return {
      success: false,
      error: "Network issue verifying CAPTCHA. Please try again.",
    };
  }
}
