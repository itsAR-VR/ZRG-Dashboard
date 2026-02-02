import "server-only";

import { prisma } from "@/lib/prisma";
import { isPositiveSentiment } from "@/lib/sentiment";

export type LeadCrmRowInterestParams = {
  leadId: string;
  messageId: string;
  messageSentAt: Date;
  channel: string;
  sentimentTag: string | null;
};

export async function upsertLeadCrmRowOnInterest(params: LeadCrmRowInterestParams) {
  if (!isPositiveSentiment(params.sentimentTag)) {
    return { skipped: "not_positive" as const };
  }

  const [lead, existing] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: params.leadId },
      select: {
        fitScore: true,
        intentScore: true,
        overallScore: true,
        emailCampaign: { select: { name: true } },
        smsCampaign: { select: { name: true } },
        campaign: { select: { name: true } },
      },
    }),
    prisma.leadCrmRow.findUnique({
      where: { leadId: params.leadId },
      select: { interestRegisteredAt: true },
    }),
  ]);

  if (!lead) {
    return { skipped: "lead_not_found" as const };
  }

  const interestRegisteredAt = existing?.interestRegisteredAt ?? params.messageSentAt;
  const campaignName = lead.emailCampaign?.name ?? lead.smsCampaign?.name ?? lead.campaign?.name ?? null;

  await prisma.leadCrmRow.upsert({
    where: { leadId: params.leadId },
    create: {
      leadId: params.leadId,
      interestRegisteredAt: params.messageSentAt,
      interestType: params.sentimentTag,
      interestMessageId: params.messageId,
      interestChannel: params.channel,
      interestCampaignName: campaignName,
      responseMode: null,
      responseMessageId: null,
      responseSentByUserId: null,
      leadScoreAtInterest: lead.overallScore ?? null,
      leadFitScoreAtInterest: lead.fitScore ?? null,
      leadIntentScoreAtInterest: lead.intentScore ?? null,
    },
    update: {
      interestRegisteredAt,
      interestType: params.sentimentTag,
      interestMessageId: params.messageId,
      interestChannel: params.channel,
      interestCampaignName: campaignName,
      responseMode: null,
      responseMessageId: null,
      responseSentByUserId: null,
      leadScoreAtInterest: lead.overallScore ?? null,
      leadFitScoreAtInterest: lead.fitScore ?? null,
      leadIntentScoreAtInterest: lead.intentScore ?? null,
    },
  });

  return { updated: true as const };
}
