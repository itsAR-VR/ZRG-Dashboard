export function isWorkspaceFollowUpsPaused(opts: {
  followUpsPausedUntil?: Date | null;
  now?: Date;
}): boolean {
  const now = opts.now ?? new Date();
  const until = opts.followUpsPausedUntil ?? null;
  if (!until) return false;
  return until.getTime() > now.getTime();
}

function getTimeZoneParts(
  date: Date,
  timeZone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  return {
    year: Number.parseInt(byType.year, 10),
    month: Number.parseInt(byType.month, 10),
    day: Number.parseInt(byType.day, 10),
    hour: Number.parseInt(byType.hour, 10),
    minute: Number.parseInt(byType.minute, 10),
    second: Number.parseInt(byType.second, 10),
  };
}

function addDaysToYmd(ymd: { year: number; month: number; day: number }, days: number): {
  year: number;
  month: number;
  day: number;
} {
  const baseUtcMidnight = Date.UTC(ymd.year, ymd.month - 1, ymd.day, 0, 0, 0, 0);
  const nextUtcMidnight = baseUtcMidnight + days * 24 * 60 * 60 * 1000;
  const d = new Date(nextUtcMidnight);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function getTimeZoneOffsetMs(timeZone: string, date: Date): number {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    date.getUTCMilliseconds()
  );
  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(opts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  timeZone: string;
}): Date {
  const naiveUtc = Date.UTC(
    opts.year,
    opts.month - 1,
    opts.day,
    opts.hour,
    opts.minute,
    opts.second,
    opts.millisecond
  );

  // Iteratively refine to handle DST boundary changes.
  let guess = naiveUtc;
  for (let i = 0; i < 4; i++) {
    const offset = getTimeZoneOffsetMs(opts.timeZone, new Date(guess));
    const next = naiveUtc - offset;
    if (next === guess) break;
    guess = next;
  }

  return new Date(guess);
}

/**
 * Compute a workspace follow-up pause cutoff.
 *
 * Semantics: "pause for N days" means paused through the end-of-day in the workspace timezone.
 * - days = 1 => end of today
 * - days = 2 => end of tomorrow
 */
export function computeWorkspaceFollowUpsPausedUntil(opts: {
  days: number;
  timeZone: string | null | undefined;
  now?: Date;
}): Date {
  if (!Number.isFinite(opts.days) || opts.days <= 0) {
    throw new Error("days must be a positive integer");
  }

  let timeZone = opts.timeZone || "America/Los_Angeles";
  const now = opts.now ?? new Date();
  let local: ReturnType<typeof getTimeZoneParts>;
  try {
    local = getTimeZoneParts(now, timeZone);
  } catch {
    timeZone = "America/Los_Angeles";
    local = getTimeZoneParts(now, timeZone);
  }

  const target = addDaysToYmd({ year: local.year, month: local.month, day: local.day }, opts.days - 1);

  return zonedDateTimeToUtc({
    ...target,
    hour: 23,
    minute: 59,
    second: 59,
    millisecond: 999,
    timeZone,
  });
}

