import "server-only";

import { prisma } from "@/lib/prisma";
import { MeetingBookingProvider, type ConversationInsightOutcome } from "@prisma/client";

export type InsightCampaignScope =
  | { mode: "workspace" }
  | { mode: "selected"; campaignIds: string[] }
  | { mode: "all"; cap: number };

export type SelectedInsightThread = {
  leadId: string;
  emailCampaignId: string | null;
  outcome: ConversationInsightOutcome;
  exampleType: "positive" | "negative";
  selectionBucket:
    | "booked"
    | "requested"
    | "high_score"
    | "requested_not_booked"
    | "high_score_not_booked"
    | "no_response";
};

type LeadForScore = {
  id: string;
  sentimentTag: string | null;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  lastMessageDirection: string | null;
};

function uniqueStrings(ids: string[]): string[] {
  return Array.from(new Set(ids.map((v) => (v || "").trim()).filter(Boolean)));
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function daysSince(date: Date | null, now: Date): number | null {
  if (!date) return null;
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function calculateLeadScore(lead: LeadForScore, inboundCount: number, now: Date): number {
  let score = 50;
  score += Math.min(Math.max(0, inboundCount) * 5, 25);

  if (lead.sentimentTag === "Meeting Requested") score += 20;
  if (lead.sentimentTag === "Interested") score += 15;
  if (lead.sentimentTag === "Information Requested") score += 10;
  if (lead.sentimentTag === "Follow Up") score += 5;

  const d = daysSince(lead.lastMessageAt, now);
  if (d !== null) {
    if (d <= 1) score += 10;
    else if (d <= 3) score += 5;
    else if (d > 7) score -= 5;
  }

  return Math.max(0, Math.min(100, score));
}

function bookedWhereForProvider(provider: MeetingBookingProvider) {
  if (provider === "CALENDLY") {
    return {
      OR: [{ calendlyInviteeUri: { not: null } }, { calendlyScheduledEventUri: { not: null } }],
    };
  }
  return { ghlAppointmentId: { not: null } };
}

async function resolveTopCampaignIds(opts: {
  clientId: string;
  from: Date;
  to: Date;
  cap: number;
  provider: MeetingBookingProvider;
}): Promise<string[]> {
  const cap = clampInt(opts.cap, 1, 50);
  const campaigns = await prisma.emailCampaign.findMany({
    where: { clientId: opts.clientId },
    select: { id: true },
    orderBy: { name: "asc" },
  });
  const allIds = campaigns.map((c) => c.id);
  if (allIds.length <= cap) return allIds;

  const bookedAgg = await prisma.lead.groupBy({
    by: ["emailCampaignId"],
    where: {
      clientId: opts.clientId,
      emailCampaignId: { in: allIds },
      appointmentBookedAt: { gte: opts.from, lt: opts.to },
      ...bookedWhereForProvider(opts.provider),
    },
    _count: { _all: true },
  });
  const byBooked = bookedAgg
    .filter((row) => Boolean(row.emailCampaignId))
    .map((row) => ({ id: row.emailCampaignId as string, count: row._count._all }))
    .sort((a, b) => b.count - a.count)
    .map((r) => r.id);

  const selected: string[] = [];
  for (const id of byBooked) {
    selected.push(id);
    if (selected.length >= cap) return selected;
  }

  const activityAgg = await prisma.lead.groupBy({
    by: ["emailCampaignId"],
    where: {
      clientId: opts.clientId,
      emailCampaignId: { in: allIds },
      lastMessageAt: { gte: opts.from, lt: opts.to },
    },
    _count: { _all: true },
  });
  const byActivity = activityAgg
    .filter((row) => Boolean(row.emailCampaignId))
    .map((row) => ({ id: row.emailCampaignId as string, count: row._count._all }))
    .sort((a, b) => b.count - a.count)
    .map((r) => r.id);

  for (const id of byActivity) {
    if (!selected.includes(id)) selected.push(id);
    if (selected.length >= cap) break;
  }

  return selected.slice(0, cap);
}

async function selectHighScoreLeads(opts: {
  clientId: string;
  from: Date;
  to: Date;
  emailCampaignId?: string | null;
  excludeLeadIds: Set<string>;
  provider: MeetingBookingProvider;
  requireStalled?: boolean;
  limit: number;
}): Promise<string[]> {
  const bookedWhere = bookedWhereForProvider(opts.provider);
  const candidates = await prisma.lead.findMany({
    where: {
      clientId: opts.clientId,
      ...(opts.emailCampaignId ? { emailCampaignId: opts.emailCampaignId } : {}),
      lastMessageAt: { gte: opts.from, lt: opts.to },
      NOT: bookedWhere,
    },
    select: {
      id: true,
      sentimentTag: true,
      lastMessageAt: true,
      lastInboundAt: true,
      lastOutboundAt: true,
      lastMessageDirection: true,
    },
    orderBy: { lastMessageAt: "desc" },
    take: 300,
  });

  const now = new Date();
  const filtered = candidates.filter((c) => !opts.excludeLeadIds.has(c.id));
  const candidateIds = filtered.map((c) => c.id);
  if (candidateIds.length === 0) return [];

  const counts = await prisma.message.groupBy({
    by: ["leadId", "direction"],
    where: {
      leadId: { in: candidateIds },
      direction: { in: ["inbound", "outbound"] },
    },
    _count: { _all: true },
  });

  const inboundCountByLead = new Map<string, number>();
  for (const row of counts) {
    if (row.direction === "inbound") inboundCountByLead.set(row.leadId, row._count._all);
  }

  const stalled = Boolean(opts.requireStalled);
  const scored = filtered
    .filter((lead) => {
      if (!stalled) return true;
      if (lead.lastMessageDirection !== "outbound") return false;
      const ageDays = daysSince(lead.lastInboundAt, now);
      if (ageDays === null) return false;
      return ageDays >= 2;
    })
    .map((lead) => ({
      id: lead.id,
      score: calculateLeadScore(lead, inboundCountByLead.get(lead.id) ?? 0, now),
    }))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, Math.max(0, opts.limit)).map((s) => s.id);
}

async function selectThreadsForCampaign(opts: {
  clientId: string;
  from: Date;
  to: Date;
  provider: MeetingBookingProvider;
  emailCampaignId?: string | null;
  targets: {
    positiveBookedRequested: number;
    positiveHighScore: number;
    negativeRequestedNotBooked: number;
    negativeHighScoreNotBooked: number;
    negativeNoResponse: number;
  };
}): Promise<SelectedInsightThread[]> {
  const bookedWhere = bookedWhereForProvider(opts.provider);
  const baseWhere = {
    clientId: opts.clientId,
    ...(opts.emailCampaignId ? { emailCampaignId: opts.emailCampaignId } : {}),
  } as const;

  const selected: SelectedInsightThread[] = [];
  const used = new Set<string>();
  const pushMany = (
    ids: string[],
    meta: Pick<SelectedInsightThread, "outcome" | "exampleType" | "selectionBucket">
  ) => {
    for (const id of ids) {
      if (used.has(id)) continue;
      used.add(id);
      selected.push({
        leadId: id,
        emailCampaignId: opts.emailCampaignId ?? null,
        outcome: meta.outcome,
        exampleType: meta.exampleType,
        selectionBucket: meta.selectionBucket,
      });
    }
  };

  const booked = await prisma.lead.findMany({
    where: {
      ...baseWhere,
      appointmentBookedAt: { gte: opts.from, lt: opts.to },
      ...bookedWhere,
    },
    select: { id: true },
    orderBy: { appointmentBookedAt: "desc" },
    take: Math.max(opts.targets.positiveBookedRequested, 20),
  });
  pushMany(booked.slice(0, opts.targets.positiveBookedRequested).map((l) => l.id), {
    outcome: "BOOKED",
    exampleType: "positive",
    selectionBucket: "booked",
  });

  const stillNeedRequested = Math.max(0, opts.targets.positiveBookedRequested - booked.slice(0, opts.targets.positiveBookedRequested).length);
  if (stillNeedRequested > 0) {
    const requested = await prisma.lead.findMany({
      where: {
        ...baseWhere,
        lastInboundAt: { gte: opts.from, lt: opts.to },
        sentimentTag: { in: ["Meeting Requested", "Call Requested"] },
        lastMessageDirection: "inbound",
        NOT: bookedWhere,
      },
      select: { id: true },
      orderBy: { lastInboundAt: "desc" },
      take: stillNeedRequested * 2,
    });
    pushMany(requested.slice(0, stillNeedRequested).map((l) => l.id), {
      outcome: "REQUESTED",
      exampleType: "positive",
      selectionBucket: "requested",
    });
  }

  const highScorePositive = await selectHighScoreLeads({
    clientId: opts.clientId,
    from: opts.from,
    to: opts.to,
    emailCampaignId: opts.emailCampaignId ?? null,
    excludeLeadIds: used,
    provider: opts.provider,
    requireStalled: false,
    limit: opts.targets.positiveHighScore,
  });
  pushMany(highScorePositive, {
    outcome: "STALLED",
    exampleType: "positive",
    selectionBucket: "high_score",
  });

  const now = new Date();
  const requestedNeg = await prisma.lead.findMany({
    where: {
      ...baseWhere,
      lastInboundAt: { gte: opts.from, lt: opts.to },
      sentimentTag: { in: ["Meeting Requested", "Call Requested"] },
      lastMessageDirection: "outbound",
      lastOutboundAt: { gt: opts.from },
      NOT: bookedWhere,
    },
    select: { id: true, lastInboundAt: true },
    orderBy: { lastInboundAt: "asc" },
    take: Math.max(opts.targets.negativeRequestedNotBooked * 2, 20),
  });
  const requestedNegFiltered = requestedNeg
    .filter((l) => {
      if (used.has(l.id)) return false;
      const age = daysSince(l.lastInboundAt, now);
      return age !== null && age >= 2;
    })
    .slice(0, opts.targets.negativeRequestedNotBooked)
    .map((l) => l.id);
  pushMany(requestedNegFiltered, {
    outcome: "REQUESTED",
    exampleType: "negative",
    selectionBucket: "requested_not_booked",
  });

  const highScoreNeg = await selectHighScoreLeads({
    clientId: opts.clientId,
    from: opts.from,
    to: opts.to,
    emailCampaignId: opts.emailCampaignId ?? null,
    excludeLeadIds: used,
    provider: opts.provider,
    requireStalled: true,
    limit: opts.targets.negativeHighScoreNotBooked,
  });
  pushMany(highScoreNeg, {
    outcome: "STALLED",
    exampleType: "negative",
    selectionBucket: "high_score_not_booked",
  });

  const noResponse = await prisma.lead.findMany({
    where: {
      ...baseWhere,
      lastOutboundAt: { gte: opts.from, lt: opts.to },
      lastInboundAt: null,
    },
    select: { id: true },
    orderBy: { lastOutboundAt: "desc" },
    take: Math.max(opts.targets.negativeNoResponse * 2, 20),
  });
  pushMany(noResponse.slice(0, opts.targets.negativeNoResponse).map((l) => l.id), {
    outcome: "NO_RESPONSE",
    exampleType: "negative",
    selectionBucket: "no_response",
  });

  return selected;
}

export async function selectThreadsForInsightPack(opts: {
  clientId: string;
  from: Date;
  to: Date;
  campaignScope: InsightCampaignScope;
}): Promise<{ campaignIds: string[]; threads: SelectedInsightThread[]; provider: MeetingBookingProvider }> {
  const settings = await prisma.workspaceSettings.findUnique({
    where: { clientId: opts.clientId },
    select: { meetingBookingProvider: true },
  });
  const provider = settings?.meetingBookingProvider ?? "GHL";

  let campaignIds: string[] = [];
  if (opts.campaignScope.mode === "selected") {
    campaignIds = uniqueStrings(opts.campaignScope.campaignIds);
  } else if (opts.campaignScope.mode === "all") {
    campaignIds = await resolveTopCampaignIds({
      clientId: opts.clientId,
      from: opts.from,
      to: opts.to,
      cap: opts.campaignScope.cap,
      provider,
    });
  }

  const threads: SelectedInsightThread[] = [];

  if (campaignIds.length <= 1) {
    const campaignId = campaignIds[0] ?? null;
    const picked = await selectThreadsForCampaign({
      clientId: opts.clientId,
      from: opts.from,
      to: opts.to,
      provider,
      emailCampaignId: campaignId,
      targets: {
        positiveBookedRequested: 30,
        positiveHighScore: 20,
        negativeRequestedNotBooked: 10,
        negativeHighScoreNotBooked: 10,
        negativeNoResponse: 5,
      },
    });
    threads.push(...picked);
  } else {
    for (const campaignId of campaignIds) {
      const picked = await selectThreadsForCampaign({
        clientId: opts.clientId,
        from: opts.from,
        to: opts.to,
        provider,
        emailCampaignId: campaignId,
        targets: {
          positiveBookedRequested: 12,
          positiveHighScore: 8,
          negativeRequestedNotBooked: 4,
          negativeHighScoreNotBooked: 4,
          negativeNoResponse: 2,
        },
      });
      threads.push(...picked);
    }
  }

  return { campaignIds, threads, provider };
}
