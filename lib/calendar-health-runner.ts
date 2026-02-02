import "server-only";

import { prisma } from "@/lib/prisma";
import {
  detectCalendarType,
  fetchCalendlyAvailabilityWithMeta,
  fetchGHLAvailabilityWithMeta,
  fetchHubSpotAvailability,
  type CalendarType,
} from "@/lib/calendar-availability";
import { countSlotsInWorkspaceWindow, type CalendarHealthCountResult } from "@/lib/calendar-health";

function parsePositiveInt(value: string | undefined): number | null {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeCalendarUrl(input: string): string {
  const trimmed = (input || "").trim();
  if (!trimmed) return "";

  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return trimmed;
}

function safeTimeZone(timeZone: string | null | undefined, fallback: string): string {
  const tz = (timeZone || "").trim();
  if (!tz) return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return fallback;
  }
}

export type CalendarHealthLinkResult = {
  calendarLinkId: string;
  calendarLinkName: string | null;
  calendarLinkUrl: string;
  calendarType: CalendarType;
  counted: CalendarHealthCountResult;
  flagged: boolean;
  threshold: number;
  error: string | null;
};

export type CalendarHealthWorkspaceResult = {
  clientId: string;
  clientName: string;
  timeZone: string;
  workStartTime: string;
  workEndTime: string;
  threshold: number;
  calendarLinks: CalendarHealthLinkResult[];
  slack: {
    slackAlertsEnabled: boolean;
    slackBotTokenPresent: boolean;
    channelIds: string[];
  };
};

type CalendarHealthWorkspaceInternal = CalendarHealthWorkspaceResult & {
  __enabled: boolean;
  __links: Array<{ id: string; name: string | null; url: string; type: unknown }>;
};

