import "server-only";

export type CalendarHealthCountResult = {
  total: number;
  byDate: Record<string, number>;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  weekday: number; // 0=Sun..6=Sat
  hour: number;
  minute: number;
};

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function isValidTimeZone(timeZone: string | null | undefined): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function safeTimeZone(timeZone: string | null | undefined, fallback: string): string {
  const tz = (timeZone || "").trim();
  if (isValidTimeZone(tz)) return tz;
  return fallback;
}

function getZonedDateTimeParts(date: Date, timeZone: string, dtf?: Intl.DateTimeFormat): ZonedParts {
  const formatter =
    dtf ??
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string | undefined => parts.find((p) => p.type === type)?.value;

  const weekdayLabel = get("weekday") || "Sun";
  const weekday = WEEKDAY_TO_INDEX[weekdayLabel] ?? 0;

  const year = Number.parseInt(get("year") || "0", 10);
  const month = Number.parseInt(get("month") || "1", 10);
  const day = Number.parseInt(get("day") || "1", 10);

  let hour = Number.parseInt(get("hour") || "0", 10);
  if (hour === 24) hour = 0;

  const minute = Number.parseInt(get("minute") || "0", 10);

  return {
    year: Number.isFinite(year) ? year : 0,
    month: Number.isFinite(month) ? month : 1,
    day: Number.isFinite(day) ? day : 1,
    weekday,
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
  };
}

function formatYmd(ymd: { year: number; month: number; day: number }): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${ymd.year}-${pad(ymd.month)}-${pad(ymd.day)}`;
}

function addDaysToYmd(ymd: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function parseTime(
  timeStr: string | null | undefined,
  fallback: string
): { hours: number; minutes: number; minutesOfDay: number } {
  const normalized = typeof timeStr === "string" && /^\d{2}:\d{2}$/.test(timeStr) ? timeStr : fallback;
  const [hoursRaw, minutesRaw] = normalized.split(":");
  const hours = Number.parseInt(hoursRaw || "0", 10);
  const minutes = Number.parseInt(minutesRaw || "0", 10);

  const safeHours = Number.isFinite(hours) && hours >= 0 && hours <= 23 ? hours : Number.parseInt(fallback.split(":")[0]!, 10);
  const safeMinutes =
    Number.isFinite(minutes) && minutes >= 0 && minutes <= 59 ? minutes : Number.parseInt(fallback.split(":")[1]!, 10);

  return { hours: safeHours, minutes: safeMinutes, minutesOfDay: safeHours * 60 + safeMinutes };
}

export function countSlotsInWorkspaceWindow(opts: {
  slotsUtcIso: string[];
  timeZone: string;
  windowDays: number;
  workStartTime: string;
  workEndTime: string;
  weekdaysOnly: boolean;
  now?: Date;
}): CalendarHealthCountResult {
  const now = opts.now ?? new Date();
  const timeZone = safeTimeZone(opts.timeZone, "America/New_York");
  const windowDays = Math.max(0, Math.min(365, Math.floor(opts.windowDays)));
  const weekdaysOnly = Boolean(opts.weekdaysOnly);

  let start = parseTime(opts.workStartTime, "09:00");
  let end = parseTime(opts.workEndTime, "17:00");

  if (end.minutesOfDay <= start.minutesOfDay) {
    start = parseTime("09:00", "09:00");
    end = parseTime("17:00", "17:00");
  }

  const startMinutes = start.minutesOfDay;
  const endMinutes = end.minutesOfDay;

  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const nowLocal = getZonedDateTimeParts(now, timeZone, dtf);
  const startYmd = { year: nowLocal.year, month: nowLocal.month, day: nowLocal.day };

  const allowedDateKeys = new Set<string>();
  for (let i = 0; i < windowDays; i += 1) {
    allowedDateKeys.add(formatYmd(addDaysToYmd(startYmd, i)));
  }

  const byDate: Record<string, number> = {};
  let total = 0;

  const uniqueIso = new Set(opts.slotsUtcIso);

  for (const iso of uniqueIso) {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) continue;

    const local = getZonedDateTimeParts(date, timeZone, dtf);
    const dateKey = formatYmd(local);

    if (!allowedDateKeys.has(dateKey)) continue;
    if (weekdaysOnly && (local.weekday === 0 || local.weekday === 6)) continue;

    const minutesOfDay = local.hour * 60 + local.minute;
    if (minutesOfDay < startMinutes) continue;
    if (minutesOfDay >= endMinutes) continue;

    byDate[dateKey] = (byDate[dateKey] ?? 0) + 1;
    total += 1;
  }

  return { total, byDate };
}
