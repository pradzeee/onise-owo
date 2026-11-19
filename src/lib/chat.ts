/**
 * Pure client/server chat safety helpers (zero Node.js dependencies).
 * RULE: Do not show phone numbers in chat; never log message text.
 */

export const CHAT_RETENTION_AFTER_END_DAYS = 7;

export const REPORT_CATEGORIES = [
  { id: "harassment", label: "Harassment or abusive language" },
  { id: "fraud_scam", label: "Suspected fraud or scam" },
  { id: "off_platform_solicitation", label: "Asking to pay or deal off-platform" },
  { id: "unsafe_behavior", label: "Unsafe or threatening behaviour" },
  { id: "no_show", label: "No-show or abandoned job" },
  { id: "other", label: "Other safety concern" },
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]["id"];

/**
 * Detects Nigerian or international phone numbers (even when spaced or dashed)
 * so chat protects both sides from phone number exposure.
 */
export function containsPhoneNumber(text: string): boolean {
  const normalized = text.replace(/[\s\-().]/g, "");
  // Nigerian mobile (+23470/80/81/90/91... or 070/080/081/090/091...)
  if (/(?:\+?234|0)[789][01]\d{8}/.test(normalized)) {
    return true;
  }
  // Any generic 10+ digit sequence resembling a phone number
  if (/(?:\+\d{10,15}|\b\d{10,15}\b)/.test(normalized)) {
    return true;
  }
  return false;
}
