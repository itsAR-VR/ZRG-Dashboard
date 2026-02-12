import { isValidIanaTimezone } from "@/lib/timezone-inference";

export type SlotDistributionHalf = "morning" | "afternoon";

function normalizeIso(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function getLocalParts(date: Date, timeZone: string): { dayKey: string; hour: number; minute: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      hour12: false,
    }).formatToParts(date);

    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    const hourStr = parts.find((p) => p.type === "hour")?.value;
    const minuteStr = parts.find((p) => p.type === "minute")?.value;

    if (!year || !month || !day || !hourStr || !minuteStr) return null;
    const hour = Number.parseInt(hourStr, 10);
    const minute = Number.parseInt(minuteStr, 10);
    if (!Number.isFinite(hour)) return null;
    if (!Number.isFinite(minute)) return null;

    return { dayKey: `${year}-${month}-${day}`, hour, minute };
  } catch {
    return null;
  }
}

function halfFromHour(hour: number): SlotDistributionHalf {
  return hour < 12 ? "morning" : "afternoon";
}

export function selectDistributedAvailabilitySlots(opts: {
  slotsUtcIso: string[];
  offeredCountBySlotUtcIso: Map<string, number>;
  timeZone: string;
  leadTimeZone?: string | null;
  excludeUtcIso?: Set<string>;
  startAfterUtc?: Date | null;
  preferWithinDays?: number;
  now?: Date;
}): string[] {
  const now = opts.now ?? new Date();
  const preferWithinDays = opts.preferWithinDays ?? 5;
  const anchor =
    opts.startAfterUtc && opts.startAfterUtc.getTime() > now.getTime() ? opts.startAfterUtc : now;

  const exclude = opts.excludeUtcIso ?? new Set<string>();
  const anchorMs = anchor.getTime();

  const normalized = opts.slotsUtcIso
    .map(normalizeIso)
    .filter((iso): iso is string => !!iso)
    .filter((iso) => !exclude.has(iso))
    .filter((iso) => new Date(iso).getTime() >= anchorMs);

  if (normalized.length === 0) return [];

  const windowEndMs = anchorMs + preferWithinDays * 24 * 60 * 60 * 1000;
  const withinWindow = normalized.filter((iso) => new Date(iso).getTime() <= windowEndMs);
  const pool = withinWindow.length > 0 ? withinWindow : normalized;
  const leadTimeZone = isValidIanaTimezone(opts.leadTimeZone) ? opts.leadTimeZone! : null;
  const distributionTimeZone = leadTimeZone || opts.timeZone;

  let businessPool = pool;
  if (leadTimeZone) {
    const leadBusinessHoursFiltered = pool.filter((iso) => {
      const d = new Date(iso);
      const local = getLocalParts(d, leadTimeZone);
      if (!local) return false;
      const minutesSinceMidnight = local.hour * 60 + local.minute;
      return minutesSinceMidnight >= 7 * 60 && minutesSinceMidnight < 21 * 60;
    });

    if (leadBusinessHoursFiltered.length > 0) {
      businessPool = leadBusinessHoursFiltered;
    } else {
      console.debug("[AvailabilityDistribution] Lead business-hours filter returned no slots; failing open", {
        leadTimeZone,
        candidateCount: pool.length,
      });
    }
  }

  type Scored = {
    iso: string;
    offeredCount: number;
    timeMs: number;
    dayKey: string;
    half: SlotDistributionHalf;
  };

  const scored: Scored[] = [];
  for (const iso of businessPool) {
    const d = new Date(iso);
    const parts = getLocalParts(d, distributionTimeZone);
    if (!parts) continue;
    scored.push({
      iso,
      offeredCount: opts.offeredCountBySlotUtcIso.get(iso) ?? 0,
      timeMs: d.getTime(),
      dayKey: parts.dayKey,
      half: halfFromHour(parts.hour),
    });
  }

  if (scored.length === 0) return [];

  const byOfferThenTime = (a: Scored, b: Scored) =>
    a.offeredCount - b.offeredCount || a.timeMs - b.timeMs;

  const pick = (candidates: Scored[]): Scored | null => {
    if (candidates.length === 0) return null;
    return [...candidates].sort(byOfferThenTime)[0] ?? null;
  };

  const first = pick(scored.filter((s) => s.half === "morning")) ?? pick(scored);
  if (!first) return [];

  const opposite: SlotDistributionHalf = first.half === "morning" ? "afternoon" : "morning";
  const second =
    pick(scored.filter((s) => s.dayKey !== first.dayKey && s.half === opposite)) ??
    pick(scored.filter((s) => s.dayKey !== first.dayKey)) ??
    pick(scored.filter((s) => s.iso !== first.iso));

  return second ? [first.iso, second.iso] : [first.iso];
}
