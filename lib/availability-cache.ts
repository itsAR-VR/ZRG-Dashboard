import "@/lib/server-dns";
import { prisma } from "@/lib/prisma";
import type { AvailabilitySource } from "@prisma/client";
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

function normalizeAvailabilitySourceForClient(opts: {
  requested: AvailabilitySource;
  settings:
    | {
        meetingBookingProvider?: "GHL" | "CALENDLY" | null;
        calendlyEventTypeLink?: string | null;
        calendlyEventTypeUri?: string | null;
        calendlyDirectBookEventTypeLink?: string | null;
        calendlyDirectBookEventTypeUri?: string | null;
        ghlDefaultCalendarId?: string | null;
        ghlDirectBookCalendarId?: string | null;
      }
    | null
    | undefined;
}): AvailabilitySource {
  if (opts.requested !== "DIRECT_BOOK") return "DEFAULT";

  const provider = opts.settings?.meetingBookingProvider ?? "GHL";

  if (provider === "CALENDLY") {
    const linkA = (opts.settings?.calendlyEventTypeLink || "").trim();
    const linkB = (opts.settings?.calendlyDirectBookEventTypeLink || "").trim();
    const uriA = (opts.settings?.calendlyEventTypeUri || "").trim();
    const uriB = (opts.settings?.calendlyDirectBookEventTypeUri || "").trim();

    const hasA = Boolean(linkA || uriA);
    const hasB = Boolean(linkB || uriB);

    if (!hasB) return "DEFAULT";
    if (linkA && linkB && linkB === linkA) return "DEFAULT";
    if (uriA && uriB && uriB === uriA) return "DEFAULT";
    if (!hasA) return "DIRECT_BOOK";

    return "DIRECT_BOOK";
  }

  const defaultCalendarId = (opts.settings?.ghlDefaultCalendarId || "").trim();
  const directBookCalendarId = (opts.settings?.ghlDirectBookCalendarId || "").trim();
  if (!directBookCalendarId) return "DEFAULT";
  if (defaultCalendarId && directBookCalendarId === defaultCalendarId) return "DEFAULT";
  return "DIRECT_BOOK";
}

