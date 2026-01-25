import "server-only";

import { prisma, isPrismaUniqueConstraintError } from "@/lib/prisma";
import { slackPostMessage } from "@/lib/slack-bot";
import { sendResendEmail } from "@/lib/resend-email";
import { getPublicAppUrl } from "@/lib/app-url";

export type NotificationDestination = "slack" | "email" | "sms";
export type NotificationMode = "off" | "realtime" | "daily";

export type NotificationRule = {
  mode: NotificationMode;
  destinations: Partial<Record<NotificationDestination, boolean>>;
};

export type NotificationSentimentRules = Record<string, NotificationRule>;

function getRealtimeDedupeTtlMs(): number {
  const parsed = Number.parseInt(process.env.NOTIFICATION_REALTIME_DEDUPE_TTL_MS || "3600000", 10);
  if (!Number.isFinite(parsed)) return 60 * 60 * 1000;
  return Math.max(5 * 60 * 1000, Math.min(24 * 60 * 60 * 1000, parsed));
}

function normalizeRules(raw: unknown): NotificationSentimentRules {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const out: NotificationSentimentRules = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;

    const modeRaw = (value as any).mode;
    const mode: NotificationMode =
      modeRaw === "realtime" || modeRaw === "daily" || modeRaw === "off" ? modeRaw : "off";

    const destinationsRaw = (value as any).destinations;
    const destinations: Partial<Record<NotificationDestination, boolean>> = {};
    if (destinationsRaw && typeof destinationsRaw === "object" && !Array.isArray(destinationsRaw)) {
      for (const dest of ["slack", "email", "sms"] as const) {
        if (typeof (destinationsRaw as any)[dest] === "boolean") destinations[dest] = (destinationsRaw as any)[dest];
      }
    }

    out[key] = { mode, destinations };
  }

  return out;
}

function formatLeadName(lead: { firstName: string | null; lastName: string | null; email: string | null }): string {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (lead.email) return lead.email;
  return "Lead";
}

function buildLeadUrl(leadId: string): string {
  const base = getPublicAppUrl();
  return `${base}/?view=inbox&leadId=${encodeURIComponent(leadId)}`;
}

function getNotificationWindowKey(nowMs: number, ttlMs: number): string {
  const window = Math.floor(nowMs / ttlMs);
  return String(window);
}

