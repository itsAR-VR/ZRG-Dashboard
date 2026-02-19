import "server-only";

import { Prisma, type CrmResponseMode } from "@prisma/client";
import { deriveCrmResponseMode, deriveCrmResponseType, type CrmResponseType } from "@/lib/crm-sheet-utils";
import { prisma } from "@/lib/prisma";
import { getSupabaseUserEmailsByIds } from "@/lib/supabase/admin";

export interface CrmWebhookRowPayload {
  id: string;
  leadId: string;
  date: Date | null;
  campaign: string | null;
  companyName: string | null;
  website: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  leadEmail: string | null;
  leadLinkedIn: string | null;
  phoneNumber: string | null;
  stepResponded: number | null;
  leadCategory: string | null;
  responseType: CrmResponseType;
  leadStatus: string | null;
  channel: string | null;
  leadType: string | null;
  applicationStatus: string | null;
  appointmentSetter: string | null;
  setterAssignment: string | null;
  notes: string | null;
  initialResponseDate: Date | null;
  followUp1: Date | null;
  followUp2: Date | null;
  followUp3: Date | null;
  followUp4: Date | null;
  followUp5: Date | null;
  responseStepComplete: boolean | null;
  dateOfBooking: Date | null;
  dateOfMeeting: Date | null;
  qualified: boolean | null;
  followUpDateRequested: Date | null;
  setters: string | null;
  responseMode: CrmResponseMode | null;
  leadScore: number | null;
}

const CRM_WEBHOOK_ROW_INCLUDE = {
  lead: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      linkedinUrl: true,
      jobTitle: true,
      companyName: true,
      companyWebsite: true,
      status: true,
      sentimentTag: true,
      snoozedUntil: true,
      assignedToUserId: true,
      appointmentBookedAt: true,
      appointmentStartAt: true,
      ghlAppointmentId: true,
      calendlyInviteeUri: true,
      overallScore: true,
      emailCampaign: { select: { name: true } },
      smsCampaign: { select: { name: true } },
      campaign: { select: { name: true } },
    },
  },
} as const;

type CrmWebhookLeadCrmRow = Prisma.LeadCrmRowGetPayload<{
  include: typeof CRM_WEBHOOK_ROW_INCLUDE;
}>;

export type BuildCrmWebhookRowPayloadInput = {
  row: CrmWebhookLeadCrmRow;
  stepResponded: number | null;
  followUps: Date[];
  responseStepComplete: boolean | null;
  derivedResponseMode: CrmResponseMode | null;
  appointmentSetter: string | null;
  setterAssignment: string | null;
};

export function buildCrmWebhookRowPayload(input: BuildCrmWebhookRowPayloadInput): CrmWebhookRowPayload {
  const { row } = input;
  const lead = row.lead;

  const campaign =
    row.interestCampaignName ?? lead.emailCampaign?.name ?? lead.smsCampaign?.name ?? lead.campaign?.name ?? null;
  const status = row.pipelineStatus ?? lead.status ?? null;
  const qualified =
    status === "qualified" || status === "meeting-booked"
      ? true
      : status === "unqualified" || status === "not-interested" || status === "blacklisted"
        ? false
        : null;
  const interestRegisteredAt = row.interestRegisteredAt ?? null;
  const interestChannel = row.interestChannel ?? null;
  const bookedEvidence = Boolean(lead.appointmentBookedAt || lead.ghlAppointmentId || lead.calendlyInviteeUri);
  const responseType = deriveCrmResponseType({
    sentimentTag: lead.sentimentTag ?? null,
    snoozedUntil: lead.snoozedUntil ?? null,
    bookedEvidence,
  });

  return {
    id: row.id,
    leadId: row.leadId,
    date: interestRegisteredAt,
    campaign,
    companyName: lead.companyName ?? null,
    website: lead.companyWebsite ?? null,
    firstName: lead.firstName ?? null,
    lastName: lead.lastName ?? null,
    jobTitle: lead.jobTitle ?? null,
    leadEmail: lead.email ?? null,
    leadLinkedIn: lead.linkedinUrl ?? null,
    phoneNumber: lead.phone ?? null,
    stepResponded: input.stepResponded,
    leadCategory: row.leadCategoryOverride ?? row.interestType ?? lead.sentimentTag ?? null,
    responseType,
    leadStatus: status,
    channel: interestChannel,
    leadType: row.leadType ?? null,
    applicationStatus: row.applicationStatus ?? null,
    appointmentSetter: input.appointmentSetter,
    setterAssignment: input.setterAssignment,
    notes: row.notes ?? null,
    initialResponseDate: interestRegisteredAt,
    followUp1: input.followUps[0] ?? null,
    followUp2: input.followUps[1] ?? null,
    followUp3: input.followUps[2] ?? null,
    followUp4: input.followUps[3] ?? null,
    followUp5: input.followUps[4] ?? null,
    responseStepComplete: input.responseStepComplete,
    dateOfBooking: lead.appointmentBookedAt ?? null,
    dateOfMeeting: lead.appointmentStartAt ?? null,
    qualified,
    followUpDateRequested: lead.snoozedUntil ?? null,
    setters: input.appointmentSetter,
    responseMode: row.responseMode ?? input.derivedResponseMode ?? "UNKNOWN",
    leadScore: row.leadScoreAtInterest ?? lead.overallScore ?? null,
  };
}