function resolveAvailabilityUrl(opts: {
  calendarLinkUrl: string;
  settings:
    | {
        meetingBookingProvider?: "GHL" | "CALENDLY" | null;
        calendlyEventTypeLink?: string | null;
        calendlyEventTypeUri?: string | null;
        calendlyDirectBookEventTypeLink?: string | null;
        calendlyDirectBookEventTypeUri?: string | null;
      }
    | null
    | undefined;
  availabilitySource: AvailabilitySource;
}): string {
  const baseUrl = normalizeCalendarUrl(opts.calendarLinkUrl);
  if (!baseUrl) return "";

  if (opts.settings?.meetingBookingProvider !== "CALENDLY") {
    return baseUrl;
  }

  const linkA = normalizeCalendarUrl((opts.settings?.calendlyEventTypeLink || "").trim());
  const linkB = normalizeCalendarUrl((opts.settings?.calendlyDirectBookEventTypeLink || "").trim());
  const uriA = normalizeCalendarUrl((opts.settings?.calendlyEventTypeUri || "").trim());
  const uriB = normalizeCalendarUrl((opts.settings?.calendlyDirectBookEventTypeUri || "").trim());

  return opts.availabilitySource === "DIRECT_BOOK"
    ? linkB || uriB || linkA || uriA || baseUrl
    : linkA || uriA || baseUrl;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function tryExtractCalendlyEventTypeUuid(value: string | null | undefined): string | null {
  const trimmed = (value || "").trim();
  if (!trimmed) return null;

  // Supports:
  // - https://api.calendly.com/event_types/<uuid>
  // - https://calendly.com/api/booking/event_types/<uuid>/...
  const match = trimmed.match(/\/event_types\/([0-9a-f-]{16,})(?:$|[/?#])/i);
  if (!match) return null;

  return match[1] || null;
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

export async function refreshWorkspaceAvailabilityCache(
  clientId: string,
  opts?: { availabilitySource?: AvailabilitySource }
): Promise<{ success: boolean; error?: string; availabilitySource: AvailabilitySource }> {
  const now = new Date();
  const cacheTtlMs = getCacheTtlMs();
  const requestedAvailabilitySource: AvailabilitySource =
    opts?.availabilitySource === "DIRECT_BOOK" ? "DIRECT_BOOK" : "DEFAULT";
  let availabilitySource: AvailabilitySource = requestedAvailabilitySource;

  try {
    const [calendarLink, settings] = await Promise.all([
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
          ghlDirectBookCalendarId: true,
          calendlyEventTypeLink: true,
          calendlyEventTypeUri: true,
          calendlyDirectBookEventTypeLink: true,
          calendlyDirectBookEventTypeUri: true,
        },
      }),
    ]);

    availabilitySource = normalizeAvailabilitySourceForClient({
      requested: requestedAvailabilitySource,
      settings,
    });

    const existingCache = await prisma.workspaceAvailabilityCache
      .findUnique({
        where: { clientId_availabilitySource: { clientId, availabilitySource } },
        select: { calendarLinkId: true, calendarUrl: true, providerMeta: true },
      })
      .catch(() => null);

    if (!calendarLink) {
      // No default link configured; store an explicit empty cache entry so callers
      // can render gracefully instead of throwing during SSR.
      const error = "No default calendar link configured";

      await prisma.workspaceAvailabilityCache
        .upsert({
          where: { clientId_availabilitySource: { clientId, availabilitySource } },
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
            availabilitySource,
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

      return { success: false, error, availabilitySource };
    }

    let calendarUrl = resolveAvailabilityUrl({
      calendarLinkUrl: calendarLink.url,
      settings,
      availabilitySource,
    });

    if (!calendarUrl) {
      const error = "No default calendar link configured";

      await prisma.workspaceAvailabilityCache
        .upsert({
          where: { clientId_availabilitySource: { clientId, availabilitySource } },
          update: {
            calendarLinkId: calendarLink.id,
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
            availabilitySource,
            calendarLinkId: calendarLink.id,
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

      return { success: false, error, availabilitySource };
    }

    const meetingDuration = settings?.meetingDurationMinutes ?? REQUIRED_DURATION_MINUTES;
    if (meetingDuration !== REQUIRED_DURATION_MINUTES) {
      const error = `Unsupported meeting duration (${meetingDuration}m). Set Meeting Duration to ${REQUIRED_DURATION_MINUTES} minutes to use live availability.`;

      await prisma.workspaceAvailabilityCache.upsert({
        where: { clientId_availabilitySource: { clientId, availabilitySource } },
        update: {
          calendarLinkId: calendarLink.id,
          calendarType: detectCalendarType(calendarUrl),
          calendarUrl,
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
          availabilitySource,
          calendarLinkId: calendarLink.id,
          calendarType: detectCalendarType(calendarUrl),
          calendarUrl,
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

      return { success: false, error, availabilitySource };
    }

    const detectedType = detectCalendarType(calendarUrl);
    const calendarType =
      (calendarLink.type === "unknown" ? detectedType : (calendarLink.type as CalendarType)) || detectedType;

    let rawSlots: AvailabilitySlot[] = [];
    const providerMeta: AvailabilityCacheMeta = {};
    let lastError: string | null = null;

    const cachedMeta =
      existingCache &&
      existingCache.calendarLinkId === calendarLink.id &&
      normalizeCalendarUrl(existingCache.calendarUrl) === calendarUrl &&
      existingCache.providerMeta &&
      typeof existingCache.providerMeta === "object"
        ? (existingCache.providerMeta as AvailabilityCacheMeta)
        : null;

    if (calendarType === "calendly") {
      const settingsEventTypeUuid =
        availabilitySource === "DIRECT_BOOK"
          ? tryExtractCalendlyEventTypeUuid(settings?.calendlyDirectBookEventTypeUri)
          : tryExtractCalendlyEventTypeUuid(settings?.calendlyEventTypeUri);

      const calendly = await fetchCalendlyAvailabilityWithMeta(calendarUrl, DEFAULT_LOOKAHEAD_DAYS, {
        eventTypeUuid:
          settingsEventTypeUuid ?? cachedMeta?.calendlyEventTypeUuid ?? tryExtractCalendlyEventTypeUuid(calendarUrl),
        availabilityTimezone: cachedMeta?.calendlyAvailabilityTimezone ?? null,
      });
      rawSlots = calendly.slots;
      providerMeta.calendlyEventTypeUuid = calendly.eventTypeUuid;
      providerMeta.calendlyAvailabilityTimezone = calendly.availabilityTimezone;

      const fallbackUrl = resolveAvailabilityUrl({
        calendarLinkUrl: calendarLink.url,
        settings,
        availabilitySource,
      });

      if (rawSlots.length === 0 && fallbackUrl && fallbackUrl !== calendarUrl) {
        const fallback = await fetchCalendlyAvailabilityWithMeta(fallbackUrl, DEFAULT_LOOKAHEAD_DAYS, {
          eventTypeUuid:
            settingsEventTypeUuid ?? cachedMeta?.calendlyEventTypeUuid ?? tryExtractCalendlyEventTypeUuid(fallbackUrl),
          availabilityTimezone: cachedMeta?.calendlyAvailabilityTimezone ?? null,
        });

        if (fallback.slots.length > 0) {
          rawSlots = fallback.slots;
          providerMeta.calendlyEventTypeUuid = fallback.eventTypeUuid;
          providerMeta.calendlyAvailabilityTimezone = fallback.availabilityTimezone;
          providerMeta.resolvedUrl = fallbackUrl;
          calendarUrl = fallbackUrl;
        }
      }
    } else if (calendarType === "hubspot") {
      rawSlots = await fetchHubSpotAvailability(calendarUrl, DEFAULT_LOOKAHEAD_DAYS);
    } else if (calendarType === "ghl") {
      const desiredCalendarId =
        availabilitySource === "DIRECT_BOOK"
          ? settings?.ghlDirectBookCalendarId || null
          : settings?.ghlDefaultCalendarId || null;
      const calendarIdHint = cachedMeta?.ghlCalendarId || desiredCalendarId || null;
      const ghl = await fetchGHLAvailabilityWithMeta(calendarUrl, DEFAULT_LOOKAHEAD_DAYS, { calendarIdHint });
      rawSlots = ghl.slots;
      providerMeta.ghlCalendarId = ghl.calendarId;
      providerMeta.resolvedUrl = ghl.resolvedUrl;
      if (!rawSlots.length && ghl.error) lastError = ghl.error;

      if (!rawSlots.length && desiredCalendarId && desiredCalendarId !== ghl.calendarId) {
        const fallback = await fetchGHLAvailabilityWithMeta(calendarUrl, DEFAULT_LOOKAHEAD_DAYS, {
          calendarIdHint: desiredCalendarId,
        });

        if (fallback.slots.length > 0) {
          rawSlots = fallback.slots;
          providerMeta.ghlCalendarId = fallback.calendarId;
          providerMeta.resolvedUrl = fallback.resolvedUrl;
        } else if (fallback.error && !lastError) {
          lastError = fallback.error;
        }
      }
    } else {
      const error = `Unsupported calendar link. Supported: Calendly, HubSpot, or GoHighLevel. URL: ${calendarUrl || "(empty)"}`;
      await prisma.workspaceAvailabilityCache.upsert({
        where: { clientId_availabilitySource: { clientId, availabilitySource } },
        update: {
          calendarLinkId: calendarLink.id,
          calendarType: calendarType,
          calendarUrl,
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
          availabilitySource,
          calendarLinkId: calendarLink.id,
          calendarType: calendarType,
          calendarUrl,
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
      return { success: false, error, availabilitySource };
    }

    rawSlots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    const slotsUtc = dedupeSortedIso(rawSlots.map((s) => s.startTime.toISOString()));

    await prisma.workspaceAvailabilityCache.upsert({
      where: { clientId_availabilitySource: { clientId, availabilitySource } },
      update: {
        calendarLinkId: calendarLink.id,
        calendarType: calendarType,
        calendarUrl,
        slotDurationMinutes: REQUIRED_DURATION_MINUTES,
        rangeStart: now,
        rangeEnd: addDays(now, DEFAULT_LOOKAHEAD_DAYS),
        slotsUtc: slotsUtc as any,
        providerMeta: providerMeta as any,
        fetchedAt: now,
        staleAt: new Date(now.getTime() + cacheTtlMs),
        lastError: rawSlots.length === 0 ? lastError || "No availability slots found" : null,
      },
      create: {
        clientId,
        availabilitySource,
        calendarLinkId: calendarLink.id,
        calendarType: calendarType,
        calendarUrl,
        slotDurationMinutes: REQUIRED_DURATION_MINUTES,
        rangeStart: now,
        rangeEnd: addDays(now, DEFAULT_LOOKAHEAD_DAYS),
        slotsUtc: slotsUtc as any,
        providerMeta: providerMeta as any,
        fetchedAt: now,
        staleAt: new Date(now.getTime() + cacheTtlMs),
        lastError: rawSlots.length === 0 ? lastError || "No availability slots found" : null,
      },
    });

    return { success: true, availabilitySource };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await prisma.workspaceAvailabilityCache
      .upsert({
        where: { clientId_availabilitySource: { clientId, availabilitySource } },
        update: {
          fetchedAt: now,
          staleAt: new Date(now.getTime() + cacheTtlMs),
          lastError: message,
        },
        create: {
          clientId,
          availabilitySource,
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

    return { success: false, error: message, availabilitySource };
  }
}

export async function getWorkspaceAvailabilityCache(
  clientId: string,
  opts?: { refreshIfStale?: boolean; availabilitySource?: AvailabilitySource }
): Promise<{
  slotsUtc: string[];
  calendarType: CalendarType | "unknown";
  calendarUrl: string;
  providerMeta: AvailabilityCacheMeta;
  fetchedAt: Date;
  staleAt: Date;
  lastError: string | null;
  availabilitySource: AvailabilitySource;
}> {
  const now = new Date();
  const refreshIfStale = opts?.refreshIfStale ?? true;
  const requestedAvailabilitySource: AvailabilitySource =
    opts?.availabilitySource === "DIRECT_BOOK" ? "DIRECT_BOOK" : "DEFAULT";

  const shouldLoadSettings = refreshIfStale || requestedAvailabilitySource === "DIRECT_BOOK";

  const [defaultLink, settings] = shouldLoadSettings
    ? await Promise.all([
        prisma.calendarLink.findFirst({
          where: { clientId, isDefault: true },
          select: { id: true, url: true },
        }),
        prisma.workspaceSettings.findUnique({
          where: { clientId },
          select: {
            meetingDurationMinutes: true,
            meetingBookingProvider: true,
            calendlyEventTypeLink: true,
            calendlyEventTypeUri: true,
            calendlyDirectBookEventTypeLink: true,
            calendlyDirectBookEventTypeUri: true,
            ghlDefaultCalendarId: true,
            ghlDirectBookCalendarId: true,
          },
        }),
      ])
    : [null, null];

  const availabilitySource = normalizeAvailabilitySourceForClient({
    requested: requestedAvailabilitySource,
    settings,
  });

  let cache = await prisma.workspaceAvailabilityCache.findUnique({
    where: { clientId_availabilitySource: { clientId, availabilitySource } },
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

  const expectedUrl =
    defaultLink?.url
      ? resolveAvailabilityUrl({
          calendarLinkUrl: defaultLink.url,
          settings,
          availabilitySource,
        })
      : "";

  const cachedUrl = cache?.calendarUrl ? normalizeCalendarUrl(cache.calendarUrl) : "";
  const defaultChanged =
    !!defaultLink && !!cache && (cache.calendarLinkId !== defaultLink.id || cachedUrl !== expectedUrl);

  const currentDuration =
    typeof settings?.meetingDurationMinutes === "number" ? settings.meetingDurationMinutes : REQUIRED_DURATION_MINUTES;
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
      const refresh = await refreshWorkspaceAvailabilityCache(clientId, {
        availabilitySource: requestedAvailabilitySource,
      });
      const refreshed = await prisma.workspaceAvailabilityCache.findUnique({
        where: { clientId_availabilitySource: { clientId, availabilitySource } },
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
          availabilitySource,
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
        availabilitySource,
      };
    }
  } else if (refreshIfStale && (cache.staleAt <= now || defaultChanged || durationChanged || metaMissing)) {
    await refreshWorkspaceAvailabilityCache(clientId, { availabilitySource: requestedAvailabilitySource });
    const refreshed = await prisma.workspaceAvailabilityCache.findUnique({
      where: { clientId_availabilitySource: { clientId, availabilitySource } },
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
    availabilitySource,
  };
}

export async function getWorkspaceAvailabilitySlotsUtc(
  clientId: string,
  opts?: { refreshIfStale?: boolean; availabilitySource?: AvailabilitySource }
): Promise<{
  slotsUtc: string[];
  calendarType: CalendarType | "unknown";
  calendarUrl: string;
  providerMeta: AvailabilityCacheMeta;
  lastError: string | null;
  availabilitySource: AvailabilitySource;
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
    availabilitySource: cache.availabilitySource,
  };
}

export async function refreshAvailabilityCachesDue(opts?: {
  limit?: number;
  timeBudgetMs?: number;
  concurrency?: number;
  mode?: "due" | "all";
  invocationId?: string;
  availabilitySource?: AvailabilitySource;
}): Promise<{
  invocationId: string | null;
  mode: "due" | "all";
  availabilitySource: AvailabilitySource;
  checked: number;
  attempted: number;
  refreshed: number;
  skippedNoDefault: number;
  skippedUnsupportedDuration: number;
  skippedBackoff: number;
  skippedNotConfigured: number;
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
  const availabilitySource: AvailabilitySource =
    opts?.availabilitySource === "DIRECT_BOOK" ? "DIRECT_BOOK" : "DEFAULT";

  const isEligibleClient = (settings: Parameters<typeof normalizeAvailabilitySourceForClient>[0]["settings"]): boolean => {
    if (availabilitySource !== "DIRECT_BOOK") return true;
    return (
      normalizeAvailabilitySourceForClient({
        requested: "DIRECT_BOOK",
        settings,
      }) === "DIRECT_BOOK"
    );
  };

  const one = await prisma.workspaceAvailabilityCache
    .findFirst({
      where: { availabilitySource, lastError: null },
      orderBy: { rangeStart: "asc" },
      select: { clientId: true, rangeStart: true },
    })
    .catch(() => null);

  const [totalCaches, dueCaches, erroringCaches] = await Promise.all([
    prisma.workspaceAvailabilityCache.count({ where: { availabilitySource } }).catch(() => 0),
    prisma.workspaceAvailabilityCache
      .count({ where: { availabilitySource, staleAt: { lte: now } } })
      .catch(() => 0),
    prisma.workspaceAvailabilityCache.count({ where: { availabilitySource, lastError: { not: null } } }).catch(() => 0),
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
        settings: {
          select: {
            meetingBookingProvider: true,
            calendlyEventTypeLink: true,
            calendlyEventTypeUri: true,
            calendlyDirectBookEventTypeLink: true,
            calendlyDirectBookEventTypeUri: true,
            ghlDefaultCalendarId: true,
            ghlDirectBookCalendarId: true,
          },
        },
        availabilityCaches: {
          where: { availabilitySource },
          select: {
            staleAt: true,
            lastError: true,
          },
        },
      },
    });

    candidates = clients
      .filter((c) => isEligibleClient(c.settings))
      .map((c) => {
        const cache = c.availabilityCaches[0] ?? null;
        return {
          clientId: c.id,
          userId: c.userId ?? null,
          staleAt: cache?.staleAt ?? null,
          lastError: cache?.lastError ?? null,
        };
      });
  } else {
    const limit = Math.max(1, opts?.limit ?? 50);
    const takeMultiplier = availabilitySource === "DIRECT_BOOK" ? 3 : 1;
    const take = Math.min(500, limit * takeMultiplier);

    const stale = await prisma.workspaceAvailabilityCache.findMany({
      where: { availabilitySource, staleAt: { lte: now } },
      select: {
        clientId: true,
        staleAt: true,
        lastError: true,
        client: {
          select: {
            userId: true,
            settings: {
              select: {
                meetingBookingProvider: true,
                calendlyEventTypeLink: true,
                calendlyEventTypeUri: true,
                calendlyDirectBookEventTypeLink: true,
                calendlyDirectBookEventTypeUri: true,
                ghlDefaultCalendarId: true,
                ghlDirectBookCalendarId: true,
              },
            },
          },
        },
      },
      orderBy: { staleAt: "asc" },
      take,
    });

    const missing = await prisma.client.findMany({
      where: {
        calendarLinks: { some: { isDefault: true } },
        availabilityCaches: { none: { availabilitySource } },
      },
      select: {
        id: true,
        userId: true,
        settings: {
          select: {
            meetingBookingProvider: true,
            calendlyEventTypeLink: true,
            calendlyEventTypeUri: true,
            calendlyDirectBookEventTypeLink: true,
            calendlyDirectBookEventTypeUri: true,
            ghlDefaultCalendarId: true,
            ghlDirectBookCalendarId: true,
          },
        },
      },
      take: Math.min(500, Math.max(0, (limit - stale.length) * (availabilitySource === "DIRECT_BOOK" ? 3 : 1))),
      orderBy: { createdAt: "asc" },
    });

    const staleEligible =
      availabilitySource === "DIRECT_BOOK"
        ? stale.filter((c) => isEligibleClient(c.client.settings))
        : stale;

    const selectedStale = staleEligible.slice(0, limit);
    const remaining = Math.max(0, limit - selectedStale.length);

    const missingEligible =
      availabilitySource === "DIRECT_BOOK"
        ? missing.filter((c) => isEligibleClient(c.settings))
        : missing;

    const selectedMissing = missingEligible.slice(0, remaining);

    candidates = [
      ...selectedStale.map((c) => ({
        clientId: c.clientId,
        userId: c.client.userId ?? null,
        staleAt: c.staleAt ?? null,
        lastError: c.lastError ?? null,
      })),
      ...selectedMissing.map((c) => ({
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
  let skippedNotConfigured = 0;

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

      const result = await refreshWorkspaceAvailabilityCache(current.clientId, { availabilitySource });
      if (availabilitySource === "DIRECT_BOOK" && result.availabilitySource !== "DIRECT_BOOK") {
        skippedNotConfigured++;
        continue;
      }

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
    availabilitySource,
    checked: queue.length,
    attempted,
    refreshed,
    skippedNoDefault,
    skippedUnsupportedDuration,
    skippedBackoff,
    skippedNotConfigured,
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
