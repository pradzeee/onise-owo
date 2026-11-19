/**
 * Money helpers: ALL stored monetary amounts are whole integers in kobo (never decimals).
 * 1 Naira (₦1) = 100 kobo.
 */

export function assertWholeKobo(amountKobo: number): number {
  if (!Number.isSafeInteger(amountKobo) || amountKobo < 0) {
    throw new Error("Money must be a non-negative whole integer in kobo.");
  }
  return amountKobo;
}

/**
 * Converts a user-entered Naira string (e.g. "1500" or "1500.50") to whole kobo
 * using pure integer string parsing (no floating-point rounding drift).
 */
export function nairaStringToKobo(input: string): number {
  const cleaned = input.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error("Enter a valid amount in Naira.");
  }

  const [nairaPart, koboPart = ""] = cleaned.split(".");
  const paddedKobo = koboPart.padEnd(2, "0");
  const total = Number(nairaPart) * 100 + Number(paddedKobo);
  return assertWholeKobo(total);
}

/**
 * Formats whole kobo into a Nigerian Naira string (e.g., 150000 -> "₦1,500").
 */
export function formatKoboAsNaira(amountKobo: number): string {
  const safe = assertWholeKobo(amountKobo);
  const naira = Math.floor(safe / 100);
  const kobo = safe % 100;
  const formattedNaira = naira.toLocaleString("en-NG");
  if (kobo === 0) {
    return `₦${formattedNaira}`;
  }
  return `₦${formattedNaira}.${String(kobo).padStart(2, "0")}`;
}
