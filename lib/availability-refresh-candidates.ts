import "server-only";

import { getWorkspaceAvailabilitySlotsUtc } from "@/lib/availability-cache";
import { formatAvailabilitySlots } from "@/lib/availability-format";
import { getWorkspaceSlotOfferCountsForRange } from "@/lib/slot-offer-ledger";
import { ensureLeadTimezone } from "@/lib/timezone-inference";
import type { AvailabilitySource } from "@prisma/client";

export type RefreshCandidate = {
  datetimeUtcIso: string;
  label: string;
};

export type BuildRefreshCandidatesResult = {
  candidates: RefreshCandidate[];
  labelToDatetimeUtcIso: Record<string, string>;
  availabilitySource: AvailabilitySource;
  timeZone: string;
};

export type TimeZoneToken =
  | "EST"
  | "EDT"
  | "CST"
  | "CDT"
  | "MST"
  | "MDT"
  | "PST"
  | "PDT";

const TIMEZONE_TOKEN_REGEX = /\b(EST|EDT|CST|CDT|MST|MDT|PST|PDT)\b/g;
const TIMEZONE_TOKEN_MAP: Record<TimeZoneToken, string> = {
  EST: "America/New_York",
  EDT: "America/New_York",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  MST: "America/Denver",
  MDT: "America/Denver",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
};

function coerceTimeZone(input: string | null | undefined): string {
  const candidate = (input || "").trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
}

function normalizeIso(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function getLocalDateKey(date: Date, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);

    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    if (!year || !month || !day) return null;
    return `${year}-${month}-${day}`;
  } catch {
    return null;
  }
}

function isOnOrBeforeTodayLocal(iso: string, now: Date, timeZone: string): boolean {
  const slotDate = new Date(iso);
  if (Number.isNaN(slotDate.getTime())) return true;

  const slotKey = getLocalDateKey(slotDate, timeZone);
  const todayKey = getLocalDateKey(now, timeZone);
  if (!slotKey || !todayKey) return true;
  return slotKey <= todayKey;
}

export function detectPreferredTimezoneToken(content: string): TimeZoneToken | null {
  const counts = new Map<TimeZoneToken, { count: number; firstIndex: number }>();
  TIMEZONE_TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TIMEZONE_TOKEN_REGEX.exec(content)) !== null) {
    const token = match[1] as TimeZoneToken;
    const existing = counts.get(token);
    if (existing) {
      existing.count += 1;
      continue;
    }
    counts.set(token, { count: 1, firstIndex: match.index });
  }

  TIMEZONE_TOKEN_REGEX.lastIndex = 0;
  let winner: { token: TimeZoneToken; count: number; firstIndex: number } | null = null;
  for (const [token, meta] of counts.entries()) {
    if (!winner) {
      winner = { token, count: meta.count, firstIndex: meta.firstIndex };
      continue;
    }
    if (meta.count > winner.count) {
      winner = { token, count: meta.count, firstIndex: meta.firstIndex };
      continue;
    }
    if (meta.count === winner.count && meta.firstIndex < winner.firstIndex) {
      winner = { token, count: meta.count, firstIndex: meta.firstIndex };
    }
  }

  return winner?.token ?? null;
}

export function mapTimezoneTokenToIana(token: TimeZoneToken): string {
  return TIMEZONE_TOKEN_MAP[token] || "UTC";
}

export function applyPreferredTimezoneToken(label: string, token: TimeZoneToken | null): string {
  if (!token) return label;
  TIMEZONE_TOKEN_REGEX.lastIndex = 0;
  if (!TIMEZONE_TOKEN_REGEX.test(label)) return label;
  TIMEZONE_TOKEN_REGEX.lastIndex = 0;
  return label.replace(TIMEZONE_TOKEN_REGEX, token);
}

function parseOfferedSlotsJson(leadOfferedSlotsJson: string | null): Set<string> {
  const set = new Set<string>();
  if (!leadOfferedSlotsJson) return set;
  try {
    const parsed = JSON.parse(leadOfferedSlotsJson) as Array<{ datetime?: string }>;
    for (const slot of parsed) {
      if (!slot?.datetime) continue;
      const normalized = normalizeIso(slot.datetime);
      if (normalized) set.add(normalized);
    }
  } catch {
    // ignore parse errors
  }
  return set;
}

