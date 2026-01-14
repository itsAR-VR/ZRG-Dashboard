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
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const REQUIRED_DURATION_MINUTES = 30;
const UNCONFIGURED_BACKOFF_MS = 24 * 60 * 60 * 1000; // 24 hours
const UNSUPPORTED_DURATION_BACKOFF_MS = 2 * 60 * 60 * 1000; // 2 hours

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
          staleAt: new Date(now.getTime() + CACHE_TTL_MS),
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
          staleAt: new Date(now.getTime() + CACHE_TTL_MS),
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
        staleAt: new Date(now.getTime() + CACHE_TTL_MS),
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
        staleAt: new Date(now.getTime() + CACHE_TTL_MS),
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
          staleAt: new Date(now.getTime() + CACHE_TTL_MS),
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
          staleAt: new Date(now.getTime() + CACHE_TTL_MS),
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

  if (!cache || (refreshIfStale && (cache.staleAt <= now || defaultChanged || durationChanged || metaMissing))) {
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
    } else if (!cache && refresh.error) {
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

  return {
    slotsUtc: cache.slotsUtc.filter((iso) => !bookedSet.has(iso)),
    calendarType: cache.calendarType,
    calendarUrl: cache.calendarUrl,
    providerMeta: cache.providerMeta,
    lastError: cache.lastError,
  };
}

export async function refreshAvailabilityCachesDue(opts?: { limit?: number }): Promise<{
  checked: number;
  refreshed: number;
  skippedNoDefault: number;
  skippedUnsupportedDuration: number;
  errors: string[];
}> {
  const now = new Date();
  const limit = opts?.limit ?? 50;

  const stale = await prisma.workspaceAvailabilityCache.findMany({
    where: { staleAt: { lte: now } },
    select: { clientId: true },
    take: limit,
  });

  const missing = await prisma.client.findMany({
    where: {
      calendarLinks: { some: { isDefault: true } },
      availabilityCache: { is: null },
    },
    select: { id: true },
    take: Math.max(0, limit - stale.length),
  });

  const clientIds = Array.from(new Set([...stale.map((c) => c.clientId), ...missing.map((c) => c.id)]));

  const errors: string[] = [];
  let refreshed = 0;
  let skippedNoDefault = 0;
  let skippedUnsupportedDuration = 0;

  for (const clientId of clientIds) {
    const result = await refreshWorkspaceAvailabilityCache(clientId);
    if (result.success) {
      refreshed++;
    } else if (result.error) {
      if (result.error === "No default calendar link configured") {
        skippedNoDefault++;
        continue;
      }
      if (result.error.startsWith("Unsupported meeting duration")) {
        skippedUnsupportedDuration++;
        continue;
      }
      errors.push(`${clientId}: ${result.error}`);
    }
  }

  return { checked: clientIds.length, refreshed, skippedNoDefault, skippedUnsupportedDuration, errors };
}