export async function buildCrmWebhookRowPayloadForLead(leadId: string): Promise<CrmWebhookRowPayload | null> {
  const row = await prisma.leadCrmRow.findUnique({
    where: { leadId },
    include: CRM_WEBHOOK_ROW_INCLUDE,
  });
  if (!row) return null;

  const interestRegisteredAt = row.interestRegisteredAt ?? null;
  const interestChannel = row.interestChannel ?? null;

  const [followUps, stepResponded, responseStepComplete, derivedResponseMode] = await Promise.all([
    prisma.followUpTask.findMany({
      where: {
        leadId,
        status: "pending",
      },
      select: { dueDate: true },
      orderBy: { dueDate: "asc" },
      take: 5,
    }),
    interestRegisteredAt && interestChannel
      ? prisma.message.count({
          where: {
            leadId,
            direction: "outbound",
            channel: interestChannel,
            sentAt: { lt: interestRegisteredAt },
          },
        })
      : Promise.resolve(0),
    interestRegisteredAt && interestChannel
      ? prisma.message.findFirst({
          where: {
            leadId,
            direction: "outbound",
            channel: interestChannel,
            sentAt: { gt: interestRegisteredAt },
          },
          select: { id: true },
        })
      : Promise.resolve(null),
    !row.responseMode && interestRegisteredAt && interestChannel
      ? prisma.message.findFirst({
          where: {
            leadId,
            direction: "outbound",
            channel: interestChannel,
            sentAt: { gt: interestRegisteredAt },
          },
          select: { sentBy: true, sentByUserId: true },
          orderBy: { sentAt: "asc" },
        })
      : Promise.resolve(null),
  ]);

  const userIds = [row.lead.assignedToUserId, row.responseSentByUserId].filter(
    (userId): userId is string => Boolean(userId)
  );
  const emailMap =
    userIds.length > 0
      ? await getSupabaseUserEmailsByIds([...new Set(userIds)]).catch(() => new Map<string, string | null>())
      : new Map<string, string | null>();

  const appointmentSetter = row.lead.assignedToUserId
    ? emailMap.get(row.lead.assignedToUserId) ?? row.lead.assignedToUserId
    : null;
  const setterAssignment = row.responseSentByUserId
    ? emailMap.get(row.responseSentByUserId) ?? row.responseSentByUserId
    : null;

  return buildCrmWebhookRowPayload({
    row,
    stepResponded: interestRegisteredAt && interestChannel ? stepResponded : null,
    followUps: followUps.map((item) => item.dueDate),
    responseStepComplete: interestRegisteredAt && interestChannel ? Boolean(responseStepComplete) : null,
    derivedResponseMode:
      derivedResponseMode && !row.responseMode
        ? deriveCrmResponseMode(derivedResponseMode.sentBy, derivedResponseMode.sentByUserId)
        : null,
    appointmentSetter,
    setterAssignment,
  });
}
