import "@/lib/server-dns";

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function extractMonthDayAfterKeyword(text: string): { month: number; day: number } | null {
  const lower = text.toLowerCase();

  if (!/\b(after|until|from)\b/.test(lower)) return null;

  // after Jan 13 / after January 13th
  {
    const m = lower.match(
      /\b(?:after|until|from)\b[^a-z0-9]{0,10}\b([a-z]{3,9})\b[^0-9]{0,10}(\d{1,2})(?:st|nd|rd|th)?\b/
    );
    if (m) {
      const month = MONTHS[m[1] || ""];
      const day = Number.parseInt(m[2] || "", 10);
      if (month && day >= 1 && day <= 31) return { month, day };
    }
  }

  // after 13 Jan / after 13th January
  {
    const m = lower.match(
      /\b(?:after|until|from)\b[^0-9]{0,10}(\d{1,2})(?:st|nd|rd|th)?\b[^a-z]{0,10}\b([a-z]{3,9})\b/
    );
    if (m) {
      const day = Number.parseInt(m[1] || "", 10);
      const month = MONTHS[m[2] || ""];
      if (month && day >= 1 && day <= 31) return { month, day };
    }
  }

  return null;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const year = Number.parseInt(get("year") || "", 10);
  const month = Number.parseInt(get("month") || "", 10);
  const day = Number.parseInt(get("day") || "", 10);
  const hour = Number.parseInt(get("hour") || "", 10);
  const minute = Number.parseInt(get("minute") || "", 10);
  const second = Number.parseInt(get("second") || "", 10);

  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return asUtc - date.getTime();
}

function zonedLocalToUtcDate(opts: {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour?: number;
  minute?: number;
  second?: number;
  timeZone: string;
}): Date | null {
  const hour = opts.hour ?? 9;
  const minute = opts.minute ?? 0;
  const second = opts.second ?? 0;

  const guess = new Date(Date.UTC(opts.year, opts.month - 1, opts.day, hour, minute, second));
  if (Number.isNaN(guess.getTime())) return null;

  try {
    // Two-pass offset adjustment handles most DST transitions.
    const offset1 = getTimeZoneOffsetMs(guess, opts.timeZone);
    const utc1 = new Date(guess.getTime() - offset1);
    const offset2 = getTimeZoneOffsetMs(utc1, opts.timeZone);
    return new Date(guess.getTime() - offset2);
  } catch {
    return null;
  }
}

/**
 * Detect a "contact me after X date" deferral from a message and return a UTC Date.
 * Deterministic best-effort, currently focused on month/day patterns.
 */
export function detectSnoozedUntilUtcFromMessage(opts: {
  messageText: string;
  now?: Date;
  timeZone: string; // Lead timezone preferred, workspace fallback
}): { snoozedUntilUtc: Date | null; confidence: number } {
  const now = opts.now ?? new Date();
  const md = extractMonthDayAfterKeyword(opts.messageText || "");
  if (!md) return { snoozedUntilUtc: null, confidence: 0 };

  const currentYear = now.getUTCFullYear();
  const candidateThisYear = new Date(Date.UTC(currentYear, md.month - 1, md.day, 0, 0, 0));
  if (Number.isNaN(candidateThisYear.getTime())) return { snoozedUntilUtc: null, confidence: 0 };

  const year = candidateThisYear.getTime() >= now.getTime() ? currentYear : currentYear + 1;
  const utc = zonedLocalToUtcDate({ year, month: md.month, day: md.day, hour: 9, timeZone: opts.timeZone });
  if (!utc) return { snoozedUntilUtc: null, confidence: 0 };

  // Only treat as a snooze if it's meaningfully in the future.
  if (utc.getTime() <= now.getTime() + 60 * 60 * 1000) {
    return { snoozedUntilUtc: null, confidence: 0 };
  }

  return { snoozedUntilUtc: utc, confidence: 0.99 };
}

