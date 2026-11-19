import { APP_TIMEZONE } from "./constants";

/**
 * Always returns current UTC ISO-8601 timestamp for storage.
 */
export function nowUtcIso(): string {
  return new Date().toISOString();
}

/**
 * Formats a UTC timestamp for display in Africa/Lagos (WAT, UTC+1).
 */
export function formatLagosDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  const formatted = new Intl.DateTimeFormat("en-NG", {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);

  return `${formatted} WAT`;
}

export function formatLagosDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-NG", {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}
