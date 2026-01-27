import "@/lib/server-dns";
import { prisma } from "@/lib/prisma";
import {
  detectCalendarType,
  fetchCalendlyAvailabilityWithMeta,
  fetchGHLAvailabilityWithMeta,
  fetchHubSpotAvailability,
  type AvailabilitySlot,
  type CalendarType,
} from "@/lib/calendar-availability";

const DEFAULT_LOOKAHEAD_DAYS = 30;
const REQUIRED_DURATION_MINUTES = 30;
const UNCONFIGURED_BACKOFF_MS = 24 * 60 * 60 * 1000; // 24 hours
const UNSUPPORTED_DURATION_BACKOFF_MS = 2 * 60 * 60 * 1000; // 2 hours

function parsePositiveInt(value: string | undefined): number | null {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function getCacheTtlMs(): number {
  const fromEnv = parsePositiveInt(process.env.AVAILABILITY_CACHE_TTL_MS);
  // Default: 60s (Phase 61 requirement: minute-level freshness).
  return Math.max(5_000, Math.min(60 * 60_000, fromEnv ?? 60_000));
}

function getCronTimeBudgetMs(fromOpts?: number): number {
  const fromEnv = parsePositiveInt(process.env.AVAILABILITY_CRON_TIME_BUDGET_MS);
  const candidate = fromOpts ?? fromEnv ?? 55_000;
  return Math.max(10_000, Math.min(10 * 60_000, candidate));
}

function shouldRespectBackoff(cache: { lastError: string | null; staleAt: Date }): boolean {
  const error = (cache.lastError || "").trim();
  if (!error) return false;
  if (error === "No default calendar link configured") return true;
  if (error.startsWith("Unsupported meeting duration")) return true;
  return false;
}

function normalizeCalendarUrl(input: string): string {
  const trimmed = (input || "").trim();
  if (!trimmed) return "";

  // If the user pasted without protocol, assume https
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return trimmed;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function dedupeSortedIso(slotsUtc: string[]): string[] {
  const deduped = Array.from(new Set(slotsUtc));
  deduped.sort();
  return deduped;
}

export type AvailabilityCacheMeta = {
  ghlCalendarId?: string | null;
  resolvedUrl?: string;
  calendlyEventTypeUuid?: string | null;
  calendlyAvailabilityTimezone?: string | null;
};

export async function refreshWorkspaceAvailabilityCache(clientId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const now = new Date();
  const cacheTtlMs = getCacheTtlMs();

  try {
    const [calendarLink, settings, existingCache] = await Promise.all([
      prisma.calendarLink.findFirst({
        where: { clientId, isDefault: true },
        select: { id: true, url: true, type: true },
      }),
      prisma.workspaceSettings.findUnique({
        where: { clientId },
        select: {
          meetingDurationMinutes: true,
          meetingBookingProvider: true,
          ghlDefaultCalendarId: true,
          calendlyEventTypeLink: true,
        },
      }),
      prisma.workspaceAvailabilityCache
        .findUnique({
          where: { clientId },
          select: { calendarLinkId: true, calendarUrl: true, providerMeta: true },
        })
        .catch(() => null),
    ]);

    if (!calendarLink) {
      // No default link configured; store an explicit empty cache entry so callers
      // can render gracefully instead of throwing during SSR.
      const error = "No default calendar link configured";

      await prisma.workspaceAvailabilityCache
        .upsert({
          where: { clientId },
          update: {
            calendarLinkId: null,
            calendarType: "unknown",
            calendarUrl: "",
            slotDurationMinutes: REQUIRED_DURATION_MINUTES,
            rangeStart: now,
            rangeEnd: addDays(now, DEFAULT_LOOKAHEAD_DAYS),
            slotsUtc: [],
            providerMeta: {},
            fetchedAt: now,
            staleAt: new Date(now.getTime() + UNCONFIGURED_BACKOFF_MS),
            lastError: error,
          },
          create: {
            clientId,
            calendarLinkId: null,
            calendarType: "unknown",
            calendarUrl: "",
            slotDurationMinutes: REQUIRED_DURATION_MINUTES,
            rangeStart: now,
            rangeEnd: addDays(now, DEFAULT_LOOKAHEAD_DAYS),
            slotsUtc: [],
            providerMeta: {},
            fetchedAt: now,
            staleAt: new Date(now.getTime() + UNCONFIGURED_BACKOFF_MS),
            lastError: error,
          },
        })
        .catch(() => undefined);

      return { success: false, error };
    }

    const meetingDuration = settings?.meetingDurationMinutes ?? REQUIRED_DURATION_MINUTES;
    if (meetingDuration !== REQUIRED_DURATION_MINUTES) {
      const error = `Unsupported meeting duration (${meetingDuration}m). Set Meeting Duration to ${REQUIRED_DURATION_MINUTES} minutes to use live availability.`;

      await prisma.workspaceAvailabilityCache.upsert({
        where: { clientId },
        update: {
          calendarLinkId: calendarLink.id,
          calendarType: calendarLink.type,
          calendarUrl: calendarLink.url,
          slotDurationMinutes: meetingDuration,
          rangeStart: now,
        rangeEnd: addDays(now, DEFAULT_LOOKAHEAD_DAYS),
        slotsUtc: [],
        providerMeta: {},
        fetchedAt: now,
        staleAt: new Date(now.getTime() + UNSUPPORTED_DURATION_BACKOFF_MS),
          lastError: error,
        },
        create: {
          clientId,
          calendarLinkId: calendarLink.id,
          calendarType: calendarLink.type,
          calendarUrl: calendarLink.url,
          slotDurationMinutes: meetingDuration,
          rangeStart: now,
        rangeEnd: addDays(now, DEFAULT_LOOKAHEAD_DAYS),
        slotsUtc: [],
        providerMeta: {},
        fetchedAt: now,
        staleAt: new Date(now.getTime() + UNSUPPORTED_DURATION_BACKOFF_MS),
          lastError: error,
        },
      });

      return { success: false, error };
    }

    const normalizedUrl = normalizeCalendarUrl(calendarLink.url);
    const detectedType = detectCalendarType(normalizedUrl);
    const calendarType = (calendarLink.type === "unknown" ? detectedType : (calendarLink.type as CalendarType)) || detectedType;

    let rawSlots: AvailabilitySlot[] = [];
    const providerMeta: AvailabilityCacheMeta = {};
    let lastError: string | null = null;

    const cachedMeta =
      existingCache &&
      existingCache.calendarLinkId === calendarLink.id &&
      existingCache.calendarUrl === calendarLink.url &&
      existingCache.providerMeta &&
      typeof existingCache.providerMeta === "object"
        ? (existingCache.providerMeta as AvailabilityCacheMeta)
        : null;

    if (calendarType === "calendly") {
      const calendly = await fetchCalendlyAvailabilityWithMeta(normalizedUrl, DEFAULT_LOOKAHEAD_DAYS, {
        eventTypeUuid: cachedMeta?.calendlyEventTypeUuid ?? null,
        availabilityTimezone: cachedMeta?.calendlyAvailabilityTimezone ?? null,
      });
      rawSlots = calendly.slots;
      providerMeta.calendlyEventTypeUuid = calendly.eventTypeUuid;
      providerMeta.calendlyAvailabilityTimezone = calendly.availabilityTimezone;

      const fallbackLink = (settings?.calendlyEventTypeLink || "").trim();
      if (rawSlots.length === 0 && fallbackLink && fallbackLink !== calendarLink.url) {
        const fallback = await fetchCalendlyAvailabilityWithMeta(fallbackLink, DEFAULT_LOOKAHEAD_DAYS, {
          eventTypeUuid: cachedMeta?.calendlyEventTypeUuid ?? null,
          availabilityTimezone: cachedMeta?.calendlyAvailabilityTimezone ?? null,
        });

        if (fallback.slots.length > 0) {
          rawSlots = fallback.slots;
          providerMeta.calendlyEventTypeUuid = fallback.eventTypeUuid;
          providerMeta.calendlyAvailabilityTimezone = fallback.availabilityTimezone;
          providerMeta.resolvedUrl = fallbackLink;
          lastError = "Default calendar link failed; used Calendly auto-book link fallback.";
        }
      }
    } else if (calendarType === "hubspot") {
      rawSlots = await fetchHubSpotAvailability(normalizedUrl, DEFAULT_LOOKAHEAD_DAYS);
    } else if (calendarType === "ghl") {
      const calendarIdHint = cachedMeta?.ghlCalendarId || settings?.ghlDefaultCalendarId || null;
      const ghl = await fetchGHLAvailabilityWithMeta(normalizedUrl, DEFAULT_LOOKAHEAD_DAYS, { calendarIdHint });
      rawSlots = ghl.slots;
      providerMeta.ghlCalendarId = ghl.calendarId;
      providerMeta.resolvedUrl = ghl.resolvedUrl;
      if (!rawSlots.length && ghl.error) lastError = ghl.error;

      if (!rawSlots.length && settings?.ghlDefaultCalendarId && settings.ghlDefaultCalendarId !== ghl.calendarId) {
        const fallback = await fetchGHLAvailabilityWithMeta(normalizedUrl, DEFAULT_LOOKAHEAD_DAYS, {
          calendarIdHint: settings.ghlDefaultCalendarId,
        });

        if (fallback.slots.length > 0) {
          rawSlots = fallback.slots;
          providerMeta.ghlCalendarId = fallback.calendarId;
          providerMeta.resolvedUrl = fallback.resolvedUrl;
          lastError = "Default calendar link failed; used GHL auto-book calendar fallback.";
        } else if (fallback.error && !lastError) {
          lastError = fallback.error;
        }
      }
    } else {
      const error = `Unsupported calendar link. Supported: Calendly, HubSpot, or GoHighLevel. URL: ${normalizedUrl || "(empty)"}`;
      await prisma.workspaceAvailabilityCache.upsert({
        where: { clientId },
        update: {
          calendarLinkId: calendarLink.id,
          calendarType: calendarType,
          calendarUrl: calendarLink.url,
          slotDurationMinutes: REQUIRED_DURATION_MINUTES,
          rangeStart: now,
          rangeEnd: addDays(now, DEFAULT_LOOKAHEAD_DAYS),
          slotsUtc: [],
          providerMeta: providerMeta as any,
          fetchedAt: now,
          staleAt: new Date(now.getTime() + cacheTtlMs),
          lastError: error,
        },
        create: {
          clientId,
          calendarLinkId: calendarLink.id,
          calendarType: calendarType,
          calendarUrl: calendarLink.url,
          slotDurationMinutes: REQUIRED_DURATION_MINUTES,
          rangeStart: now,
          rangeEnd: addDays(now, DEFAULT_LOOKAHEAD_DAYS),
          slotsUtc: [],
          providerMeta: providerMeta as any,
          fetchedAt: now,
          staleAt: new Date(now.getTime() + cacheTtlMs),
          lastError: error,
        },
      });
      return { success: false, error };
    }

    rawSlots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    const slotsUtc = dedupeSortedIso(rawSlots.map((s) => s.startTime.toISOString()));

    await prisma.workspaceAvailabilityCache.upsert({
      where: { clientId },
      update: {
        calendarLinkId: calendarLink.id,
        calendarType: calendarType,
        calendarUrl: calendarLink.url,
        slotDurationMinutes: REQUIRED_DURATION_MINUTES,
        rangeStart: now,
        rangeEnd: addDays(now, DEFAULT_LOOKAHEAD_DAYS),
        slotsUtc: slotsUtc as any,
        providerMeta: providerMeta as any,
        fetchedAt: now,
        staleAt: new Date(now.getTime() + cacheTtlMs),
        lastError: rawSlots.length === 0 ? lastError || "No availability slots found" : lastError,
      },
      create: {
        clientId,
        calendarLinkId: calendarLink.id,
        calendarType: calendarType,
        calendarUrl: calendarLink.url,
        slotDurationMinutes: REQUIRED_DURATION_MINUTES,
        rangeStart: now,
        rangeEnd: addDays(now, DEFAULT_LOOKAHEAD_DAYS),
        slotsUtc: slotsUtc as any,
        providerMeta: providerMeta as any,
        fetchedAt: now,
        staleAt: new Date(now.getTime() + cacheTtlMs),
        lastError: rawSlots.length === 0 ? lastError || "No availability slots found" : lastError,
      },
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await prisma.workspaceAvailabilityCache
      .upsert({
        where: { clientId },
        update: {
          fetchedAt: now,
          staleAt: new Date(now.getTime() + cacheTtlMs),
          lastError: message,
        },
        create: {
          clientId,
          calendarType: "unknown",
          calendarUrl: "",
          slotDurationMinutes: REQUIRED_DURATION_MINUTES,
          rangeStart: now,
          rangeEnd: addDays(now, DEFAULT_LOOKAHEAD_DAYS),
          slotsUtc: [],
          fetchedAt: now,
          staleAt: new Date(now.getTime() + cacheTtlMs),
          lastError: message,
        },
      })
      .catch(() => undefined);

    return { success: false, error: message };
  }
}

export async function getWorkspaceAvailabilityCache(clientId: string, opts?: { refreshIfStale?: boolean }): Promise<{
  slotsUtc: string[];
  calendarType: CalendarType | "unknown";
  calendarUrl: string;
  providerMeta: AvailabilityCacheMeta;
  fetchedAt: Date;
  staleAt: Date;
  lastError: string | null;
}> {
  const now = new Date();
  const refreshIfStale = opts?.refreshIfStale ?? true;

  let cache = await prisma.workspaceAvailabilityCache.findUnique({
    where: { clientId },
    select: {
      calendarLinkId: true,
      calendarType: true,
      calendarUrl: true,
      slotDurationMinutes: true,
      slotsUtc: true,
      providerMeta: true,
      fetchedAt: true,
      staleAt: true,
      lastError: true,
    },
  });

  const [defaultLink, settings] = refreshIfStale
    ? await Promise.all([
        prisma.calendarLink.findFirst({
          where: { clientId, isDefault: true },
          select: { id: true, url: true },
        }),
        prisma.workspaceSettings.findUnique({
          where: { clientId },
          select: { meetingDurationMinutes: true },
        }),
      ])
    : [null, null];

  const defaultUrl = defaultLink?.url ? normalizeCalendarUrl(defaultLink.url) : "";
  const cachedUrl = cache?.calendarUrl ? normalizeCalendarUrl(cache.calendarUrl) : "";
  const defaultChanged =
    !!defaultLink && !!cache && (cache.calendarLinkId !== defaultLink.id || cachedUrl !== defaultUrl);

  const currentDuration = settings?.meetingDurationMinutes ?? REQUIRED_DURATION_MINUTES;
  const durationChanged = !!cache && cache.slotDurationMinutes !== currentDuration;

  const existingMeta = (cache?.providerMeta || {}) as AvailabilityCacheMeta;
  const metaMissing =
    refreshIfStale &&
    !!cache &&
    cache.calendarType === "calendly" &&
    !!cache.calendarUrl &&
    !existingMeta.calendlyEventTypeUuid;

  if (!cache) {
    if (refreshIfStale) {
      const refresh = await refreshWorkspaceAvailabilityCache(clientId);
      const refreshed = await prisma.workspaceAvailabilityCache.findUnique({
        where: { clientId },
        select: {
          calendarLinkId: true,
          calendarType: true,
          calendarUrl: true,
          slotDurationMinutes: true,
          slotsUtc: true,
          providerMeta: true,
          fetchedAt: true,
          staleAt: true,
          lastError: true,
        },
      });

      if (refreshed) {
        cache = refreshed;
      } else if (refresh.error) {
        return {
          slotsUtc: [],
          calendarType: "unknown",
          calendarUrl: "",
          providerMeta: {},
          fetchedAt: now,
          staleAt: now,
          lastError: refresh.error,
        };
      }
    } else {
      return {
        slotsUtc: [],
        calendarType: "unknown",
        calendarUrl: "",
        providerMeta: {},
        fetchedAt: now,
        staleAt: now,
        lastError: "Availability cache not found",
      };
    }
  } else if (refreshIfStale && (cache.staleAt <= now || defaultChanged || durationChanged || metaMissing)) {
    await refreshWorkspaceAvailabilityCache(clientId);
    const refreshed = await prisma.workspaceAvailabilityCache.findUnique({
      where: { clientId },
      select: {
        calendarLinkId: true,
        calendarType: true,
        calendarUrl: true,
        slotDurationMinutes: true,
        slotsUtc: true,
        providerMeta: true,
        fetchedAt: true,
        staleAt: true,
        lastError: true,
      },
    });

    if (refreshed) cache = refreshed;
  }

  const slotsUtc = Array.isArray(cache?.slotsUtc) ? (cache?.slotsUtc as unknown as string[]) : [];
  const providerMeta = (cache?.providerMeta || {}) as AvailabilityCacheMeta;

  return {
    slotsUtc,
    calendarType: (cache?.calendarType as CalendarType) || "unknown",
    calendarUrl: cache?.calendarUrl || "",
    providerMeta,
    fetchedAt: cache?.fetchedAt || now,
    staleAt: cache?.staleAt || now,
    lastError: cache?.lastError ?? null,
  };
}

export async function getWorkspaceAvailabilitySlotsUtc(clientId: string, opts?: { refreshIfStale?: boolean }): Promise<{
  slotsUtc: string[];
  calendarType: CalendarType | "unknown";
  calendarUrl: string;
  providerMeta: AvailabilityCacheMeta;
  lastError: string | null;
}> {
  const now = new Date();
  const cache = await getWorkspaceAvailabilityCache(clientId, opts);

  // Filter out slots already booked in our DB (best-effort de-dupe)
  const booked = await prisma.lead.findMany({
    where: { clientId, bookedSlot: { not: null } },
    select: { bookedSlot: true },
  });

  const bookedSet = new Set(
    booked
      .filter((b) => b.bookedSlot)
      .map((b) => new Date(b.bookedSlot as string).toISOString())
  );

  const unbooked = cache.slotsUtc.filter((iso) => !bookedSet.has(iso));
  const future = unbooked.filter((iso) => new Date(iso).getTime() >= now.getTime());

  const removedPastOrBad = unbooked.length - future.length;
  if (removedPastOrBad > 0) {
    console.warn("[Availability] Stripped past/bad slots from cache result", {
      clientId,
      removed: removedPastOrBad,
      remaining: future.length,
      fetchedAt: cache.fetchedAt.toISOString(),
      staleAt: cache.staleAt.toISOString(),
    });
  }

  return {
    slotsUtc: future,
    calendarType: cache.calendarType,
    calendarUrl: cache.calendarUrl,
    providerMeta: cache.providerMeta,
    lastError: cache.lastError,
  };
}

export async function refreshAvailabilityCachesDue(opts?: {
  limit?: number;
  timeBudgetMs?: number;
  concurrency?: number;
  mode?: "due" | "all";
  invocationId?: string;
}): Promise<{
  invocationId: string | null;
  mode: "due" | "all";
  checked: number;
  attempted: number;
  refreshed: number;
  skippedNoDefault: number;
  skippedUnsupportedDuration: number;
  skippedBackoff: number;
  errors: string[];
  finishedWithinBudget: boolean;
  metrics: {
    totalCaches: number;
    dueCaches: number;
    erroringCaches: number;
    oldestSuccessfulRangeStartAgeMinutes: number | null;
    oldestSuccessfulClientId: string | null;
  };
}> {
  const startedAtMs = Date.now();
  const timeBudgetMs = getCronTimeBudgetMs(opts?.timeBudgetMs);
  const deadlineMs = startedAtMs + timeBudgetMs;
  const now = new Date();
  const mode = opts?.mode ?? "due";
  const invocationId = opts?.invocationId ?? null;

  const one = await prisma.workspaceAvailabilityCache
    .findFirst({
      where: { lastError: null },
      orderBy: { rangeStart: "asc" },
      select: { clientId: true, rangeStart: true },
    })
    .catch(() => null);

  const [totalCaches, dueCaches, erroringCaches] = await Promise.all([
    prisma.workspaceAvailabilityCache.count().catch(() => 0),
    prisma.workspaceAvailabilityCache.count({ where: { staleAt: { lte: now } } }).catch(() => 0),
    prisma.workspaceAvailabilityCache.count({ where: { lastError: { not: null } } }).catch(() => 0),
  ]);

  const oldestSuccessfulRangeStartAgeMinutes = one?.rangeStart
    ? Math.round((now.getTime() - one.rangeStart.getTime()) / 60_000)
    : null;

  let candidates: Array<{ clientId: string; userId: string | null; staleAt: Date | null; lastError: string | null }> = [];

  if (mode === "all") {
    const clients = await prisma.client.findMany({
      where: { calendarLinks: { some: { isDefault: true } } },
      select: {
        id: true,
        userId: true,
        availabilityCache: {
          select: {
            staleAt: true,
            lastError: true,
          },
        },
      },
    });

    candidates = clients.map((c) => ({
      clientId: c.id,
      userId: c.userId ?? null,
      staleAt: c.availabilityCache?.staleAt ?? null,
      lastError: c.availabilityCache?.lastError ?? null,
    }));
  } else {
    const limit = Math.max(1, opts?.limit ?? 50);

    const stale = await prisma.workspaceAvailabilityCache.findMany({
      where: { staleAt: { lte: now } },
      select: { clientId: true, staleAt: true, lastError: true, client: { select: { userId: true } } },
      orderBy: { staleAt: "asc" },
      take: limit,
    });

    const missing = await prisma.client.findMany({
      where: {
        calendarLinks: { some: { isDefault: true } },
        availabilityCache: { is: null },
      },
      select: { id: true, userId: true },
      take: Math.max(0, limit - stale.length),
      orderBy: { createdAt: "asc" },
    });

    candidates = [
      ...stale.map((c) => ({
        clientId: c.clientId,
        userId: c.client.userId ?? null,
        staleAt: c.staleAt ?? null,
        lastError: c.lastError ?? null,
      })),
      ...missing.map((c) => ({
        clientId: c.id,
        userId: c.userId ?? null,
        staleAt: null,
        lastError: null,
      })),
    ];
  }

  // Multi-agency fairness: interleave workspaces across userId buckets (Client.userId).
  const byUserId = new Map<string, Array<{ clientId: string; userId: string; staleAt: Date | null; lastError: string | null }>>();
  const noUser: Array<{ clientId: string; userId: string; staleAt: Date | null; lastError: string | null }> = [];
  for (const row of candidates) {
    if (row.userId) {
      const list = byUserId.get(row.userId) ?? [];
      list.push({ clientId: row.clientId, userId: row.userId, staleAt: row.staleAt, lastError: row.lastError });
      byUserId.set(row.userId, list);
    } else {
      noUser.push({ clientId: row.clientId, userId: "__none__", staleAt: row.staleAt, lastError: row.lastError });
    }
  }

  const userIds = Array.from(byUserId.keys()).sort();
  for (const userId of userIds) {
    const list = byUserId.get(userId);
    if (list) list.sort((a, b) => (a.staleAt?.getTime() ?? 0) - (b.staleAt?.getTime() ?? 0) || a.clientId.localeCompare(b.clientId));
  }

  noUser.sort((a, b) => (a.staleAt?.getTime() ?? 0) - (b.staleAt?.getTime() ?? 0) || a.clientId.localeCompare(b.clientId));

  const queue: Array<{ clientId: string; userId: string; staleAt: Date | null; lastError: string | null }> = [];
  const pointers = new Map<string, number>(userIds.map((id) => [id, 0]));
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (const userId of userIds) {
      const list = byUserId.get(userId);
      if (!list) continue;
      const idx = pointers.get(userId) ?? 0;
      if (idx < list.length) {
        queue.push(list[idx]);
        pointers.set(userId, idx + 1);
        remaining = true;
      }
    }
    if (queue.length > 50_000) break;
  }
  queue.push(...noUser);

  const concurrencyFromEnv = parsePositiveInt(process.env.AVAILABILITY_CRON_CONCURRENCY);
  const computedConcurrency = Math.ceil(queue.length / 10);
  const concurrency = Math.max(1, Math.min(200, opts?.concurrency ?? concurrencyFromEnv ?? computedConcurrency));

  const errors: string[] = [];
  let attempted = 0;
  let refreshed = 0;
  let skippedNoDefault = 0;
  let skippedUnsupportedDuration = 0;
  let skippedBackoff = 0;

  let idx = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < queue.length) {
      if (Date.now() > deadlineMs - 7_500) break;

      const current = queue[idx];
      idx++;

      if (current?.staleAt && current.lastError && shouldRespectBackoff({ staleAt: current.staleAt, lastError: current.lastError }) && current.staleAt > now) {
        skippedBackoff++;
        continue;
      }

      attempted++;

      const result = await refreshWorkspaceAvailabilityCache(current.clientId);
      if (result.success) {
        refreshed++;
        continue;
      }

      if (result.error === "No default calendar link configured") {
        skippedNoDefault++;
        continue;
      }

      if (result.error?.startsWith("Unsupported meeting duration")) {
        skippedUnsupportedDuration++;
        continue;
      }

      if (result.error) {
        errors.push(`${current.clientId}: ${result.error}`);
      }
    }
  });

  await Promise.all(workers);

  return {
    invocationId,
    mode,
    checked: queue.length,
    attempted,
    refreshed,
    skippedNoDefault,
    skippedUnsupportedDuration,
    skippedBackoff,
    errors,
    finishedWithinBudget: Date.now() <= deadlineMs,
    metrics: {
      totalCaches,
      dueCaches,
      erroringCaches,
      oldestSuccessfulRangeStartAgeMinutes,
      oldestSuccessfulClientId: one?.clientId ?? null,
    },
  };
}
