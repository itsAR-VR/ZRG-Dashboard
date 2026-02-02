import "server-only";

const DEFAULT_TIMEZONE = "America/Los_Angeles";
const DEFAULT_START_TIME = "09:00";
const DEFAULT_END_TIME = "17:00";
const MAX_BLACKOUT_DATES = 200;
const MAX_EXCLUDED_PRESET_DATES = 200;
const MAX_BLACKOUT_RANGES = 50;
const MAX_RANGE_DAYS = 366;
const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type AutoSendScheduleMode = "ALWAYS" | "BUSINESS_HOURS" | "CUSTOM";

export type AutoSendHolidayPreset = "US_FEDERAL_PLUS_COMMON";

export interface AutoSendHolidayConfig {
  preset?: AutoSendHolidayPreset;
  excludedPresetDates?: string[]; // YYYY-MM-DD
  additionalBlackoutDates?: string[]; // YYYY-MM-DD
  additionalBlackoutDateRanges?: Array<{ start: string; end: string }>; // inclusive YYYY-MM-DD
}

export interface AutoSendCustomSchedule {
  version?: number;
  days: number[]; // 0=Sunday, 1=Monday, ..., 6=Saturday
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  timezone?: string; // Optional override
  holidays?: AutoSendHolidayConfig;
}

export interface AutoSendScheduleConfig {
  mode: AutoSendScheduleMode;
  timezone: string;
  workStartTime: string;
  workEndTime: string;
  customSchedule: AutoSendCustomSchedule | null;
}

export interface AutoSendScheduleCheckResult {
  withinSchedule: boolean;
  reason: string;
  nextWindowStart?: Date;
}

type ScheduleSource = {
  autoSendScheduleMode?: AutoSendScheduleMode | null;
  autoSendCustomSchedule?: unknown;
};

type WorkspaceScheduleSource = ScheduleSource & {
  timezone?: string | null;
  workStartTime?: string | null;
  workEndTime?: string | null;
};

type ScheduleWindow = {
  days: number[];
  startTime: string;
  endTime: string;
  timezone: string;
  holidays?: AutoSendHolidayConfig | null;
};

type NormalizedResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const HOLIDAY_PRESET_CACHE = new Map<string, Set<string>>();

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
  const tz = timeZone || fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return fallback;
  }
}

function getZonedDateTimeParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
} {
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

  const parts = dtf.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
    parts.find((p) => p.type === type)?.value;

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

function parseYmd(value: string): { year: number; month: number; day: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [yearRaw, monthRaw, dayRaw] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw) || !Number.isFinite(dayRaw)) return null;
  const date = new Date(Date.UTC(yearRaw, monthRaw - 1, dayRaw));
  if (
    date.getUTCFullYear() !== yearRaw ||
    date.getUTCMonth() + 1 !== monthRaw ||
    date.getUTCDate() !== dayRaw
  ) {
    return null;
  }
  return { year: yearRaw, month: monthRaw, day: dayRaw };
}

function ymdToNumber(value: string): number | null {
  const parsed = parseYmd(value);
  if (!parsed) return null;
  return parsed.year * 10_000 + parsed.month * 100 + parsed.day;
}

function addDaysToYmd(ymd: { year: number; month: number; day: number }, days: number): {
  year: number;
  month: number;
  day: number;
} {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function zonedTimeToUtc(local: { year: number; month: number; day: number; hour: number; minute: number }, timeZone: string): Date {
  let utc = new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0, 0));
  const desiredAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0, 0);

  for (let i = 0; i < 3; i++) {
    const actual = getZonedDateTimeParts(utc, timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0, 0);
    const diff = actualAsUtc - desiredAsUtc;
    if (diff === 0) break;
    utc = new Date(utc.getTime() - diff);
  }

  return utc;
}

function parseTime(timeStr: string | null | undefined, fallback: string): { hours: number; minutes: number } {
  const [hours, minutes] = (timeStr || fallback).split(":").map((p) => parseInt(p, 10));
  return {
    hours: Number.isFinite(hours) ? hours : parseInt(fallback.split(":")[0]!, 10),
    minutes: Number.isFinite(minutes) ? minutes : parseInt(fallback.split(":")[1]!, 10),
  };
}

