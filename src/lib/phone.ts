/**
 * Normalizes and validates Nigerian mobile phone numbers to E.164 (+234XXXXXXXXXX).
 * Accepts formats such as:
 *   08012345678
 *   0801 234 5678
 *   8012345678
 *   2348012345678
 *   +2348012345678
 *   +234 0801 234 5678
 */
const NIGERIAN_E164_REGEX = /^\+234(70|80|81|90|91)\d{8}$/;

export function normalizeNigerianPhone(rawInput: string): string {
  const stripped = rawInput.replace(/[\s\-()]/g, "").trim();
  if (!stripped) {
    throw new Error("Enter your Nigerian mobile number.");
  }

  let digits = stripped.startsWith("+") ? stripped.slice(1) : stripped;

  if (!/^\d+$/.test(digits)) {
    throw new Error("Phone number must contain digits only.");
  }

  // Handle "+234080..." accidental leading zero after country code
  if (digits.startsWith("2340") && digits.length === 14) {
    digits = `234${digits.slice(4)}`;
  }

  let e164: string;
  if (digits.startsWith("234") && digits.length === 13) {
    e164 = `+${digits}`;
  } else if (digits.startsWith("0") && digits.length === 11) {
    e164 = `+234${digits.slice(1)}`;
  } else if (digits.length === 10 && /^(70|80|81|90|91)/.test(digits)) {
    e164 = `+234${digits}`;
  } else {
    throw new Error(
      "Enter a valid Nigerian mobile number (e.g. 0803 123 4567 or +234 803 123 4567).",
    );
  }

  if (!NIGERIAN_E164_REGEX.test(e164)) {
    throw new Error(
      "Enter a valid Nigerian mobile number starting with 070, 080, 081, 090, or 091.",
    );
  }

  return e164;
}

/**
 * Returns a safe UI display hint without exposing the full number in logs.
 * Example: "+2348031234567" -> "+234 •••• 4567"
 */
export function maskPhoneForUi(e164Phone: string): string {
  const digits = e164Phone.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `+234 •••• ${digits.slice(-4)}`;
}
