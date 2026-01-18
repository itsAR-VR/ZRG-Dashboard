/**
 * Business hours utilities for response time analytics.
 * Fixed at 9am-5pm EST (America/New_York) as per requirements.
 */

const EST_TIMEZONE = "America/New_York";
const BUSINESS_HOURS_START = 9; // 9am
const BUSINESS_HOURS_END = 17; // 5pm

/**
 * Get the hour and weekday of a date in EST timezone.
 * Uses Intl.DateTimeFormat for proper DST handling.
 */
function getEstDateParts(date: Date): { hour: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: EST_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
    parts.find((p) => p.type === type)?.value;

  const weekdayLabel = get("weekday") || "Sun";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdayMap[weekdayLabel] ?? 0;

  let hour = Number.parseInt(get("hour") || "0", 10);
  // Intl.DateTimeFormat with hour12: false returns 24 for midnight in some locales
  if (hour === 24) hour = 0;

  return { hour, weekday };
}

/**
 * Check if a given date is within business hours (9am-5pm EST, weekdays only).
 * @param date The date to check
 * @returns true if within business hours, false otherwise
 */
export function isWithinEstBusinessHours(date: Date): boolean {
  const { hour, weekday } = getEstDateParts(date);

  // Exclude weekends (0 = Sunday, 6 = Saturday)
  if (weekday === 0 || weekday === 6) {
    return false;
  }

  // Check if hour is within 9am-5pm (9:00-16:59)
  // 5pm exactly is outside because by 5:00pm the business day is ending
  return hour >= BUSINESS_HOURS_START && hour < BUSINESS_HOURS_END;
}

/**
 * Check if both timestamps in a response pair are within business hours.
 * @param timestamp1 First timestamp (e.g., inbound message time)
 * @param timestamp2 Second timestamp (e.g., outbound response time)
 * @returns true if both are within business hours
 */
export function areBothWithinEstBusinessHours(timestamp1: Date, timestamp2: Date): boolean {
  return isWithinEstBusinessHours(timestamp1) && isWithinEstBusinessHours(timestamp2);
}

/**
 * Format milliseconds into a human-readable duration string.
 * @param ms Duration in milliseconds
 * @returns Formatted string like "15m", "2.4h", "1.5d"
 */
export function formatDurationMs(ms: number): string {
  const minutes = Math.round(ms / (1000 * 60));

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = ms / (1000 * 60 * 60);
  if (hours < 24) {
    return `${hours.toFixed(1)}h`;
  }

  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}
