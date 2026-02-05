import "server-only";

import { prisma } from "@/lib/prisma";
import { isMeetingBooked } from "@/lib/meeting-booking-provider";
import type { AIDraftResponseDisposition, MeetingBookingProvider } from "@prisma/client";

export type MessagePerformanceOutcome = "BOOKED" | "NOT_BOOKED" | "PENDING" | "BOOKED_NO_TIMESTAMP";
export type MessagePerformanceAttribution = "cross_channel" | "within_channel";
export type MessagePerformanceSender = "ai" | "setter" | "unknown";

export type MessagePerformanceRow = {
  leadId: string;
  messageId: string;
  messageSentAt: Date;
  channel: "sms" | "email" | "linkedin";
  sentBy: MessagePerformanceSender;
  responseDisposition: AIDraftResponseDisposition | null;
  outcome: MessagePerformanceOutcome;
  attributionType: MessagePerformanceAttribution;
  bookedAt: Date | null;
};

export type MessagePerformanceMetricsSlice = {
  totals: {
    leads: number;
    rows: number;
    booked: number;
    notBooked: number;
    pending: number;
    bookedNoTimestamp: number;
  };
  bySender: Record<MessagePerformanceSender, { booked: number; notBooked: number; pending: number }>;
  byChannel: Record<string, { booked: number; notBooked: number; pending: number }>;
  bookingRateBySender: Record<MessagePerformanceSender, number | null>;
};

export type MessagePerformanceMetrics = {
  crossChannel: MessagePerformanceMetricsSlice;
  withinChannel: MessagePerformanceMetricsSlice;
};

export type MessagePerformanceRunResult = {
  rows: MessagePerformanceRow[];
  metrics: MessagePerformanceMetrics;
  stats: {
    totalLeads: number;
    totalMessages: number;
    droppedLeadsNoOutbound: number;
    bookedWithoutTimestamp: number;
    truncatedLeads: boolean;
    truncatedMessages: boolean;
    windowFrom: Date;
    windowTo: Date;
    attributionWindowDays: number;
    maturityBufferDays: number;
    maxLeads: number;
    maxMessages: number;
  };
};

