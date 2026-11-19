/**
 * Adds N business days (skipping Saturdays & Sundays) in Africa/Lagos (UTC+1).
 * Used for the 2-business-day human review SLA on urgent safety suspensions.
 */
export function addBusinessDaysLagos(fromDate: Date, businessDays: number): Date {
  const result = new Date(fromDate.getTime());
  let remaining = Math.max(0, Math.floor(businessDays));

  while (remaining > 0) {
    result.setTime(result.getTime() + 24 * 60 * 60 * 1000);
    // Africa/Lagos is permanently UTC+1 (no DST)
    const lagosShifted = new Date(result.getTime() + 60 * 60 * 1000);
    const dayOfWeek = lagosShifted.getUTCDay(); // 0 = Sun, 6 = Sat
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      remaining -= 1;
    }
  }

  return result;
}