export async function runCalendarHealthChecks(opts?: {
  clientId?: string | null;
  now?: Date;
  windowDays?: number;
  weekdaysOnly?: boolean;
  concurrency?: number;
  timeBudgetMs?: number;
}): Promise<{
  workspaces: CalendarHealthWorkspaceResult[];
  checkedWorkspaces: number;
  checkedCalendarLinks: number;
  flaggedCalendarLinks: number;
  errors: string[];
  finishedWithinBudget: boolean;
}> {
  const startedAtMs = Date.now();
  const now = opts?.now ?? new Date();
  const windowDays = Math.max(1, Math.min(28, Math.floor(opts?.windowDays ?? 7)));
  const weekdaysOnly = opts?.weekdaysOnly ?? true;
  const concurrency = Math.max(1, Math.min(12, opts?.concurrency ?? parsePositiveInt(process.env.CALENDAR_HEALTH_CONCURRENCY) ?? 4));
  const timeBudgetMs = Math.max(
    10_000,
    Math.min(10 * 60_000, opts?.timeBudgetMs ?? parsePositiveInt(process.env.CALENDAR_HEALTH_TIME_BUDGET_MS) ?? 55_000)
  );
  const deadlineMs = startedAtMs + timeBudgetMs;

  const clients = await prisma.client.findMany({
    ...(opts?.clientId ? { where: { id: opts.clientId } } : {}),
    select: {
      id: true,
      name: true,
      slackBotToken: true,
      settings: {
        select: {
          timezone: true,
          workStartTime: true,
          workEndTime: true,
          slackAlerts: true,
          notificationSlackChannelIds: true,
          calendarHealthEnabled: true,
          calendarHealthMinSlots: true,
        },
      },
      calendarLinks: {
        select: {
          id: true,
          name: true,
          url: true,
          type: true,
          isDefault: true,
        },
      },
    },
  });

  const errors: string[] = [];

  const workspaces: CalendarHealthWorkspaceInternal[] = clients
    .map((client) => {
      const settings = client.settings;
      const enabled = settings?.calendarHealthEnabled !== false;
      const threshold = typeof settings?.calendarHealthMinSlots === "number" ? settings.calendarHealthMinSlots : 10;

      const timeZone = safeTimeZone(settings?.timezone ?? null, "America/New_York");
      const workStartTime = (settings?.workStartTime || "09:00").trim() || "09:00";
      const workEndTime = (settings?.workEndTime || "17:00").trim() || "17:00";

      const channelIds = Array.isArray(settings?.notificationSlackChannelIds)
        ? settings!.notificationSlackChannelIds.map((c) => (c || "").trim()).filter(Boolean)
        : [];

      const eligibleLinks = (client.calendarLinks || [])
        .map((l) => ({
          ...l,
          url: normalizeCalendarUrl(l.url),
        }))
        .filter((l) => Boolean(l.url));

      return {
        clientId: client.id,
        clientName: client.name,
        timeZone,
        workStartTime,
        workEndTime,
        threshold,
        calendarLinks: [],
        slack: {
          slackAlertsEnabled: settings?.slackAlerts !== false,
          slackBotTokenPresent: Boolean((client.slackBotToken || "").trim()),
          channelIds,
        },
        __enabled: enabled,
        __links: eligibleLinks,
      } satisfies CalendarHealthWorkspaceInternal;
    })
    .filter((w) => w.__enabled)
    .filter((w) => w.__links.length > 0);

  type Task = {
    workspace: CalendarHealthWorkspaceInternal;
    link: CalendarHealthWorkspaceInternal["__links"][number];
  };

  const tasks: Task[] = [];
  for (const workspace of workspaces) {
    for (const link of workspace.__links) {
      tasks.push({ workspace, link });
    }
  }

  let checkedCalendarLinks = 0;
  let flaggedCalendarLinks = 0;
  let timedOut = false;

  const fetchForLink = async (url: string, calendarType: CalendarType): Promise<{ slotsUtcIso: string[]; error: string | null }> => {
    try {
      if (calendarType === "calendly") {
        const calendly = await fetchCalendlyAvailabilityWithMeta(url, windowDays);
        const slotsUtcIso = calendly.slots
          .map((s) => s.startTime.toISOString())
          .filter(Boolean)
          .sort();
        return { slotsUtcIso, error: null };
      }

      if (calendarType === "hubspot") {
        const slots = await fetchHubSpotAvailability(url, windowDays);
        const slotsUtcIso = slots
          .map((s) => s.startTime.toISOString())
          .filter(Boolean)
          .sort();
        return { slotsUtcIso, error: null };
      }

      if (calendarType === "ghl") {
        const ghl = await fetchGHLAvailabilityWithMeta(url, windowDays);
        const slotsUtcIso = ghl.slots
          .map((s) => s.startTime.toISOString())
          .filter(Boolean)
          .sort();
        return { slotsUtcIso, error: ghl.error || null };
      }

      return { slotsUtcIso: [], error: "Unsupported calendar link type" };
    } catch (error) {
      return { slotsUtcIso: [], error: error instanceof Error ? error.message : "Unknown error" };
    }
  };

  const runPool = async (items: Task[], limit: number): Promise<void> => {
    let idx = 0;

    const workers = Array.from({ length: Math.max(1, limit) }, async () => {
      while (idx < items.length) {
        const next = items[idx];
        idx += 1;

        if (Date.now() > deadlineMs) {
          timedOut = true;
          break;
        }

        const url = next.link.url;
        const detected = detectCalendarType(url);
        const stored =
          typeof next.link.type === "string" && (next.link.type === "calendly" || next.link.type === "hubspot" || next.link.type === "ghl")
            ? (next.link.type as CalendarType)
            : "unknown";
        const calendarType: CalendarType = stored === "unknown" ? detected : stored;

        const fetched = await fetchForLink(url, calendarType);
        checkedCalendarLinks += 1;

        const counted = countSlotsInWorkspaceWindow({
          slotsUtcIso: fetched.slotsUtcIso,
          timeZone: next.workspace.timeZone,
          windowDays,
          workStartTime: next.workspace.workStartTime,
          workEndTime: next.workspace.workEndTime,
          weekdaysOnly,
          now,
        });

        const threshold = next.workspace.threshold;
        const flagged = counted.total < threshold;
        if (flagged) flaggedCalendarLinks += 1;

        next.workspace.calendarLinks.push({
          calendarLinkId: next.link.id,
          calendarLinkName: next.link.name || null,
          calendarLinkUrl: url,
          calendarType,
          counted,
          flagged,
          threshold,
          error: fetched.error,
        });

        if (fetched.error) {
          errors.push(`[CalendarHealth] ${next.workspace.clientId}/${next.link.id}: ${fetched.error}`);
        }
      }
    });

    await Promise.all(workers);
  };

  await runPool(tasks, concurrency);

  // Drop internal fields
  const finalized: CalendarHealthWorkspaceResult[] = workspaces.map(({ __enabled: _enabled, __links: _links, ...rest }) => rest);

  return {
    workspaces: finalized,
    checkedWorkspaces: finalized.length,
    checkedCalendarLinks,
    flaggedCalendarLinks,
    errors,
    finishedWithinBudget: !timedOut,
  };
}
