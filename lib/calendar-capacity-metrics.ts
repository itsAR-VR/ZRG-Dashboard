import "server-only";

import { prisma } from "@/lib/prisma";
import { AppointmentStatus, type AvailabilitySource, type MeetingBookingProvider } from "@prisma/client";

type CapacityBreakdownRow = {
  source: AvailabilitySource;
  availableSlots: number;
  bookedSlots: number;
  totalSlots: number;
  bookedPct: number | null;
};

type CapacityCacheMetaRow = {
  source: AvailabilitySource;
  fetchedAtIso: string;
  isStale: boolean;
  calendarType: string;
  calendarUrl: string;
  lastError: string | null;
};

export interface CapacityUtilization {
  fromUtcIso: string;
  toUtcIso: string;
  windowDays: number;

  bookedSlots: number;
  availableSlots: number;
  totalSlots: number;
  bookedPct: number | null;

  breakdown: CapacityBreakdownRow[];
  unattributedBookedSlots: number;

  cacheMeta: CapacityCacheMetaRow[];
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function parseSlotsUtc(value: unknown): string[] {
  return Array.isArray(value)
    ? (value as unknown[]).filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];
}

function filterSlotsInWindow(slotsUtc: string[], now: Date, end: Date): string[] {
  const nowMs = now.getTime();
  const endMs = end.getTime();
  const result: string[] = [];

  for (const iso of slotsUtc) {
    const d = new Date(iso);
    const ms = d.getTime();
    if (!Number.isFinite(ms)) continue;
    if (ms < nowMs) continue;
    if (ms >= endMs) continue;
    result.push(d.toISOString());
  }

  return result;
}

function computePct(booked: number, available: number): number | null {
  const denom = booked + available;
  if (!Number.isFinite(denom) || denom <= 0) return null;
  return clampPct(booked / denom);
}

function normalizeProvider(value: MeetingBookingProvider | null | undefined): MeetingBookingProvider {
  return value === "CALENDLY" ? "CALENDLY" : "GHL";
}

function normalizeKey(value: string | null | undefined): string {
  return (value || "").trim();
}

