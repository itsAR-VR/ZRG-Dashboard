import "server-only";

import { prisma, isPrismaUniqueConstraintError } from "@/lib/prisma";
import { slackPostMessage } from "@/lib/slack-bot";
import { getPublicAppUrl } from "@/lib/app-url";
import type { CalendarHealthWorkspaceResult } from "@/lib/calendar-health-runner";

function formatYmd(ymd: { year: number; month: number; day: number }): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${ymd.year}-${pad(ymd.month)}-${pad(ymd.day)}`;
}

function addDaysToYmd(ymd: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function getZonedYmdParts(date: Date, timeZone: string): { year: number; month: number; day: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = dtf.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string | undefined => parts.find((p) => p.type === type)?.value;

  const weekdayLabel = get("weekday") || "Sun";
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[weekdayLabel] ?? 0;

  const year = Number.parseInt(get("year") || "0", 10);
  const month = Number.parseInt(get("month") || "1", 10);
  const day = Number.parseInt(get("day") || "1", 10);

  return {
    year: Number.isFinite(year) ? year : 0,
    month: Number.isFinite(month) ? month : 1,
    day: Number.isFinite(day) ? day : 1,
    weekday,
  };
}

export function computeEtWeekKey(now: Date = new Date()): string {
  const et = "America/New_York";
  const parts = getZonedYmdParts(now, et);
  const sunday = addDaysToYmd({ year: parts.year, month: parts.month, day: parts.day }, -parts.weekday);
  return formatYmd(sunday);
}

async function logNotificationSendOnce(opts: {
  clientId: string;
  kind: string;
  destination: "slack";
  dedupeKey: string;
}): Promise<{ ok: true } | { ok: false; reason: "duplicate" | "error"; error?: string }> {
  try {
    await prisma.notificationSendLog.create({
      data: {
        clientId: opts.clientId,
        kind: opts.kind,
        destination: opts.destination,
        dedupeKey: opts.dedupeKey,
      },
    });
    return { ok: true };
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) return { ok: false, reason: "duplicate" };
    return { ok: false, reason: "error", error: error instanceof Error ? error.message : "Failed to log notification" };
  }
}

function formatByDate(byDate: Record<string, number>): string {
  const entries = Object.entries(byDate || {}).filter(([, count]) => typeof count === "number" && count > 0);
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) return "";

  const parts = entries.slice(0, 12).map(([date, count]) => `${date}: ${count}`);
  const suffix = entries.length > 12 ? ` …(+${entries.length - 12} more)` : "";
  return parts.join(", ") + suffix;
}

export async function sendWeeklyCalendarHealthSlackAlerts(opts: {
  workspaces: CalendarHealthWorkspaceResult[];
  weekKey?: string;
}): Promise<{
  attempted: number;
  sent: number;
  deduped: number;
  skippedNoSlack: number;
  errors: string[];
}> {
  const weekKey = (opts.weekKey || "").trim() || computeEtWeekKey(new Date());
  const baseUrl = getPublicAppUrl();

  let attempted = 0;
  let sent = 0;
  let deduped = 0;
  let skippedNoSlack = 0;
  const errors: string[] = [];

  for (const workspace of opts.workspaces) {
    const flagged = workspace.calendarLinks.filter((c) => c.flagged);
    if (flagged.length === 0) continue;

    if (!workspace.slack.slackAlertsEnabled || !workspace.slack.slackBotTokenPresent || workspace.slack.channelIds.length === 0) {
      skippedNoSlack += 1;
      continue;
    }

    const client = await prisma.client.findUnique({
      where: { id: workspace.clientId },
      select: { slackBotToken: true },
    });
    const token = (client?.slackBotToken || "").trim();
    if (!token) {
      skippedNoSlack += 1;
      continue;
    }

    for (const cal of flagged) {
      const calendarLabel = (cal.calendarLinkName || "").trim() || "Calendar link";
      const byDateText = formatByDate(cal.counted.byDate);
      const settingsUrl = `${baseUrl}/?view=settings&clientId=${encodeURIComponent(workspace.clientId)}&settingsTab=general`;

      const messageText = [
        `🚨 *Calendar low availability*`,
        `Workspace: ${workspace.clientName}`,
        `Calendar: ${calendarLabel}`,
        `URL: ${cal.calendarLinkUrl}`,
        `Window: Next 7 days (weekdays), ${workspace.workStartTime}–${workspace.workEndTime} (${workspace.timeZone})`,
        `Available slots: ${cal.counted.total} (threshold: ${cal.threshold})`,
        byDateText ? `By date: ${byDateText}` : null,
        cal.error ? `Provider note: ${cal.error}` : null,
        `Settings: ${settingsUrl}`,
      ]
        .filter(Boolean)
        .join("\n");

      for (const channelId of workspace.slack.channelIds) {
        attempted += 1;

        const dedupeKey = `calendar_health_weekly:${workspace.clientId}:${cal.calendarLinkId}:${weekKey}:slack:${channelId}`;
        const gate = await logNotificationSendOnce({
          clientId: workspace.clientId,
          kind: "calendar_health_weekly",
          destination: "slack",
          dedupeKey,
        });

        if (!gate.ok) {
          if (gate.reason === "duplicate") deduped += 1;
          else errors.push(`[CalendarHealth] Notification dedupe error: ${gate.error || "unknown"}`);
          continue;
        }

        const res = await slackPostMessage({
          token,
          channelId,
          text: messageText,
        });

        if (!res.success) {
          errors.push(`[CalendarHealth] Slack post failed (${workspace.clientId}/${channelId}): ${res.error || "unknown"}`);
          continue;
        }

        sent += 1;
      }
    }
  }

  return { attempted, sent, deduped, skippedNoSlack, errors };
}