const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 14;
const DEFAULT_MATURITY_BUFFER_DAYS = 7;
const DEFAULT_MAX_LEADS = 2000;
const DEFAULT_MAX_MESSAGES = 20000;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function resolvePositiveInt(value: number | undefined | null, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  return fallback;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function subDays(date: Date, days: number): Date {
  return addDays(date, -Math.abs(days));
}

function resolveSenderType(message: { sentBy: string | null; aiDraftId: string | null }): MessagePerformanceSender {
  if (message.sentBy === "ai") return "ai";
  if (message.sentBy === "setter") return "setter";
  if (message.aiDraftId) return "ai";
  return "setter";
}

function coerceChannel(value: string | null | undefined): "sms" | "email" | "linkedin" {
  if (value === "email" || value === "linkedin") return value;
  return "sms";
}

export async function buildMessagePerformanceDataset(opts: {
  clientId: string;
  windowFrom: Date;
  windowTo: Date;
  attributionWindowDays?: number;
  maturityBufferDays?: number;
  maxLeads?: number;
  maxMessages?: number;
}): Promise<MessagePerformanceRunResult> {
  const attributionWindowDays =
    typeof opts.attributionWindowDays === "number" && Number.isFinite(opts.attributionWindowDays)
      ? Math.max(1, Math.trunc(opts.attributionWindowDays))
      : DEFAULT_ATTRIBUTION_WINDOW_DAYS;
  const maturityBufferDays =
    typeof opts.maturityBufferDays === "number" && Number.isFinite(opts.maturityBufferDays)
      ? Math.max(0, Math.trunc(opts.maturityBufferDays))
      : DEFAULT_MATURITY_BUFFER_DAYS;
  const maxLeads = resolvePositiveInt(
    opts.maxLeads,
    parsePositiveIntEnv("MESSAGE_PERFORMANCE_MAX_LEADS", DEFAULT_MAX_LEADS)
  );
  const maxMessages = resolvePositiveInt(
    opts.maxMessages,
    parsePositiveIntEnv("MESSAGE_PERFORMANCE_MAX_MESSAGES", DEFAULT_MAX_MESSAGES)
  );

  const settings = await prisma.workspaceSettings.findUnique({
    where: { clientId: opts.clientId },
    select: { meetingBookingProvider: true },
  });
  const meetingBookingProvider = (settings?.meetingBookingProvider || "GHL") as MeetingBookingProvider;

  const leadCandidates = await prisma.lead.findMany({
    where: {
      clientId: opts.clientId,
      OR: [
        { lastOutboundAt: { gte: opts.windowFrom, lte: opts.windowTo } },
        { appointmentBookedAt: { gte: opts.windowFrom, lte: opts.windowTo } },
      ],
    },
    select: {
      id: true,
      appointmentBookedAt: true,
      appointmentStatus: true,
      ghlAppointmentId: true,
      calendlyInviteeUri: true,
      calendlyScheduledEventUri: true,
      lastOutboundAt: true,
    },
    orderBy: { lastOutboundAt: "desc" },
    take: maxLeads + 1,
  });

  const truncatedLeads = leadCandidates.length > maxLeads;
  const leads = truncatedLeads ? leadCandidates.slice(0, maxLeads) : leadCandidates;
  const leadIds = leads.map((lead) => lead.id);

  const messageWindowStart = subDays(opts.windowFrom, attributionWindowDays);
  const messages = await prisma.message.findMany({
    where: {
      leadId: { in: leadIds },
      lead: { clientId: opts.clientId },
      direction: "outbound",
      sentAt: { gte: messageWindowStart, lte: opts.windowTo },
    },
    select: {
      id: true,
      leadId: true,
      sentAt: true,
      channel: true,
      sentBy: true,
      aiDraftId: true,
    },
    orderBy: { sentAt: "asc" },
    take: maxMessages,
  });
  const truncatedMessages = messages.length >= maxMessages;

  const aiDraftIds = Array.from(new Set(messages.map((m) => m.aiDraftId).filter(Boolean))) as string[];
  const aiDrafts = aiDraftIds.length
    ? await prisma.aIDraft.findMany({
        where: { id: { in: aiDraftIds } },
        select: { id: true, responseDisposition: true },
      })
    : [];
  const aiDraftMap = new Map(aiDrafts.map((draft) => [draft.id, draft.responseDisposition]));

  const messagesByLead = new Map<string, typeof messages>();
  for (const message of messages) {
    const bucket = messagesByLead.get(message.leadId) ?? [];
    bucket.push(message);
    messagesByLead.set(message.leadId, bucket);
  }

  const rows: MessagePerformanceRow[] = [];
  let droppedLeadsNoOutbound = 0;
  let bookedWithoutTimestamp = 0;

  for (const lead of leads) {
    const leadMessages = messagesByLead.get(lead.id) ?? [];
    if (leadMessages.length === 0) {
      droppedLeadsNoOutbound += 1;
      continue;
    }

    const booked = isMeetingBooked(
      {
        appointmentStatus: lead.appointmentStatus,
        ghlAppointmentId: lead.ghlAppointmentId,
        calendlyInviteeUri: lead.calendlyInviteeUri,
        calendlyScheduledEventUri: lead.calendlyScheduledEventUri,
      },
      { meetingBookingProvider }
    );

    const bookedAt = lead.appointmentBookedAt;
    if (booked && !bookedAt) {
      bookedWithoutTimestamp += 1;
    }

    const lastOutboundAt = leadMessages[leadMessages.length - 1]?.sentAt ?? lead.lastOutboundAt ?? null;

    if (!booked) {
      if (!lastOutboundAt) {
        droppedLeadsNoOutbound += 1;
        continue;
      }

      const pendingThreshold = subDays(opts.windowTo, maturityBufferDays);
      const outcome: MessagePerformanceOutcome =
        lastOutboundAt >= pendingThreshold ? "PENDING" : "NOT_BOOKED";

      const lastMessage = leadMessages[leadMessages.length - 1];
      if (!lastMessage) continue;

      const sentBy = resolveSenderType(lastMessage);
      const channel = coerceChannel(lastMessage.channel);
      const responseDisposition = lastMessage.aiDraftId ? aiDraftMap.get(lastMessage.aiDraftId) ?? null : null;

      rows.push({
        leadId: lead.id,
        messageId: lastMessage.id,
        messageSentAt: lastMessage.sentAt,
        channel,
        sentBy,
        responseDisposition,
        outcome,
        attributionType: "cross_channel",
        bookedAt: null,
      });

      const lastByChannel = new Map<string, typeof lastMessage>();
      for (const message of leadMessages) {
        lastByChannel.set(coerceChannel(message.channel), message);
      }
      for (const [channelKey, message] of lastByChannel.entries()) {
        const sender = resolveSenderType(message);
        const disposition = message.aiDraftId ? aiDraftMap.get(message.aiDraftId) ?? null : null;
        rows.push({
          leadId: lead.id,
          messageId: message.id,
          messageSentAt: message.sentAt,
          channel: coerceChannel(channelKey),
          sentBy: sender,
          responseDisposition: disposition,
          outcome,
          attributionType: "within_channel",
          bookedAt: null,
        });
      }

      continue;
    }

    const lastMessage = leadMessages[leadMessages.length - 1];
    const lastDisposition = lastMessage.aiDraftId ? aiDraftMap.get(lastMessage.aiDraftId) ?? null : null;

    if (!bookedAt) {
      rows.push({
        leadId: lead.id,
        messageId: lastMessage.id,
        messageSentAt: lastMessage.sentAt,
        channel: coerceChannel(lastMessage.channel),
        sentBy: resolveSenderType(lastMessage),
        responseDisposition: lastDisposition,
        outcome: "BOOKED_NO_TIMESTAMP",
        attributionType: "cross_channel",
        bookedAt: null,
      });
      continue;
    }

    const attributionWindowStart = subDays(bookedAt, attributionWindowDays);
    const eligible = leadMessages.filter(
      (m) => m.sentAt <= bookedAt && m.sentAt >= attributionWindowStart
    );

    if (eligible.length === 0) {
      rows.push({
        leadId: lead.id,
        messageId: lastMessage.id,
        messageSentAt: lastMessage.sentAt,
        channel: coerceChannel(lastMessage.channel),
        sentBy: resolveSenderType(lastMessage),
        responseDisposition: lastDisposition,
        outcome: "BOOKED",
        attributionType: "cross_channel",
        bookedAt,
      });
      continue;
    }

    const crossMessage = eligible[eligible.length - 1]!;
    rows.push({
      leadId: lead.id,
      messageId: crossMessage.id,
      messageSentAt: crossMessage.sentAt,
      channel: coerceChannel(crossMessage.channel),
      sentBy: resolveSenderType(crossMessage),
      responseDisposition: crossMessage.aiDraftId ? aiDraftMap.get(crossMessage.aiDraftId) ?? null : null,
      outcome: "BOOKED",
      attributionType: "cross_channel",
      bookedAt,
    });

    const lastByChannel = new Map<string, typeof crossMessage>();
    for (const message of eligible) {
      lastByChannel.set(coerceChannel(message.channel), message);
    }
    for (const [channelKey, message] of lastByChannel.entries()) {
      rows.push({
        leadId: lead.id,
        messageId: message.id,
        messageSentAt: message.sentAt,
        channel: coerceChannel(channelKey),
        sentBy: resolveSenderType(message),
        responseDisposition: message.aiDraftId ? aiDraftMap.get(message.aiDraftId) ?? null : null,
        outcome: "BOOKED",
        attributionType: "within_channel",
        bookedAt,
      });
    }
  }

  const crossRows = rows.filter((row) => row.attributionType === "cross_channel");
  const withinRows = rows.filter((row) => row.attributionType === "within_channel");

  const metrics: MessagePerformanceMetrics = {
    crossChannel: buildMessagePerformanceMetricsForRows(crossRows, leads.length),
    withinChannel: buildMessagePerformanceMetricsForRows(withinRows, leads.length),
  };

  return {
    rows,
    metrics,
    stats: {
      totalLeads: leads.length,
      totalMessages: messages.length,
      droppedLeadsNoOutbound,
      bookedWithoutTimestamp,
      truncatedLeads,
      truncatedMessages,
      windowFrom: opts.windowFrom,
      windowTo: opts.windowTo,
      attributionWindowDays,
      maturityBufferDays,
      maxLeads,
      maxMessages,
    },
  };
}

export function buildMessagePerformanceMetricsForRows(
  rows: MessagePerformanceRow[],
  totalLeads: number
): MessagePerformanceMetricsSlice {
  const totals = {
    leads: totalLeads,
    rows: rows.length,
    booked: 0,
    notBooked: 0,
    pending: 0,
    bookedNoTimestamp: 0,
  };

  const bySender: Record<MessagePerformanceSender, { booked: number; notBooked: number; pending: number }> = {
    ai: { booked: 0, notBooked: 0, pending: 0 },
    setter: { booked: 0, notBooked: 0, pending: 0 },
    unknown: { booked: 0, notBooked: 0, pending: 0 },
  };
  const byChannel: Record<string, { booked: number; notBooked: number; pending: number }> = {};

  for (const row of rows) {
    if (row.outcome === "BOOKED") totals.booked += 1;
    if (row.outcome === "NOT_BOOKED") totals.notBooked += 1;
    if (row.outcome === "PENDING") totals.pending += 1;
    if (row.outcome === "BOOKED_NO_TIMESTAMP") totals.bookedNoTimestamp += 1;

    const senderBucket = bySender[row.sentBy] ?? bySender.unknown;
    if (row.outcome === "BOOKED") senderBucket.booked += 1;
    if (row.outcome === "NOT_BOOKED") senderBucket.notBooked += 1;
    if (row.outcome === "PENDING") senderBucket.pending += 1;

    if (!byChannel[row.channel]) {
      byChannel[row.channel] = { booked: 0, notBooked: 0, pending: 0 };
    }
    if (row.outcome === "BOOKED") byChannel[row.channel].booked += 1;
    if (row.outcome === "NOT_BOOKED") byChannel[row.channel].notBooked += 1;
    if (row.outcome === "PENDING") byChannel[row.channel].pending += 1;
  }

  const bookingRateBySender: Record<MessagePerformanceSender, number | null> = {
    ai: null,
    setter: null,
    unknown: null,
  };

  (Object.keys(bySender) as MessagePerformanceSender[]).forEach((sender) => {
    const bucket = bySender[sender];
    const denom = bucket.booked + bucket.notBooked;
    bookingRateBySender[sender] = denom > 0 ? bucket.booked / denom : null;
  });

  return { totals, bySender, byChannel, bookingRateBySender };
}