export async function getWorkspaceCapacityUtilization(opts: {
  clientId: string;
  windowDays?: number;
}): Promise<CapacityUtilization> {
  const now = new Date();
  const windowDays = clampInt(Number(opts.windowDays ?? 30) || 30, 1, 90);
  const windowEnd = addDays(now, windowDays);

  const clientId = (opts.clientId || "").trim();
  if (!clientId) {
    return {
      fromUtcIso: now.toISOString(),
      toUtcIso: windowEnd.toISOString(),
      windowDays,
      bookedSlots: 0,
      availableSlots: 0,
      totalSlots: 0,
      bookedPct: null,
      breakdown: [
        { source: "DEFAULT", availableSlots: 0, bookedSlots: 0, totalSlots: 0, bookedPct: null },
        { source: "DIRECT_BOOK", availableSlots: 0, bookedSlots: 0, totalSlots: 0, bookedPct: null },
      ],
      unattributedBookedSlots: 0,
      cacheMeta: [
        {
          source: "DEFAULT",
          fetchedAtIso: now.toISOString(),
          isStale: true,
          calendarType: "unknown",
          calendarUrl: "",
          lastError: "Missing clientId",
        },
        {
          source: "DIRECT_BOOK",
          fetchedAtIso: now.toISOString(),
          isStale: true,
          calendarType: "unknown",
          calendarUrl: "",
          lastError: "Missing clientId",
        },
      ],
    };
  }

  const [settings, cacheDefault, cacheDirect] = await Promise.all([
    prisma.workspaceSettings.findUnique({
      where: { clientId },
      select: {
        meetingBookingProvider: true,
        ghlDefaultCalendarId: true,
        ghlDirectBookCalendarId: true,
        calendlyEventTypeUri: true,
        calendlyDirectBookEventTypeUri: true,
      },
    }),
    prisma.workspaceAvailabilityCache.findUnique({
      where: { clientId_availabilitySource: { clientId, availabilitySource: "DEFAULT" } },
      select: {
        slotsUtc: true,
        fetchedAt: true,
        staleAt: true,
        calendarType: true,
        calendarUrl: true,
        lastError: true,
      },
    }),
    prisma.workspaceAvailabilityCache.findUnique({
      where: { clientId_availabilitySource: { clientId, availabilitySource: "DIRECT_BOOK" } },
      select: {
        slotsUtc: true,
        fetchedAt: true,
        staleAt: true,
        calendarType: true,
        calendarUrl: true,
        lastError: true,
      },
    }),
  ]);

  const provider = normalizeProvider(settings?.meetingBookingProvider);

  const defaultKey =
    provider === "CALENDLY" ? normalizeKey(settings?.calendlyEventTypeUri) : normalizeKey(settings?.ghlDefaultCalendarId);
  const directKey =
    provider === "CALENDLY"
      ? normalizeKey(settings?.calendlyDirectBookEventTypeUri)
      : normalizeKey(settings?.ghlDirectBookCalendarId);

  const hasDirectDistinct = Boolean(directKey && directKey !== defaultKey);

  const defaultSlots = filterSlotsInWindow(parseSlotsUtc(cacheDefault?.slotsUtc), now, windowEnd);
  const directSlots = hasDirectDistinct ? filterSlotsInWindow(parseSlotsUtc(cacheDirect?.slotsUtc), now, windowEnd) : [];

  const defaultAvailable = defaultSlots.length;
  const directAvailable = directSlots.length;

  const totalBooked = await prisma.appointment.count({
    where: {
      lead: { clientId },
      status: AppointmentStatus.CONFIRMED,
      startAt: { gte: now, lt: windowEnd },
    },
  });

  const [defaultBooked, directBooked] =
    provider === "CALENDLY"
      ? await Promise.all([
          defaultKey
            ? prisma.appointment.count({
                where: {
                  lead: { clientId },
                  provider: "CALENDLY",
                  status: AppointmentStatus.CONFIRMED,
                  startAt: { gte: now, lt: windowEnd },
                  calendlyEventTypeUri: defaultKey,
                },
              })
            : Promise.resolve(0),
          hasDirectDistinct
            ? prisma.appointment.count({
                where: {
                  lead: { clientId },
                  provider: "CALENDLY",
                  status: AppointmentStatus.CONFIRMED,
                  startAt: { gte: now, lt: windowEnd },
                  calendlyEventTypeUri: directKey,
                },
              })
            : Promise.resolve(0),
        ])
      : await Promise.all([
          defaultKey
            ? prisma.appointment.count({
                where: {
                  lead: { clientId },
                  provider: "GHL",
                  status: AppointmentStatus.CONFIRMED,
                  startAt: { gte: now, lt: windowEnd },
                  ghlCalendarId: defaultKey,
                },
              })
            : Promise.resolve(0),
          hasDirectDistinct
            ? prisma.appointment.count({
                where: {
                  lead: { clientId },
                  provider: "GHL",
                  status: AppointmentStatus.CONFIRMED,
                  startAt: { gte: now, lt: windowEnd },
                  ghlCalendarId: directKey,
                },
              })
            : Promise.resolve(0),
        ]);

  const breakdown: CapacityBreakdownRow[] = [
    {
      source: "DEFAULT",
      availableSlots: defaultAvailable,
      bookedSlots: defaultBooked,
      totalSlots: defaultAvailable + defaultBooked,
      bookedPct: computePct(defaultBooked, defaultAvailable),
    },
    {
      source: "DIRECT_BOOK",
      availableSlots: directAvailable,
      bookedSlots: directBooked,
      totalSlots: directAvailable + directBooked,
      bookedPct: computePct(directBooked, directAvailable),
    },
  ];

  const availableSlots = defaultAvailable + directAvailable;
  const bookedSlots = totalBooked;
  const totalSlots = bookedSlots + availableSlots;
  const bookedPct = totalSlots > 0 ? clampPct(bookedSlots / totalSlots) : null;

  const unattributedBookedSlots = Math.max(0, bookedSlots - (defaultBooked + directBooked));

  const cacheMeta: CapacityCacheMetaRow[] = [
    {
      source: "DEFAULT",
      fetchedAtIso: (cacheDefault?.fetchedAt || now).toISOString(),
      isStale: cacheDefault ? cacheDefault.staleAt.getTime() < now.getTime() : true,
      calendarType: cacheDefault?.calendarType || "unknown",
      calendarUrl: cacheDefault?.calendarUrl || "",
      lastError: cacheDefault?.lastError ?? (cacheDefault ? null : "Availability cache not found"),
    },
    {
      source: "DIRECT_BOOK",
      fetchedAtIso: (cacheDirect?.fetchedAt || now).toISOString(),
      isStale: cacheDirect ? cacheDirect.staleAt.getTime() < now.getTime() : true,
      calendarType: cacheDirect?.calendarType || "unknown",
      calendarUrl: cacheDirect?.calendarUrl || "",
      lastError: cacheDirect?.lastError ?? (cacheDirect ? null : "Availability cache not found"),
    },
  ];

  return {
    fromUtcIso: now.toISOString(),
    toUtcIso: windowEnd.toISOString(),
    windowDays,
    bookedSlots,
    availableSlots,
    totalSlots,
    bookedPct,
    breakdown,
    unattributedBookedSlots,
    cacheMeta,
  };
}

// Exported for unit tests (no DB required).
export const __testing = {
  filterSlotsInWindow,
  computePct,
};