export async function buildRefreshCandidates(opts: {
  clientId: string;
  leadId: string;
  leadOfferedSlotsJson: string | null;
  snoozedUntil: Date | null;
  availabilitySource: AvailabilitySource;
  candidateCap?: number;
  preferredTimeZoneToken?: TimeZoneToken | null;
  timeZoneOverride?: string | null;
  deps?: {
    getWorkspaceAvailabilitySlotsUtc?: typeof getWorkspaceAvailabilitySlotsUtc;
    getWorkspaceSlotOfferCountsForRange?: typeof getWorkspaceSlotOfferCountsForRange;
    ensureLeadTimezone?: typeof ensureLeadTimezone;
  };
}): Promise<BuildRefreshCandidatesResult> {
  const candidateCap =
    Number.isFinite(opts.candidateCap) && (opts.candidateCap || 0) > 0 ? Math.floor(opts.candidateCap!) : 50;
  const now = new Date();
  const snoozedUntil = opts.snoozedUntil && opts.snoozedUntil > now ? opts.snoozedUntil : null;
  const anchor = snoozedUntil && snoozedUntil > now ? snoozedUntil : now;

  const ensureLeadTimezoneFn = opts.deps?.ensureLeadTimezone ?? ensureLeadTimezone;
  const tzResult = opts.timeZoneOverride
    ? { timezone: opts.timeZoneOverride }
    : await ensureLeadTimezoneFn(opts.leadId);
  const timeZone = coerceTimeZone(tzResult.timezone);
  const preferredToken = opts.preferredTimeZoneToken ?? null;
  const formatTimeZone = preferredToken ? mapTimezoneTokenToIana(preferredToken) : timeZone;

  const getWorkspaceAvailabilitySlotsUtcFn =
    opts.deps?.getWorkspaceAvailabilitySlotsUtc ?? getWorkspaceAvailabilitySlotsUtc;
  const availability = await getWorkspaceAvailabilitySlotsUtcFn(opts.clientId, {
    refreshIfStale: true,
    availabilitySource: opts.availabilitySource,
  });

  const offeredSet = parseOfferedSlotsJson(opts.leadOfferedSlotsJson);

  const normalizedAvailability = availability.slotsUtc.map(normalizeIso).filter((iso): iso is string => !!iso);

  const future = normalizedAvailability
    .filter((iso) => new Date(iso).getTime() >= anchor.getTime())
    .filter((iso) => !isOnOrBeforeTodayLocal(iso, now, timeZone));

  const notPreviouslyOffered = future.filter((iso) => !offeredSet.has(iso));

  // If we've already offered every available slot in-range, allow returning the offered slots
  // instead of failing with an empty candidate list.
  const pool = notPreviouslyOffered.length > 0 ? notPreviouslyOffered : future;

  const rangeEnd = new Date(anchor.getTime() + 30 * 24 * 60 * 60 * 1000);
  const getWorkspaceSlotOfferCountsForRangeFn =
    opts.deps?.getWorkspaceSlotOfferCountsForRange ?? getWorkspaceSlotOfferCountsForRange;
  const offerCounts = await getWorkspaceSlotOfferCountsForRangeFn(opts.clientId, anchor, rangeEnd, {
    availabilitySource: availability.availabilitySource,
  });

  const scored = pool
    .map((iso) => ({
      iso,
      offeredCount: offerCounts.get(iso) ?? 0,
      timeMs: new Date(iso).getTime(),
    }))
    .sort((a, b) => a.offeredCount - b.offeredCount || a.timeMs - b.timeMs)
    .map((entry) => entry.iso)
    .slice(0, Math.max(0, candidateCap));

  const formatted = formatAvailabilitySlots({
    slotsUtcIso: scored,
    timeZone: formatTimeZone,
    mode: "explicit_tz",
    limit: scored.length,
  });

  const candidates: RefreshCandidate[] = [];
  const labelToDatetimeUtcIso: Record<string, string> = {};

  for (const slot of formatted) {
    const label = applyPreferredTimezoneToken(slot.label, preferredToken);
    if (labelToDatetimeUtcIso[label]) continue;
    labelToDatetimeUtcIso[label] = slot.datetime;
    candidates.push({ datetimeUtcIso: slot.datetime, label });
    if (candidates.length >= candidateCap) break;
  }

  return {
    candidates,
    labelToDatetimeUtcIso,
    availabilitySource: availability.availabilitySource,
    timeZone,
  };
}