function normalizeTimeValue(input: unknown): string | null {
  if (typeof input !== "string") return null;
  if (!/^\d{2}:\d{2}$/.test(input)) return null;
  const [h, m] = input.split(":").map((p) => Number.parseInt(p, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return input;
}

function normalizeDateList(
  value: unknown,
  opts: { strict: boolean; max: number; label: string }
): NormalizedResult<string[]> {
  if (!Array.isArray(value)) {
    return { ok: true, value: [] };
  }

  const unique = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      if (opts.strict) return { ok: false, error: `${opts.label} must be YYYY-MM-DD strings` };
      continue;
    }
    const parsed = parseYmd(entry);
    if (!parsed) {
      if (opts.strict) return { ok: false, error: `${opts.label} must be YYYY-MM-DD strings` };
      continue;
    }
    unique.add(entry);
  }

  const list = Array.from(unique).sort();
  if (list.length > opts.max) {
    if (opts.strict) return { ok: false, error: `${opts.label} exceeds max of ${opts.max}` };
    return { ok: true, value: list.slice(0, opts.max) };
  }

  return { ok: true, value: list };
}

function normalizeDateRanges(
  value: unknown,
  opts: { strict: boolean }
): NormalizedResult<Array<{ start: string; end: string }>> {
  if (!Array.isArray(value)) {
    return { ok: true, value: [] };
  }

  const ranges: Array<{ start: string; end: string }> = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      if (opts.strict) return { ok: false, error: "Blackout ranges must be objects with start/end" };
      continue;
    }
    const record = entry as Record<string, unknown>;
    const start = typeof record.start === "string" ? record.start : "";
    const end = typeof record.end === "string" ? record.end : "";
    const startParsed = parseYmd(start);
    const endParsed = parseYmd(end);
    const startNum = startParsed ? ymdToNumber(start) : null;
    const endNum = endParsed ? ymdToNumber(end) : null;
    if (!startNum || !endNum || !startParsed || !endParsed) {
      if (opts.strict) return { ok: false, error: "Blackout ranges must use YYYY-MM-DD" };
      continue;
    }
    if (endNum < startNum) {
      if (opts.strict) return { ok: false, error: "Blackout range end must be >= start" };
      continue;
    }
    const startDate = new Date(Date.UTC(startParsed.year, startParsed.month - 1, startParsed.day));
    const endDate = new Date(Date.UTC(endParsed.year, endParsed.month - 1, endParsed.day));
    const rangeDays = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
    if (rangeDays > MAX_RANGE_DAYS) {
      if (opts.strict) return { ok: false, error: `Blackout range exceeds ${MAX_RANGE_DAYS} days` };
      continue;
    }
    const key = `${start}:${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ranges.push({ start, end });
  }

  if (ranges.length > MAX_BLACKOUT_RANGES) {
    if (opts.strict) return { ok: false, error: `Blackout ranges exceed max of ${MAX_BLACKOUT_RANGES}` };
    return { ok: true, value: ranges.slice(0, MAX_BLACKOUT_RANGES) };
  }

  return { ok: true, value: ranges };
}

function normalizeHolidayConfig(
  input: unknown,
  opts: { strict: boolean }
): NormalizedResult<AutoSendHolidayConfig | null> {
  if (input == null) return { ok: true, value: null };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return opts.strict
      ? { ok: false, error: "Holiday config must be an object" }
      : { ok: true, value: null };
  }

  const record = input as Record<string, unknown>;
  const presetRaw = typeof record.preset === "string" ? record.preset : undefined;
  const preset =
    presetRaw === "US_FEDERAL_PLUS_COMMON"
      ? ("US_FEDERAL_PLUS_COMMON" as const)
      : undefined;
  if (presetRaw && !preset && opts.strict) {
    return { ok: false, error: "Unsupported holiday preset" };
  }

  const excludedResult = normalizeDateList(record.excludedPresetDates, {
    strict: opts.strict,
    max: MAX_EXCLUDED_PRESET_DATES,
    label: "Excluded preset dates",
  });
  if (!excludedResult.ok) return excludedResult;

  const additionalResult = normalizeDateList(record.additionalBlackoutDates, {
    strict: opts.strict,
    max: MAX_BLACKOUT_DATES,
    label: "Additional blackout dates",
  });
  if (!additionalResult.ok) return additionalResult;

  const rangesResult = normalizeDateRanges(record.additionalBlackoutDateRanges, opts);
  if (!rangesResult.ok) return rangesResult;

  if (
    !preset &&
    excludedResult.value.length === 0 &&
    additionalResult.value.length === 0 &&
    rangesResult.value.length === 0
  ) {
    return { ok: true, value: null };
  }

  return {
    ok: true,
    value: {
      ...(preset ? { preset } : {}),
      ...(excludedResult.value.length ? { excludedPresetDates: excludedResult.value } : {}),
      ...(additionalResult.value.length ? { additionalBlackoutDates: additionalResult.value } : {}),
      ...(rangesResult.value.length ? { additionalBlackoutDateRanges: rangesResult.value } : {}),
    },
  };
}

function normalizeCustomSchedule(
  input: unknown,
  opts: { strict: boolean }
): NormalizedResult<AutoSendCustomSchedule> {
  if (!input || typeof input !== "object") {
    return opts.strict
      ? { ok: false, error: "Custom schedule must be an object" }
      : { ok: false, error: "invalid" };
  }
  const record = input as Record<string, unknown>;
  if (Array.isArray(record)) {
    return opts.strict
      ? { ok: false, error: "Custom schedule must be an object" }
      : { ok: false, error: "invalid" };
  }

  if (record.version !== undefined && record.version !== 1) {
    return opts.strict
      ? { ok: false, error: "Unsupported schedule version" }
      : { ok: false, error: "invalid_version" };
  }

  const daysRaw = Array.isArray(record.days) ? record.days : [];
  const days = Array.from(
    new Set(
      daysRaw
        .map((d) => (typeof d === "number" ? Math.floor(d) : Number.NaN))
        .filter((d) => Number.isFinite(d) && d >= 0 && d <= 6)
    )
  ).sort();

  const startTime = normalizeTimeValue(record.startTime);
  const endTime = normalizeTimeValue(record.endTime);
  if (!startTime || !endTime || days.length === 0) {
    return opts.strict
      ? { ok: false, error: "Custom schedule must include days, startTime, endTime" }
      : { ok: false, error: "invalid" };
  }

  const timezone = typeof record.timezone === "string" ? record.timezone : undefined;
  if (timezone && !isValidTimeZone(timezone)) {
    return opts.strict
      ? { ok: false, error: "Invalid custom timezone" }
      : { ok: false, error: "invalid" };
  }

  const holidaysResult = normalizeHolidayConfig(record.holidays, opts);
  if (!holidaysResult.ok) return holidaysResult;

  return {
    ok: true,
    value: {
      version: 1,
      days,
      startTime,
      endTime,
      ...(timezone ? { timezone } : {}),
      ...(holidaysResult.value ? { holidays: holidaysResult.value } : {}),
    },
  };
}

export function validateAutoSendCustomSchedule(
  input: unknown
): NormalizedResult<AutoSendCustomSchedule> {
  if (input == null) {
    return { ok: false, error: "Custom schedule cannot be null" };
  }
  return normalizeCustomSchedule(input, { strict: true });
}

export function coerceAutoSendCustomSchedule(input: unknown): AutoSendCustomSchedule | null {
  const result = normalizeCustomSchedule(input, { strict: false });
  return result.ok ? result.value : null;
}

function resolveScheduleWindow(config: AutoSendScheduleConfig): ScheduleWindow | null {
  if (config.mode === "ALWAYS") return null;

  if (config.mode === "CUSTOM") {
    const custom = config.customSchedule;
    if (!custom) return null;
    return {
      days: custom.days,
      startTime: custom.startTime,
      endTime: custom.endTime,
      timezone: safeTimeZone(custom.timezone || config.timezone, DEFAULT_TIMEZONE),
      holidays: custom.holidays ?? null,
    };
  }

  return {
    days: [1, 2, 3, 4, 5],
    startTime: config.workStartTime || DEFAULT_START_TIME,
    endTime: config.workEndTime || DEFAULT_END_TIME,
    timezone: safeTimeZone(config.timezone, DEFAULT_TIMEZONE),
    holidays: null,
  };
}

export function resolveAutoSendScheduleConfig(
  workspace: WorkspaceScheduleSource | null | undefined,
  campaign?: ScheduleSource | null,
  leadTimezone?: string | null
): AutoSendScheduleConfig {
  const workspaceMode = workspace?.autoSendScheduleMode ?? "ALWAYS";
  const campaignMode = campaign?.autoSendScheduleMode ?? null;
  const mode = (campaignMode || workspaceMode || "ALWAYS") as AutoSendScheduleMode;

  const workspaceCustom = coerceAutoSendCustomSchedule(workspace?.autoSendCustomSchedule ?? null);
  const campaignCustom = coerceAutoSendCustomSchedule(campaign?.autoSendCustomSchedule ?? null);

  const baseCustom = campaignCustom || workspaceCustom || null;
  const mergedHolidays = mergeHolidayConfigs(workspaceCustom?.holidays ?? null, campaignCustom?.holidays ?? null);
  const customSchedule =
    baseCustom
      ? {
          ...baseCustom,
          ...(mergedHolidays ? { holidays: mergedHolidays } : {}),
        }
      : null;

  const effectiveTimezone = resolveEffectiveTimezone(leadTimezone, workspace?.timezone);
  return {
    mode,
    timezone: effectiveTimezone,
    workStartTime: workspace?.workStartTime || DEFAULT_START_TIME,
    workEndTime: workspace?.workEndTime || DEFAULT_END_TIME,
    customSchedule,
  };
}

function resolveEffectiveTimezone(
  leadTimezone: string | null | undefined,
  workspaceTimezone: string | null | undefined
): string {
  if (isValidTimeZone(leadTimezone)) return leadTimezone!;
  if (isValidTimeZone(workspaceTimezone)) return workspaceTimezone!;
  return DEFAULT_TIMEZONE;
}

function mergeHolidayConfigs(
  workspace: AutoSendHolidayConfig | null,
  campaign: AutoSendHolidayConfig | null
): AutoSendHolidayConfig | null {
  if (!workspace && !campaign) return null;
  const preset = workspace?.preset ? "US_FEDERAL_PLUS_COMMON" : undefined;
  const excludedPresetDates = Array.from(new Set(workspace?.excludedPresetDates ?? [])).sort();
  const additionalBlackoutDates = Array.from(
    new Set([...(workspace?.additionalBlackoutDates ?? []), ...(campaign?.additionalBlackoutDates ?? [])])
  ).sort();
  const additionalBlackoutDateRanges = Array.from(
    new Set(
      [...(workspace?.additionalBlackoutDateRanges ?? []), ...(campaign?.additionalBlackoutDateRanges ?? [])].map(
        (range) => `${range.start}:${range.end}`
      )
    )
  ).map((entry) => {
    const [start, end] = entry.split(":");
    return { start, end };
  });

  if (
    !preset &&
    excludedPresetDates.length === 0 &&
    additionalBlackoutDates.length === 0 &&
    additionalBlackoutDateRanges.length === 0
  ) {
    return null;
  }

  return {
    ...(preset ? { preset } : {}),
    ...(excludedPresetDates.length ? { excludedPresetDates } : {}),
    ...(additionalBlackoutDates.length ? { additionalBlackoutDates } : {}),
    ...(additionalBlackoutDateRanges.length ? { additionalBlackoutDateRanges } : {}),
  };
}

function getNthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): { year: number; month: number; day: number } {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = first.getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  return { year, month, day };
}

function getLastWeekdayOfMonth(year: number, month: number, weekday: number): { year: number; month: number; day: number } {
  const last = new Date(Date.UTC(year, month, 0));
  const lastWeekday = last.getUTCDay();
  const offset = (lastWeekday - weekday + 7) % 7;
  const day = last.getUTCDate() - offset;
  return { year, month, day };
}

function getPresetHolidayDates(year: number, preset: AutoSendHolidayPreset): Set<string> {
  const key = `${preset}:${year}`;
  const cached = HOLIDAY_PRESET_CACHE.get(key);
  if (cached) return cached;

  const dates = new Set<string>();
  if (preset === "US_FEDERAL_PLUS_COMMON") {
    dates.add(formatYmd({ year, month: 1, day: 1 })); // New Year's Day
    dates.add(formatYmd(getNthWeekdayOfMonth(year, 1, 1, 3))); // MLK (3rd Mon Jan)
    dates.add(formatYmd(getNthWeekdayOfMonth(year, 2, 1, 3))); // Presidents (3rd Mon Feb)
    dates.add(formatYmd(getLastWeekdayOfMonth(year, 5, 1))); // Memorial (last Mon May)
    dates.add(formatYmd({ year, month: 6, day: 19 })); // Juneteenth
    dates.add(formatYmd({ year, month: 7, day: 4 })); // Independence
    dates.add(formatYmd(getNthWeekdayOfMonth(year, 9, 1, 1))); // Labor (1st Mon Sep)
    dates.add(formatYmd(getNthWeekdayOfMonth(year, 10, 1, 2))); // Columbus/Indigenous (2nd Mon Oct)
    dates.add(formatYmd({ year, month: 11, day: 11 })); // Veterans
    const thanksgiving = getNthWeekdayOfMonth(year, 11, 4, 4); // 4th Thu Nov
    dates.add(formatYmd(thanksgiving));
    const dayAfterThanksgiving = addDaysToYmd(thanksgiving, 1);
    dates.add(formatYmd(dayAfterThanksgiving));
    dates.add(formatYmd({ year, month: 12, day: 24 })); // Christmas Eve
    dates.add(formatYmd({ year, month: 12, day: 25 })); // Christmas
  }

  HOLIDAY_PRESET_CACHE.set(key, dates);
  return dates;
}

function isBlackoutDate(ymd: { year: number; month: number; day: number }, holidays?: AutoSendHolidayConfig | null): boolean {
  if (!holidays) return false;
  const dateKey = formatYmd(ymd);
  const dateNum = ymdToNumber(dateKey);

  if (holidays.additionalBlackoutDates?.includes(dateKey)) return true;

  if (dateNum && holidays.additionalBlackoutDateRanges) {
    for (const range of holidays.additionalBlackoutDateRanges) {
      const startNum = ymdToNumber(range.start);
      const endNum = ymdToNumber(range.end);
      if (startNum && endNum && dateNum >= startNum && dateNum <= endNum) {
        return true;
      }
    }
  }

  if (holidays.preset) {
    const presetDates = getPresetHolidayDates(ymd.year, holidays.preset);
    const excluded = new Set(holidays.excludedPresetDates ?? []);
    if (presetDates.has(dateKey) && !excluded.has(dateKey)) {
      return true;
    }
  }

  return false;
}

export function isWithinAutoSendSchedule(
  config: AutoSendScheduleConfig,
  now: Date = new Date()
): AutoSendScheduleCheckResult {
  if (config.mode === "ALWAYS") {
    return { withinSchedule: true, reason: "always" };
  }

  const window = resolveScheduleWindow(config);
  if (!window) {
    return { withinSchedule: true, reason: "schedule_missing_fallback" };
  }

  const nowParts = getZonedDateTimeParts(now, window.timezone);
  const todayYmd = { year: nowParts.year, month: nowParts.month, day: nowParts.day };
  const { hours: startH, minutes: startM } = parseTime(window.startTime, DEFAULT_START_TIME);
  const { hours: endH, minutes: endM } = parseTime(window.endTime, DEFAULT_END_TIME);

  const currentTotalMinutes = nowParts.hour * 60 + nowParts.minute;
  const startTotalMinutes = startH * 60 + startM;
  const endTotalMinutes = endH * 60 + endM;

  const isActiveDay = window.days.includes(nowParts.weekday);
  const isOvernight = startTotalMinutes > endTotalMinutes;

  let withinSchedule = false;
  let anchorYmd: { year: number; month: number; day: number } | null = null;

  if (!isOvernight) {
    withinSchedule =
      isActiveDay && currentTotalMinutes >= startTotalMinutes && currentTotalMinutes <= endTotalMinutes;
    anchorYmd = withinSchedule ? todayYmd : null;
  } else {
    const prevWeekday = (nowParts.weekday + 6) % 7;
    const prevDayActive = window.days.includes(prevWeekday);
    if (isActiveDay && currentTotalMinutes >= startTotalMinutes) {
      withinSchedule = true;
      anchorYmd = todayYmd;
    } else if (prevDayActive && currentTotalMinutes <= endTotalMinutes) {
      withinSchedule = true;
      anchorYmd = addDaysToYmd(todayYmd, -1);
    }
  }

  const blockedByBlackout = Boolean(
    withinSchedule && anchorYmd && isBlackoutDate(anchorYmd, window.holidays ?? null)
  );
  if (blockedByBlackout) {
    withinSchedule = false;
    anchorYmd = null;
  }

  if (withinSchedule) {
    return { withinSchedule: true, reason: "within_window" };
  }

  return {
    withinSchedule: false,
    reason: blockedByBlackout
      ? "blackout_date"
      : isActiveDay
        ? "outside_window"
        : "day_not_active",
    nextWindowStart: getNextAutoSendWindow(config, now),
  };
}

export function getNextAutoSendWindow(
  config: AutoSendScheduleConfig,
  now: Date = new Date()
): Date {
  if (config.mode === "ALWAYS") {
    return now;
  }

  const window = resolveScheduleWindow(config);
  if (!window) {
    return now;
  }

  const nowParts = getZonedDateTimeParts(now, window.timezone);
  const { hours: startH, minutes: startM } = parseTime(window.startTime, DEFAULT_START_TIME);
  const startAnchor = { year: nowParts.year, month: nowParts.month, day: nowParts.day };

  for (let offset = 0; offset < 90; offset += 1) {
    const targetYmd = addDaysToYmd(startAnchor, offset);
    const targetWeekday = (nowParts.weekday + offset) % 7;

    if (!window.days.includes(targetWeekday)) continue;
    if (isBlackoutDate(targetYmd, window.holidays ?? null)) continue;

    const candidate = zonedTimeToUtc(
      {
        ...targetYmd,
        hour: startH,
        minute: startM,
      },
      window.timezone
    );

    if (candidate.getTime() >= now.getTime() || offset > 0) {
      return candidate;
    }
  }

  return now;
}