async function logNotificationSendOnce(opts: {
  clientId: string;
  leadId?: string | null;
  kind: string;
  sentimentTag?: string | null;
  destination: NotificationDestination;
  dedupeKey: string;
}): Promise<{ ok: true } | { ok: false; reason: "duplicate" | "error"; error?: string }> {
  try {
    await prisma.notificationSendLog.create({
      data: {
        clientId: opts.clientId,
        ...(opts.leadId ? { leadId: opts.leadId } : {}),
        kind: opts.kind,
        ...(opts.sentimentTag ? { sentimentTag: opts.sentimentTag } : {}),
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

export async function recordSentimentNotificationEvent(opts: {
  clientId: string;
  leadId: string;
  sentimentTag: string;
  messageId?: string | null;
}): Promise<void> {
  const dedupeKey = `sentiment:${opts.leadId}:${opts.messageId || "none"}:${opts.sentimentTag}`;
  try {
    await prisma.notificationEvent.create({
      data: {
        clientId: opts.clientId,
        leadId: opts.leadId,
        kind: "sentiment",
        sentimentTag: opts.sentimentTag,
        messageId: opts.messageId ?? null,
        dedupeKey,
      },
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) return;
    console.error("[NotificationEvent] Failed to record sentiment event:", error);
  }
}

export async function notifyOnLeadSentimentChange(opts: {
  clientId: string;
  leadId: string;
  previousSentimentTag: string | null;
  newSentimentTag: string | null;
  messageId?: string | null;
  latestInboundText?: string | null;
}): Promise<void> {
  const next = opts.newSentimentTag;
  if (!next) return;
  if (next === opts.previousSentimentTag) return;

  await recordSentimentNotificationEvent({
    clientId: opts.clientId,
    leadId: opts.leadId,
    sentimentTag: next,
    messageId: opts.messageId ?? null,
  });

  const [client, lead, settings] = await Promise.all([
    prisma.client.findUnique({
      where: { id: opts.clientId },
      select: { id: true, name: true, slackBotToken: true, resendApiKey: true, resendFromEmail: true },
    }),
    prisma.lead.findUnique({
      where: { id: opts.leadId },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    }),
    prisma.workspaceSettings.findUnique({
      where: { clientId: opts.clientId },
      select: {
        slackAlerts: true,
        emailDigest: true,
        notificationEmails: true,
        notificationPhones: true,
        notificationSlackChannelIds: true,
        notificationSentimentRules: true,
      },
    }),
  ]);

  if (!client || !lead || !settings) return;

  const rules = normalizeRules(settings.notificationSentimentRules);
  const rule = rules[next] ?? { mode: "off", destinations: {} };
  if (rule.mode !== "realtime") return;

  const dedupeTtlMs = getRealtimeDedupeTtlMs();
  const nowMs = Date.now();
  const windowKey = getNotificationWindowKey(nowMs, dedupeTtlMs);
  const leadUrl = buildLeadUrl(lead.id);
  const leadName = formatLeadName({ firstName: lead.firstName, lastName: lead.lastName, email: lead.email });
  const snippet = (opts.latestInboundText || "").trim();
  const snippetShort = snippet.length > 240 ? `${snippet.slice(0, 240)}…` : snippet;

  const messageText = [
    `Lead: ${leadName}`,
    `Sentiment: ${next}`,
    lead.phone ? `Phone: ${lead.phone}` : null,
    snippetShort ? `Latest: ${snippetShort}` : null,
    `Link: ${leadUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  if (rule.destinations.slack) {
    if (settings.slackAlerts === false) {
      // Global Slack master switch disabled.
    } else if (!client.slackBotToken || settings.notificationSlackChannelIds.length === 0) {
      // Slack not configured.
    } else {
      for (const channelId of settings.notificationSlackChannelIds) {
        const trimmed = (channelId || "").trim();
        if (!trimmed) continue;

        const dedupeKey = `sentiment_realtime:${client.id}:${lead.id}:${next}:slack:${trimmed}:${windowKey}`;
        const gate = await logNotificationSendOnce({
          clientId: client.id,
          leadId: lead.id,
          kind: "sentiment_realtime",
          sentimentTag: next,
          destination: "slack",
          dedupeKey,
        });
        if (!gate.ok) continue;

        const sent = await slackPostMessage({
          token: client.slackBotToken,
          channelId: trimmed,
          text: messageText,
        });

        if (!sent.success) {
          console.error("[NotificationCenter] Slack post failed:", sent.error);
        }
      }
    }
  }

  if (rule.destinations.email) {
    const recipients = settings.notificationEmails.map((v) => v.trim()).filter(Boolean);
    if (recipients.length === 0) {
      // No recipients.
    } else if (!client.resendApiKey || !client.resendFromEmail) {
      // Resend not configured for this workspace.
    } else {
      const dedupeKey = `sentiment_realtime:${client.id}:${lead.id}:${next}:email:${windowKey}`;
      const gate = await logNotificationSendOnce({
        clientId: client.id,
        leadId: lead.id,
        kind: "sentiment_realtime",
        sentimentTag: next,
        destination: "email",
        dedupeKey,
      });

      if (gate.ok) {
        const emailResult = await sendResendEmail({
          apiKey: client.resendApiKey,
          fromEmail: client.resendFromEmail,
          to: recipients,
          subject: `[${client.name}] ${next}: ${leadName}`,
          text: messageText,
        });

        if (!emailResult.success) {
          console.error("[NotificationCenter] Email send failed:", emailResult.error);
        }
      }
    }
  }

  // SMS destination is intentionally a no-op placeholder for now.
}

function getTimeZoneParts(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number.parseInt(byType.year, 10),
    month: Number.parseInt(byType.month, 10),
    day: Number.parseInt(byType.day, 10),
    hour: Number.parseInt(byType.hour, 10),
    minute: Number.parseInt(byType.minute, 10),
  };
}

function getTimeZonePartsWithSeconds(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number.parseInt(byType.year, 10),
    month: Number.parseInt(byType.month, 10),
    day: Number.parseInt(byType.day, 10),
    hour: Number.parseInt(byType.hour, 10),
    minute: Number.parseInt(byType.minute, 10),
    second: Number.parseInt(byType.second, 10),
  };
}

function getTimeZoneOffsetMs(timeZone: string, date: Date): number {
  const parts = getTimeZonePartsWithSeconds(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    date.getUTCMilliseconds()
  );
  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(opts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  timeZone: string;
}): Date {
  const naiveUtc = Date.UTC(opts.year, opts.month - 1, opts.day, opts.hour, opts.minute, opts.second, opts.millisecond);
  let guess = naiveUtc;
  for (let i = 0; i < 4; i += 1) {
    const offset = getTimeZoneOffsetMs(opts.timeZone, new Date(guess));
    const next = naiveUtc - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

function startOfLocalDayUtc(now: Date, timeZone: string): Date {
  const parts = getTimeZoneParts(now, timeZone);
  return zonedDateTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
    timeZone,
  });
}

function parseTimeOfDay(value: string | null | undefined): { hour: number; minute: number } | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number.parseInt(match[1]!, 10);
  const minute = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function toIsoDateKey(opts: { year: number; month: number; day: number }): string {
  const mm = String(opts.month).padStart(2, "0");
  const dd = String(opts.day).padStart(2, "0");
  return `${opts.year}-${mm}-${dd}`;
}

function chunkLines(lines: string[], maxChars: number): string[] {
  const limit = Math.max(200, maxChars);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const line of lines) {
    const nextLen = (current.length > 0 ? 1 : 0) + line.length;
    if (current.length > 0 && currentLen + nextLen > limit) {
      chunks.push(current.join("\n"));
      current = [line];
      currentLen = line.length;
      continue;
    }
    current.push(line);
    currentLen += nextLen;
  }

  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}

export async function processDailyNotificationDigestsDue(opts?: { limit?: number }): Promise<{
  checked: number;
  sent: number;
  skipped: number;
  errors: number;
}> {
  const limit = Math.max(1, Math.min(200, opts?.limit ?? 50));
  const settingsRows = await prisma.workspaceSettings.findMany({
    take: limit,
    select: {
      clientId: true,
      timezone: true,
      emailDigest: true,
      slackAlerts: true,
      notificationEmails: true,
      notificationSlackChannelIds: true,
      notificationSentimentRules: true,
      notificationDailyDigestTime: true,
      client: { select: { name: true, slackBotToken: true, resendApiKey: true, resendFromEmail: true } },
    },
  });

  let checked = 0;
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of settingsRows) {
    checked += 1;

    if (!row.emailDigest) {
      skipped += 1;
      continue;
    }

    const tz = row.timezone || "America/New_York";
    const now = new Date();
    const nowParts = getTimeZoneParts(now, tz);
    const digestAt = parseTimeOfDay(row.notificationDailyDigestTime) ?? { hour: 9, minute: 0 };

    const windowMinutes = 12;
    const nowMinutes = nowParts.hour * 60 + nowParts.minute;
    const digestMinutes = digestAt.hour * 60 + digestAt.minute;
    if (Math.abs(nowMinutes - digestMinutes) > windowMinutes) {
      skipped += 1;
      continue;
    }

    const localDayKey = toIsoDateKey({ year: nowParts.year, month: nowParts.month, day: nowParts.day });
    const rules = normalizeRules(row.notificationSentimentRules);

    const dailyByDest: Record<NotificationDestination, string[]> = {
      slack: [],
      email: [],
      sms: [],
    };

    for (const [sentiment, rule] of Object.entries(rules)) {
      if (!rule || rule.mode !== "daily") continue;
      for (const dest of ["slack", "email", "sms"] as const) {
        if (rule.destinations[dest]) dailyByDest[dest].push(sentiment);
      }
    }

    // Nothing to do.
    if (dailyByDest.slack.length === 0 && dailyByDest.email.length === 0 && dailyByDest.sms.length === 0) {
      skipped += 1;
      continue;
    }

    const since = startOfLocalDayUtc(now, tz);
    const events = await prisma.notificationEvent.findMany({
      where: {
        clientId: row.clientId,
        kind: "sentiment",
        createdAt: { gte: since },
      },
      select: { sentimentTag: true, leadId: true },
    });

    const countsByTag = new Map<string, Set<string>>();
    for (const event of events) {
      const tag = typeof event.sentimentTag === "string" && event.sentimentTag.trim() ? event.sentimentTag.trim() : null;
      if (!tag) continue;
      const set = countsByTag.get(tag) ?? new Set<string>();
      set.add(event.leadId);
      countsByTag.set(tag, set);
    }

    const allLeadIds = Array.from(new Set(events.map((e) => e.leadId)));
    const leads = allLeadIds.length
      ? await prisma.lead.findMany({
          where: { id: { in: allLeadIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const leadNameById = new Map<string, string>();
    for (const lead of leads) {
      leadNameById.set(lead.id, formatLeadName(lead));
    }

    const buildDigestBodyLines = (sentiments: string[]) => {
      const unique = Array.from(new Set(sentiments)).sort((a, b) => a.localeCompare(b));
      const lines: string[] = [];

      for (const tag of unique) {
        const leadIds = countsByTag.get(tag) ?? new Set<string>();
        lines.push(`${tag} (${leadIds.size})`);

        const leadEntries = Array.from(leadIds).map((leadId) => ({
          id: leadId,
          name: leadNameById.get(leadId) ?? leadId,
        }));
        leadEntries.sort((a, b) => a.name.localeCompare(b.name));

        for (const lead of leadEntries) {
          lines.push(`- ${lead.name} — ${buildLeadUrl(lead.id)}`);
        }

        lines.push("");
      }

      // Trim trailing blank lines.
      while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      return lines;
    };

    const buildHeaderLines = () => [
      `Daily Notification Digest (${localDayKey})`,
      `Workspace: ${row.client.name}`,
      `Timezone: ${tz}`,
    ];

    // Slack digest
    if (dailyByDest.slack.length > 0 && row.slackAlerts !== false && row.client.slackBotToken && row.notificationSlackChannelIds.length > 0) {
      const headerLines = buildHeaderLines();
      const bodyLines = buildDigestBodyLines(dailyByDest.slack);

      // Slack message limits are relatively small; chunk so we never drop leads.
      const maxSlackChars = 3500;
      const headerOverhead = headerLines.join("\n").length + 2 + 20; // + part line + spacing
      const bodyChunks = chunkLines(bodyLines, Math.max(800, maxSlackChars - headerOverhead));
      const totalParts = bodyChunks.length;

      for (let part = 0; part < totalParts; part += 1) {
        const dedupeKey = `daily_digest:${row.clientId}:slack:${localDayKey}:${part + 1}`;
        const gate = await logNotificationSendOnce({
          clientId: row.clientId,
          kind: "daily_digest",
          destination: "slack",
          dedupeKey,
        });
        if (!gate.ok) continue;

        const text = [
          ...headerLines,
          ...(totalParts > 1 ? [`Part ${part + 1}/${totalParts}`] : []),
          "",
          bodyChunks[part] || "(no events)",
        ].join("\n");

        for (const channelId of row.notificationSlackChannelIds) {
          const trimmed = (channelId || "").trim();
          if (!trimmed) continue;
          const res = await slackPostMessage({ token: row.client.slackBotToken, channelId: trimmed, text });
          if (!res.success) {
            errors += 1;
            console.error("[NotificationCenter] Slack digest failed:", res.error);
          }
        }

        sent += 1;
      }
    }

    // Email digest
    if (dailyByDest.email.length > 0) {
      const recipients = row.notificationEmails.map((v) => v.trim()).filter(Boolean);
      if (recipients.length > 0 && row.client.resendApiKey && row.client.resendFromEmail) {
        const dedupeKey = `daily_digest:${row.clientId}:email:${localDayKey}`;
        const gate = await logNotificationSendOnce({
          clientId: row.clientId,
          kind: "daily_digest",
          destination: "email",
          dedupeKey,
        });

        if (gate.ok) {
          const headerLines = buildHeaderLines();
          const bodyLines = buildDigestBodyLines(dailyByDest.email);
          const text = [...headerLines, "", ...bodyLines].join("\n");
          const emailResult = await sendResendEmail({
            apiKey: row.client.resendApiKey,
            fromEmail: row.client.resendFromEmail,
            to: recipients,
            subject: `[${row.client.name}] Daily Digest (${localDayKey})`,
            text,
          });

          if (!emailResult.success) {
            errors += 1;
            console.error("[NotificationCenter] Email digest failed:", emailResult.error);
          } else {
            sent += 1;
          }
        }
      }
    }

    // SMS digest is intentionally a no-op placeholder for now.
  }

  return { checked, sent, skipped, errors };
}

export async function processRealtimeNotificationEventsDue(opts?: { limit?: number; sinceMinutes?: number }): Promise<{
  checked: number;
  attempted: number;
  errors: number;
}> {
  const limit = Math.max(1, Math.min(200, opts?.limit ?? 50));
  const sinceMinutes = Math.max(1, Math.min(180, opts?.sinceMinutes ?? 20));
  const since = new Date(Date.now() - sinceMinutes * 60 * 1000);

  const events = await prisma.notificationEvent.findMany({
    where: {
      kind: "sentiment",
      createdAt: { gte: since },
      sentimentTag: { not: null },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      clientId: true,
      leadId: true,
      sentimentTag: true,
      messageId: true,
    },
  });

  let attempted = 0;
  let errors = 0;

  for (const event of events) {
    const sentimentTag = (event.sentimentTag || "").trim();
    if (!sentimentTag) continue;

    let latestInboundText: string | null = null;
    if (event.messageId) {
      const msg = await prisma.message.findUnique({
        where: { id: event.messageId },
        select: { body: true, rawText: true },
      });
      latestInboundText = msg?.rawText || msg?.body || null;
    }

    attempted += 1;
    try {
      await notifyOnLeadSentimentChange({
        clientId: event.clientId,
        leadId: event.leadId,
        previousSentimentTag: null,
        newSentimentTag: sentimentTag,
        messageId: event.messageId,
        latestInboundText,
      });
    } catch (error) {
      errors += 1;
      console.error("[NotificationCenter] Realtime dispatch failed:", error);
    }
  }

  return { checked: events.length, attempted, errors };
}
