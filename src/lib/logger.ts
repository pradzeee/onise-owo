/**
 * Safe structured logger.
 * RULE: Never log phone numbers, NINs, addresses, or message text.
 */

const FORBIDDEN_KEY_PATTERN =
  /phone|mobile|msisdn|nin|bvn|address|street|message|sms|otp|code|token|secret|password|authorization|cookie|guarantor/i;

const EMBEDDED_PHONE_PATTERN = /(?:\+?234|0)[789][01]\d{8}\b/g;
const EMBEDDED_LONG_DIGITS_PATTERN = /\b\d{11}\b/g;

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(EMBEDDED_PHONE_PATTERN, "[REDACTED_PHONE]")
      .replace(EMBEDDED_LONG_DIGITS_PATTERN, "[REDACTED_ID]");
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === "object") {
    return sanitizeLogMeta(value as Record<string, unknown>);
  }
  return value;
}

export function sanitizeLogMeta(
  meta: Record<string, unknown> = {},
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(meta)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      clean[key] = "[REDACTED]";
    } else {
      clean[key] = redactValue(val);
    }
  }
  return clean;
}

export const logger = {
  info(event: string, meta?: Record<string, unknown>) {
    console.info(
      JSON.stringify({
        level: "info",
        event: redactValue(event),
        ts: new Date().toISOString(),
        ...sanitizeLogMeta(meta),
      }),
    );
  },
  warn(event: string, meta?: Record<string, unknown>) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: redactValue(event),
        ts: new Date().toISOString(),
        ...sanitizeLogMeta(meta),
      }),
    );
  },
  error(event: string, meta?: Record<string, unknown>) {
    console.error(
      JSON.stringify({
        level: "error",
        event: redactValue(event),
        ts: new Date().toISOString(),
        ...sanitizeLogMeta(meta),
      }),
    );
  },
};
