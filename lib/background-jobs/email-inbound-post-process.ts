import "server-only";

import { isPrismaUniqueConstraintError, prisma } from "@/lib/prisma";
import {
  createEmailBisonLead,
  fetchEmailBisonLead,
  fetchEmailBisonSentEmails,
  getCustomVariable,
  stopEmailBisonCampaignFutureEmailsForLeads,
} from "@/lib/emailbison-api";
import {
  extractContactFromMessageContent,
  extractContactFromSignature,
  extractLinkedInFromText,
  extractPhoneFromText,
} from "@/lib/signature-extractor";
import {
  classifyLinkedInUrl,
  extractLinkedInUrlsFromValues,
  mergeLinkedInFields,
  normalizeLinkedInUrl,
} from "@/lib/linkedin-utils";
import { normalizePhone } from "@/lib/lead-matching";
import { toStoredPhone } from "@/lib/phone-utils";
import { enrichPhoneThenSyncToGhl } from "@/lib/phone-enrichment";
import {
  analyzeInboundEmailReply,
  classifySentiment,
  isPositiveSentiment,
  SENTIMENT_TO_STATUS,
  type SentimentTag,
} from "@/lib/sentiment";
import { triggerEnrichmentForLead } from "@/lib/clay-api";
import { ensureGhlContactIdForLead, syncGhlContactPhoneForLead } from "@/lib/ghl-contacts";
import {
  pauseFollowUpsUntil,
  processMessageForAutoBooking,
  resumeAwaitingEnrichmentFollowUpsForLead,
  type AutoBookingContext,
} from "@/lib/followup-engine";
import { ensureLeadTimezone } from "@/lib/timezone-inference";
import { detectSnoozedUntilUtcFromMessage } from "@/lib/snooze-detection";
import { scheduleFollowUpTimingFromInbound } from "@/lib/followup-timing";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { cleanEmailBody, stripEmailQuotedSectionsForAutomation } from "@/lib/email-cleaning";
import { buildSentimentTranscriptFromMessages, detectBounce, isOptOutText } from "@/lib/sentiment";
import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { executeAutoSend } from "@/lib/auto-send";
import { enqueueLeadScoringJob } from "@/lib/lead-scoring";
import { maybeAssignLead } from "@/lib/lead-assignment";
import { notifyOnLeadSentimentChange } from "@/lib/notification-center";
import { ensureCallRequestedTask } from "@/lib/call-requested";
import { extractSchedulerLinkFromText } from "@/lib/scheduling-link";
import { handleLeadSchedulerLinkIfPresent } from "@/lib/lead-scheduler-link";
import { upsertLeadCrmRowOnInterest } from "@/lib/lead-crm-row";
import { resolveBookingLink } from "@/lib/meeting-booking-provider";
import {
  detectActionSignals,
  EMPTY_ACTION_SIGNAL_RESULT,
  notifyActionSignals,
  buildActionSignalsGateSummary,
  hasActionSignal,
} from "@/lib/action-signal-detector";
import { slackPostMessage } from "@/lib/slack-bot";
import { getPublicAppUrl } from "@/lib/app-url";

function parseDate(...dateStrs: (string | null | undefined)[]): Date {
  for (const dateStr of dateStrs) {
    if (dateStr) {
      const parsed = new Date(dateStr);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }
  return new Date();
}

function buildLeadInboxUrl(leadId: string): string {
  return `${getPublicAppUrl()}/?view=inbox&leadId=${encodeURIComponent(leadId)}`;
}

async function notifyDraftSkipForOps(opts: {
  clientId: string;
  leadId: string;
  messageId: string;
  sentimentTag: string | null;
  reason: "scheduling_followup_task" | "call_requested_no_phone";
}): Promise<void> {
  const [client, lead, settings] = await Promise.all([
    prisma.client.findUnique({
      where: { id: opts.clientId },
      select: { id: true, name: true, slackBotToken: true },
    }),
    prisma.lead.findUnique({
      where: { id: opts.leadId },
      select: { id: true, firstName: true, lastName: true, email: true },
    }),
    prisma.workspaceSettings.findUnique({
      where: { clientId: opts.clientId },
      select: { slackAlerts: true, notificationSlackChannelIds: true },
    }),
  ]);

  if (!client || !lead || !settings) return;
  if (settings.slackAlerts === false) return;
  if (!client.slackBotToken || settings.notificationSlackChannelIds.length === 0) return;

  const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || lead.email || "Lead";
  const leadUrl = buildLeadInboxUrl(opts.leadId);
  const reasonText =
    opts.reason === "scheduling_followup_task"
      ? "Scheduling flow created a follow-up task, so draft generation was intentionally skipped."
      : "Call intent was detected, but no phone is on file, so draft generation was intentionally skipped.";

  for (const channelId of settings.notificationSlackChannelIds) {
    const trimmed = (channelId || "").trim();
    if (!trimmed) continue;

    const dedupeKey = `draft_skip:${opts.clientId}:${opts.leadId}:${opts.messageId}:${opts.reason}:slack:${trimmed}`;
    try {
      await prisma.notificationSendLog.create({
        data: {
          clientId: opts.clientId,
          leadId: opts.leadId,
          kind: "draft_skip",
          destination: "slack",
          sentimentTag: opts.sentimentTag,
          dedupeKey,
        },
      });
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) continue;
      console.warn("[Email PostProcess] Draft-skip dedupe log create failed:", error);
      continue;
    }

    const text = [
      "⚠️ *AI Draft Skipped (Intentional Routing)*",
      `Lead: ${leadName}`,
      `Workspace: ${client.name}`,
      opts.sentimentTag ? `Sentiment: ${opts.sentimentTag}` : null,
      `Reason: ${reasonText}`,
      `<${leadUrl}|View in Dashboard>`,
    ]
      .filter(Boolean)
      .join("\n");

    const sent = await slackPostMessage({
      token: client.slackBotToken,
      channelId: trimmed,
      text,
    });

    if (!sent.success) {
      await prisma.notificationSendLog.deleteMany({ where: { dedupeKey } }).catch(() => undefined);
      console.warn("[Email PostProcess] Draft-skip Slack notification failed:", sent.error);
    }
  }
}

/**
 * Maps AI classification result to SentimentTag.
 * Duplicated from email webhook for background job usage.
 */
function mapEmailInboxClassificationToSentimentTag(classification: string): SentimentTag {
  switch (classification) {
    case "Meeting Booked":
      return "Meeting Booked";
    case "Meeting Requested":
      return "Meeting Requested";
    case "Call Requested":
      return "Call Requested";
    case "Information Requested":
      return "Information Requested";
    case "Follow Up":
      return "Follow Up";
    case "Not Interested":
      return "Not Interested";
    case "Automated Reply":
      return "Automated Reply";
    case "Out Of Office":
      return "Out of Office";
    case "Blacklist":
      return "Blacklist";
    default:
      return "Neutral";
  }
}

/**
 * Fetches recent sent emails from EmailBison and backfills missing outbound Message rows.
 * This improves transcript quality for AI decisions + the UI thread view.
 */
async function backfillOutboundEmailMessagesIfMissing(opts: {
  leadId: string;
  emailBisonLeadId: string;
  apiKey: string;
  baseHost?: string | null;
  limit?: number;
}) {
  const limit = opts.limit ?? 12;

  const sentEmailsResult = await fetchEmailBisonSentEmails(opts.apiKey, opts.emailBisonLeadId, {
    baseHost: opts.baseHost ?? null,
  });
  if (!sentEmailsResult.success || !sentEmailsResult.data || sentEmailsResult.data.length === 0) return;

  const sorted = [...sentEmailsResult.data].sort((a, b) => {
    const aTime = parseDate(a.sent_at, a.scheduled_date_local).getTime();
    const bTime = parseDate(b.sent_at, b.scheduled_date_local).getTime();
    return aTime - bTime;
  });

  const tail = sorted.slice(Math.max(0, sorted.length - limit));

  for (const sentEmail of tail) {
    const inboxxiaScheduledEmailId = String(sentEmail.id);
    const sentAt = parseDate(sentEmail.sent_at, sentEmail.scheduled_date_local);
    const cleaned = cleanEmailBody(sentEmail.email_body, null);
    const body = cleaned.cleaned || sentEmail.email_subject || "";
    const subject = sentEmail.email_subject ?? null;

    if (!body.trim()) continue;

    const existingById = await prisma.message.findUnique({
      where: { inboxxiaScheduledEmailId },
    });
    if (existingById) continue;

    const windowStart = new Date(sentAt.getTime() - 12 * 60 * 60 * 1000);
    const windowEnd = new Date(sentAt.getTime() + 12 * 60 * 60 * 1000);

    const existingLegacy = await prisma.message.findFirst({
      where: {
        leadId: opts.leadId,
        channel: "email",
        direction: "outbound",
        inboxxiaScheduledEmailId: null,
        sentAt: { gte: windowStart, lte: windowEnd },
        body: { contains: body.substring(0, Math.min(100, body.length)) },
      },
      select: { id: true },
    });

    if (existingLegacy) {
      await prisma.message.update({
        where: { id: existingLegacy.id },
        data: {
          inboxxiaScheduledEmailId,
          sentAt,
          subject,
          rawHtml: cleaned.rawHtml ?? null,
        },
      });
      await bumpLeadMessageRollup({ leadId: opts.leadId, direction: "outbound", sentAt });
      continue;
    }

    await prisma.message.create({
      data: {
        inboxxiaScheduledEmailId,
        channel: "email",
        source: "inboxxia_campaign",
        body,
        rawHtml: cleaned.rawHtml ?? null,
        subject,
        isRead: true,
        direction: "outbound",
        leadId: opts.leadId,
        sentAt,
      },
    });

    await bumpLeadMessageRollup({ leadId: opts.leadId, direction: "outbound", sentAt });
  }
}

/**
 * Data extracted from EmailBison for Clay enrichment.
 */
interface EmailBisonEnrichmentData {
  companyName?: string;
  companyDomain?: string; // From 'website' custom var
  state?: string; // From 'company state' custom var
  industry?: string; // From 'industry' custom var
  employeeHeadcount?: string; // From 'employee_headcount' custom var
  linkedInProfile?: string; // From 'linkedin url' custom var or Lead.linkedinUrl
  existingPhone?: string; // From 'phone' custom var (to skip enrichment if exists)
}

/**
 * Result from EmailBison enrichment including data for Clay.
 */
interface EmailBisonEnrichmentResult {
  linkedinUrl?: string;
  linkedinCompanyUrl?: string;
  phone?: string;
  companyName?: string;
  companyWebsite?: string;
  companyState?: string;
  industry?: string;
  employeeHeadcount?: string;
  timezoneRaw?: string;
  clayData: EmailBisonEnrichmentData;
}

function buildLinkedInFieldUpdates(opts: {
  currentProfileUrl: string | null | undefined;
  currentCompanyUrl: string | null | undefined;
  incomingUrl: string | null | undefined;
}): { linkedinUrl?: string; linkedinCompanyUrl?: string } {
  const merged = mergeLinkedInFields({
    currentProfileUrl: opts.currentProfileUrl,
    currentCompanyUrl: opts.currentCompanyUrl,
    incomingUrl: opts.incomingUrl,
  });
  const updates: { linkedinUrl?: string; linkedinCompanyUrl?: string } = {};

  if (merged.profileUrl !== (opts.currentProfileUrl ?? null)) {
    updates.linkedinUrl = merged.profileUrl ?? undefined;
  }
  if (merged.companyUrl !== (opts.currentCompanyUrl ?? null)) {
    updates.linkedinCompanyUrl = merged.companyUrl ?? undefined;
  }

  return updates;
}

async function enrichLeadFromEmailBison(
  leadId: string,
  emailBisonLeadId: string,
  apiKey: string,
  baseHost?: string | null
): Promise<EmailBisonEnrichmentResult> {
  const result: EmailBisonEnrichmentResult = {
    clayData: {},
  };

  try {
    const leadDetails = await fetchEmailBisonLead(apiKey, emailBisonLeadId, { baseHost: baseHost ?? null });

    if (!leadDetails.success || !leadDetails.data) {
      console.log(`[EmailBison Enrichment] Failed to fetch lead ${emailBisonLeadId}: ${leadDetails.error}`);
      return result;
    }

    const leadData = leadDetails.data;
    const customVars = leadData.custom_variables;

    // Extract LinkedIn profile/company URLs by scanning all custom variable values.
    const extractedLinkedIn = extractLinkedInUrlsFromValues([customVars?.map((cv) => cv.value) ?? []]);
    if (extractedLinkedIn.profileUrl) {
      result.linkedinUrl = extractedLinkedIn.profileUrl;
      result.clayData.linkedInProfile = extractedLinkedIn.profileUrl;
      console.log(
        `[EmailBison Enrichment] Found LinkedIn profile URL for lead ${leadId}: ${extractedLinkedIn.profileUrl}`
      );
    }
    if (extractedLinkedIn.companyUrl) {
      result.linkedinCompanyUrl = extractedLinkedIn.companyUrl;
      console.log(
        `[EmailBison Enrichment] Found LinkedIn company URL for lead ${leadId}: ${extractedLinkedIn.companyUrl}`
      );
    }

    // Extract phone from custom variables
    const phoneRaw =
      getCustomVariable(customVars, "phone") ||
      getCustomVariable(customVars, "mobile") ||
      getCustomVariable(customVars, "phone number");

    if (phoneRaw && phoneRaw !== "-") {
      const normalized = normalizePhone(phoneRaw);
      if (normalized) {
        const stored = toStoredPhone(phoneRaw);
        if (stored) {
          result.phone = stored;
          result.clayData.existingPhone = stored;
          console.log(`[EmailBison Enrichment] Found phone for lead ${leadId}: ${stored}`);
        }
      }
    }

    // Company name from main lead data
    if (leadData.company) {
      result.clayData.companyName = leadData.company;
      result.companyName = leadData.company;
    }

    // Company domain from 'website' custom variable (full URL)
    const website = getCustomVariable(customVars, "website");
    if (website && website !== "-") {
      result.clayData.companyDomain = website;
      result.companyWebsite = website;
    }

    // State from 'company state' custom variable
    const companyState = getCustomVariable(customVars, "company state");
    if (companyState && companyState !== "-") {
      result.clayData.state = companyState;
      result.companyState = companyState;
    }

    // Industry from custom variables
    const industry = getCustomVariable(customVars, "industry");
    if (industry && industry !== "-") {
      result.clayData.industry = industry;
      result.industry = industry;
    }

    // Employee headcount from custom variables
    const employeeHeadcount =
      getCustomVariable(customVars, "employee_headcount") ||
      getCustomVariable(customVars, "employee headcount") ||
      getCustomVariable(customVars, "headcount");
    if (employeeHeadcount && employeeHeadcount !== "-") {
      result.clayData.employeeHeadcount = employeeHeadcount;
      result.employeeHeadcount = employeeHeadcount;
    }

    // Timezone raw from custom variables
    const timezoneRaw =
      getCustomVariable(customVars, "timezone") ||
      getCustomVariable(customVars, "time zone") ||
      getCustomVariable(customVars, "tz") ||
      getCustomVariable(customVars, "lead timezone") ||
      getCustomVariable(customVars, "lead time zone");
    if (timezoneRaw && timezoneRaw !== "-") {
      result.timezoneRaw = timezoneRaw;
    }

    // Update lead with enriched data if missing
    const currentLead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        linkedinUrl: true,
        linkedinCompanyUrl: true,
        phone: true,
        companyName: true,
        companyWebsite: true,
        companyState: true,
        industry: true,
        employeeHeadcount: true,
        timezone: true,
      },
    });

    const updates: Record<string, unknown> = {};
    Object.assign(
      updates,
      buildLinkedInFieldUpdates({
        currentProfileUrl: currentLead?.linkedinUrl,
        currentCompanyUrl: currentLead?.linkedinCompanyUrl,
        incomingUrl: result.linkedinUrl ?? result.linkedinCompanyUrl,
      })
    );
    if (result.phone && !currentLead?.phone) updates.phone = result.phone;
    if (result.companyName && !currentLead?.companyName) updates.companyName = result.companyName;
    if (result.companyWebsite && !currentLead?.companyWebsite) updates.companyWebsite = result.companyWebsite;
    if (result.companyState && !currentLead?.companyState) updates.companyState = result.companyState;
    if (result.industry && !currentLead?.industry) updates.industry = result.industry;
    if (result.employeeHeadcount && !currentLead?.employeeHeadcount) updates.employeeHeadcount = result.employeeHeadcount;

    if (result.timezoneRaw && (!currentLead?.timezone || currentLead.timezone.trim() === "")) {
      const raw = result.timezoneRaw.trim();
      const upper = raw.toUpperCase();
      const mapped: Record<string, string> = {
        UTC: "UTC",
        GMT: "Europe/London",
        BST: "Europe/London",
        EST: "America/New_York",
        EDT: "America/New_York",
        CST: "America/Chicago",
        CDT: "America/Chicago",
        MST: "America/Denver",
        MDT: "America/Denver",
        PST: "America/Los_Angeles",
        PDT: "America/Los_Angeles",
      };

      const candidate = mapped[upper] || raw;
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
        updates.timezone = candidate;
      } catch {
        // ignore unrecognized values; ensureLeadTimezone() can infer later
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.enrichmentSource = "emailbison";
      updates.enrichedAt = new Date();
      await prisma.lead.update({ where: { id: leadId }, data: updates });
      console.log(`[EmailBison Enrichment] Updated lead ${leadId} with EmailBison data`);
    }
  } catch (error) {
    console.error(`[EmailBison Enrichment] Error enriching lead ${leadId}:`, error);
  }

  return result;
}

async function enrichLeadFromSignature(opts: {
  clientId: string;
  leadId: string;
  leadName: string;
  leadEmail: string;
  emailBody: string;
}): Promise<{ phone?: string; linkedinUrl?: string; linkedinCompanyUrl?: string }> {
  const result: { phone?: string; linkedinUrl?: string; linkedinCompanyUrl?: string } = {};

  try {
    const getSignatureTail = (text: string) => {
      const normalized = (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const lines = normalized.split("\n");
      const tailLines = lines.slice(Math.max(0, lines.length - 40));
      return tailLines.join("\n").trim();
    };

    const looksLikeMatchesSender = (tail: string, email: string, name: string) => {
      const lower = (tail || "").toLowerCase();
      const emailNeedle = (email || "").trim().toLowerCase();
      if (emailNeedle && lower.includes(emailNeedle)) return true;
      const nameNeedle = (name || "").trim().toLowerCase();
      if (nameNeedle && nameNeedle.length >= 3 && lower.includes(nameNeedle)) return true;
      const first = nameNeedle.split(/\s+/).filter(Boolean)[0] || "";
      if (first.length >= 3 && lower.includes(first)) return true;
      return false;
    };

    const currentLead = await prisma.lead.findUnique({
      where: { id: opts.leadId },
      select: { phone: true, linkedinUrl: true, linkedinCompanyUrl: true },
    });

    if (currentLead?.phone && normalizeLinkedInUrl(currentLead.linkedinUrl)) {
      return result;
    }

    const extraction = await extractContactFromSignature(opts.emailBody, opts.leadName, opts.leadEmail, {
      clientId: opts.clientId,
      leadId: opts.leadId,
    });

    if (extraction.isFromLead === "no") return result;

    if (extraction.isFromLead === "unknown") {
      const tail = getSignatureTail(opts.emailBody);
      if (!tail) return result;
      if (!looksLikeMatchesSender(tail, opts.leadEmail, opts.leadName)) return result;

      const fallbackPhone = !currentLead?.phone ? extractPhoneFromText(tail) : null;
      const fallbackLinkedIn = extractLinkedInFromText(tail);
      if (!fallbackPhone && !fallbackLinkedIn) return result;

      const updates: Record<string, unknown> = {};
      if (!currentLead?.phone && fallbackPhone) {
        updates.phone = fallbackPhone;
        result.phone = fallbackPhone;
      }
      const linkedInUpdates = buildLinkedInFieldUpdates({
        currentProfileUrl: currentLead?.linkedinUrl,
        currentCompanyUrl: currentLead?.linkedinCompanyUrl,
        incomingUrl: fallbackLinkedIn,
      });
      Object.assign(updates, linkedInUpdates);
      if (linkedInUpdates.linkedinUrl) {
        result.linkedinUrl = linkedInUpdates.linkedinUrl;
      }
      if (linkedInUpdates.linkedinCompanyUrl) {
        result.linkedinCompanyUrl = linkedInUpdates.linkedinCompanyUrl;
      }

      if (Object.keys(updates).length > 0) {
        updates.enrichmentSource = "signature";
        updates.enrichedAt = new Date();
        await prisma.lead.update({ where: { id: opts.leadId }, data: updates });
      }

      return result;
    }

    if (extraction.confidence === "low") return result;

    const updates: Record<string, unknown> = {};
    if (!currentLead?.phone && extraction.phone) {
      updates.phone = extraction.phone;
      result.phone = extraction.phone;
    }
    if (extraction.linkedinUrl) {
      const linkedInUpdates = buildLinkedInFieldUpdates({
        currentProfileUrl: currentLead?.linkedinUrl,
        currentCompanyUrl: currentLead?.linkedinCompanyUrl,
        incomingUrl: extraction.linkedinUrl,
      });
      Object.assign(updates, linkedInUpdates);
      if (linkedInUpdates.linkedinUrl) {
        result.linkedinUrl = linkedInUpdates.linkedinUrl;
      }
      if (linkedInUpdates.linkedinCompanyUrl) {
        result.linkedinCompanyUrl = linkedInUpdates.linkedinCompanyUrl;
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.enrichmentSource = "signature";
      updates.enrichedAt = new Date();
      await prisma.lead.update({ where: { id: opts.leadId }, data: updates });
    }
  } catch (error) {
    console.error(`[Signature Extraction] Error extracting from signature for lead ${opts.leadId}:`, error);
  }

  return result;
}

async function triggerClayEnrichmentIfNeeded(opts: {
  leadId: string;
  sentimentTag: string | null;
  emailBisonData?: EmailBisonEnrichmentData;
}): Promise<void> {
  try {
    if (!isPositiveSentiment(opts.sentimentTag)) {
      return;
    }

    const lead = await prisma.lead.findUnique({
      where: { id: opts.leadId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        companyName: true,
        linkedinUrl: true,
        phone: true,
        enrichmentStatus: true,
      },
    });
    if (!lead?.email) return;

    // One-time policy: only attempt Clay enrichment once per lead.
    if (lead.enrichmentStatus) return;

    const leadProfileUrl = normalizeLinkedInUrl(lead.linkedinUrl);
    const missingLinkedIn = !leadProfileUrl && !opts.emailBisonData?.linkedInProfile;
    const existingPhone = lead.phone || opts.emailBisonData?.existingPhone;
    const hasValidPhone = existingPhone && normalizePhone(existingPhone);
    const missingPhone = !hasValidPhone;

    if (!missingLinkedIn && !missingPhone) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { enrichmentStatus: "not_needed" },
      });
      return;
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        enrichmentStatus: "pending",
        enrichmentLastRetry: new Date(),
        enrichmentRetryCount: 1,
      },
    });

    const fullName = `${lead.firstName || ""} ${lead.lastName || ""}`.trim();
    const triggerResult = await triggerEnrichmentForLead(
      {
        leadId: lead.id,
        emailAddress: lead.email,
        firstName: lead.firstName || undefined,
        lastName: lead.lastName || undefined,
        fullName: fullName || undefined,
        companyName: opts.emailBisonData?.companyName || lead.companyName || undefined,
        companyDomain: opts.emailBisonData?.companyDomain,
        state: opts.emailBisonData?.state,
        linkedInProfile: opts.emailBisonData?.linkedInProfile || leadProfileUrl || undefined,
      },
      missingLinkedIn,
      missingPhone && !opts.emailBisonData?.existingPhone
    );

    if (!triggerResult.linkedInSent && !triggerResult.phoneSent) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { enrichmentStatus: "failed" },
      });
    }
  } catch (error) {
    console.error(`[Clay Enrichment] Error triggering enrichment for lead ${opts.leadId}:`, error);
  }
}

export async function runEmailInboundPostProcessJob(opts: {
  clientId: string;
  leadId: string;
  messageId: string;
}): Promise<void> {
  const [client, message] = await Promise.all([
    prisma.client.findUnique({
      where: { id: opts.clientId },
      select: {
        id: true,
        name: true,
        emailBisonApiKey: true,
        emailBisonBaseHost: { select: { host: true } },
        settings: {
          select: {
            timezone: true,
            workStartTime: true,
            workEndTime: true,
            autoSendSkipHumanReview: true,
            autoSendScheduleMode: true,
            autoSendCustomSchedule: true,
            autoSendRevisionEnabled: true,
            autoSendRevisionModel: true,
            autoSendRevisionReasoningEffort: true,
            autoSendRevisionMaxIterations: true,
            aiRouteBookingProcessEnabled: true,
          },
        },
      },
    }),
    prisma.message.findUnique({
      where: { id: opts.messageId },
      select: {
        id: true,
        leadId: true,
        channel: true,
        direction: true,
        body: true,
        rawText: true,
        rawHtml: true,
        subject: true,
        sentAt: true,
      },
    }),
  ]);

  if (!client) throw new Error("Client not found");
  if (!message) throw new Error("Message not found");
  if (message.leadId !== opts.leadId) throw new Error("Message leadId mismatch");
  if (message.channel !== "email" || message.direction !== "inbound") return;

  // Load lead after we validate message relation.
  let lead = await prisma.lead.findUnique({
    where: { id: opts.leadId },
    select: {
      id: true,
      clientId: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      linkedinUrl: true,
      timezone: true,
      emailBisonLeadId: true,
      sentimentTag: true,
      autoReplyEnabled: true,
      emailCampaign: {
        select: {
          id: true,
          name: true,
          bisonCampaignId: true,
          responseMode: true,
          autoSendConfidenceThreshold: true,
          autoSendSkipHumanReview: true,
          autoSendScheduleMode: true,
          autoSendCustomSchedule: true,
        },
      },
    },
  });

  if (!lead) throw new Error("Lead not found");
  const previousSentiment = lead.sentimentTag;

  const emailBisonBaseHost = client.emailBisonBaseHost?.host ?? null;

  // If this is an untracked reply and we don't have an EmailBison lead ID yet, try to create one.
  if (!lead.emailBisonLeadId && client.emailBisonApiKey && lead.email) {
    const createResult = await createEmailBisonLead(
      client.emailBisonApiKey,
      {
        email: lead.email,
        first_name: lead.firstName ?? null,
        last_name: lead.lastName ?? null,
      },
      { baseHost: emailBisonBaseHost }
    );

    if (createResult.success && createResult.leadId) {
      lead = await prisma.lead.update({
        where: { id: lead.id },
        data: { emailBisonLeadId: createResult.leadId },
        select: {
          id: true,
          clientId: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          linkedinUrl: true,
          timezone: true,
          emailBisonLeadId: true,
          sentimentTag: true,
          autoReplyEnabled: true,
          emailCampaign: {
            select: {
              id: true,
              name: true,
              bisonCampaignId: true,
              responseMode: true,
              autoSendConfidenceThreshold: true,
              autoSendSkipHumanReview: true,
              autoSendScheduleMode: true,
              autoSendCustomSchedule: true,
            },
          },
        },
      });
      console.log(`[EmailBison] Created lead ${createResult.leadId} for local lead ${lead.id}`);
    } else if (!createResult.success) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { status: "needs_repair" },
      });
      console.error(`[EmailBison] Failed to create lead for ${lead.id}: ${createResult.error}`);
    }
  }

  if (client.emailBisonApiKey && lead.emailBisonLeadId) {
    // If the lead replied, stop any remaining outbound campaign emails for this lead in the originating campaign.
    // This prevents campaign sequences from overlapping with manual/AI nurturing in ZRG.
    const bisonCampaignId = (lead.emailCampaign?.bisonCampaignId || "").trim();
    if (bisonCampaignId) {
      const stopResult = await stopEmailBisonCampaignFutureEmailsForLeads(
        client.emailBisonApiKey,
        bisonCampaignId,
        [lead.emailBisonLeadId],
        { baseHost: emailBisonBaseHost }
      ).catch((error) => ({
        success: false as const,
        error: error instanceof Error ? error.message : "Unknown error",
      }));

      if (!stopResult.success) {
        console.warn("[EmailBison] Failed to stop future campaign emails for lead:", {
          leadId: lead.id,
          emailBisonLeadId: lead.emailBisonLeadId,
          bisonCampaignId,
          error: stopResult.error || "unknown_error",
        });
      }
    }

    await backfillOutboundEmailMessagesIfMissing({
      leadId: lead.id,
      emailBisonLeadId: lead.emailBisonLeadId,
      apiKey: client.emailBisonApiKey,
      baseHost: emailBisonBaseHost,
    });
  }

  const inboundText = (message.body || "").trim();
  const inboundReplyOnly = stripEmailQuotedSectionsForAutomation(inboundText).trim();
  const fullEmailBody = message.rawText || message.rawHtml || inboundText || "";
  const schedulerLink = extractSchedulerLinkFromText(message.rawText || message.rawHtml || inboundText);
  if (schedulerLink) {
    prisma.lead
      .updateMany({
        where: { id: lead.id, externalSchedulingLink: { not: schedulerLink } },
        data: { externalSchedulingLink: schedulerLink, externalSchedulingLinkLastSeenAt: new Date() },
      })
      .catch(() => undefined);
  }

  // AI SENTIMENT CLASSIFICATION (moved from webhook for faster response times)
  // Run full AI classification if the webhook used a placeholder ("Neutral").
  // This ensures accurate sentiment before enrichment and draft generation.
  if (lead.sentimentTag === "Neutral" || lead.sentimentTag === "New") {
    try {
      const classificationMessages = await prisma.message.findMany({
        where: { leadId: lead.id },
        orderBy: { sentAt: "asc" },
        take: 40,
        select: { sentAt: true, channel: true, direction: true, body: true, subject: true },
      });

      const transcript = buildSentimentTranscriptFromMessages(classificationMessages);
      const subject = message.subject ?? null;

      // Double-check safety before AI call
      const combined = `Subject: ${subject ?? ""} | ${inboundReplyOnly || inboundText}`;
      const mustBlacklist = isOptOutText(combined) || detectBounce([{ body: combined, direction: "inbound", channel: "email" }]);

      if (mustBlacklist) {
        // Safety override
        lead = await prisma.lead.update({
          where: { id: lead.id },
          data: { sentimentTag: "Blacklist", status: "blacklisted" },
          select: {
            id: true,
            clientId: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            linkedinUrl: true,
            timezone: true,
            emailBisonLeadId: true,
            sentimentTag: true,
            autoReplyEnabled: true,
            emailCampaign: {
              select: {
                id: true,
                name: true,
                bisonCampaignId: true,
                responseMode: true,
                autoSendConfidenceThreshold: true,
                autoSendSkipHumanReview: true,
                autoSendScheduleMode: true,
                autoSendCustomSchedule: true,
              },
            },
          },
        });
        console.log(`[Email PostProcess] Lead ${lead.id} classified as Blacklist (safety check)`);
      } else {
        // Run AI classification
        const analysis = await analyzeInboundEmailReply({
          clientId: client.id,
          leadId: lead.id,
          clientName: client.name,
          lead: {
            first_name: lead.firstName ?? null,
            last_name: lead.lastName ?? null,
            email: lead.email ?? null,
            time_received: message.sentAt?.toISOString() ?? null,
          },
          subject,
          body_text: message.rawText ?? null,
          provider_cleaned_text: inboundReplyOnly || inboundText,
          entire_conversation_thread_html: message.rawHtml ?? null,
          automated_reply: null,
          conversation_transcript: transcript,
        });

        let newSentimentTag: SentimentTag;
        if (analysis) {
          newSentimentTag = mapEmailInboxClassificationToSentimentTag(analysis.classification);
        } else {
          // Fallback to simpler classifier
          newSentimentTag = await classifySentiment(transcript, { clientId: client.id, leadId: lead.id });
        }

        const newStatus = SENTIMENT_TO_STATUS[newSentimentTag] || "new";

        lead = await prisma.lead.update({
          where: { id: lead.id },
          data: { sentimentTag: newSentimentTag, status: newStatus },
          select: {
            id: true,
            clientId: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            linkedinUrl: true,
            timezone: true,
            emailBisonLeadId: true,
            sentimentTag: true,
            autoReplyEnabled: true,
            emailCampaign: {
              select: {
                id: true,
                name: true,
                bisonCampaignId: true,
                responseMode: true,
                autoSendConfidenceThreshold: true,
                autoSendSkipHumanReview: true,
                autoSendScheduleMode: true,
                autoSendCustomSchedule: true,
              },
            },
          },
        });
        console.log(`[Email PostProcess] Lead ${lead.id} AI classified as ${newSentimentTag}`);

        // Compliance: if AI classified as Automated Reply, reject any pending drafts
        if (newSentimentTag === "Automated Reply" || newSentimentTag === "Blacklist") {
          await prisma.aIDraft.updateMany({
            where: { leadId: lead.id, status: "pending" },
            data: { status: "rejected" },
          });
        }
      }
    } catch (error) {
      console.error(`[Email PostProcess] AI classification failed for lead ${lead.id}:`, error);
      // Continue with existing sentiment - don't block enrichment/draft on classification failure
    }
  }

  notifyOnLeadSentimentChange({
    clientId: client.id,
    leadId: lead.id,
    previousSentimentTag: previousSentiment,
    newSentimentTag: lead.sentimentTag,
    messageId: message.id,
    latestInboundText: inboundReplyOnly || inboundText,
  }).catch(() => undefined);

  upsertLeadCrmRowOnInterest({
    leadId: lead.id,
    messageId: message.id,
    messageSentAt: message.sentAt ?? new Date(),
    channel: message.channel,
    sentimentTag: lead.sentimentTag,
  }).catch((error) => {
    console.warn(`[Email PostProcess] Failed to upsert CRM row for lead ${lead.id}:`, error);
  });

  // Round-robin lead assignment (Phase 43)
  // Assign lead to next setter if sentiment is positive and not already assigned
  await maybeAssignLead({
    leadId: lead.id,
    clientId: client.id,
    sentimentTag: lead.sentimentTag,
    channel: "email",
  });

  let timingFollowUpScheduled = false;
  if (lead.sentimentTag === "Follow Up") {
    const timingResult = await scheduleFollowUpTimingFromInbound({
      clientId: client.id,
      leadId: lead.id,
      messageId: message.id,
      messageText: inboundReplyOnly,
      sentimentTag: lead.sentimentTag,
      inboundChannel: "email",
    });
    timingFollowUpScheduled = timingResult.scheduled;
  } else {
    // Legacy deterministic snooze detection remains for non-follow-up sentiment paths.
    const snoozeKeywordHit =
      /\b(after|until|from|in)\b/i.test(inboundReplyOnly) &&
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|q[1-4]|fy\d{2}\s*q[1-4]|\d{4}\s*q[1-4])\b/i.test(
        inboundReplyOnly
      );

    if (snoozeKeywordHit) {
      const tzResult = await ensureLeadTimezone(lead.id);
      const { snoozedUntilUtc, confidence } = detectSnoozedUntilUtcFromMessage({
        messageText: inboundReplyOnly,
        timeZone: tzResult.timezone || "UTC",
      });

      if (snoozedUntilUtc && confidence >= 0.95) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { snoozedUntil: snoozedUntilUtc },
        });
        await pauseFollowUpsUntil(lead.id, snoozedUntilUtc);
      }
    }
  }

  // Auto-booking: only books when the lead clearly accepts one of the offered slots.
  const fallbackAutoBookingContext: AutoBookingContext = {
    schedulingDetected: false,
    schedulingIntent: null,
    clarificationTaskCreated: false,
    clarificationMessage: null,
    followUpTaskCreated: false,
    followUpTaskKind: null,
    qualificationEvaluated: false,
    isQualifiedForBooking: null,
    qualificationReason: null,
    failureReason: "disabled",
    route: null,
    matchStrategy: null,
  };

  const autoBook: {
    booked: boolean;
    appointmentId?: string;
    error?: string;
    context: AutoBookingContext;
  } = inboundReplyOnly
    ? await processMessageForAutoBooking(lead.id, inboundReplyOnly, {
        channel: "email",
        messageId: message.id,
        sentimentTag: lead.sentimentTag,
      })
    : {
        booked: false as const,
        context: fallbackAutoBookingContext,
      };

  // Enrichment sequence.

  // STEP 1: Extract contact info from message content FIRST.
  const messageExtraction = extractContactFromMessageContent(fullEmailBody);
  if (messageExtraction.foundInMessage) {
    const currentLead = await prisma.lead.findUnique({ where: { id: lead.id } });
    const messageUpdates: Record<string, unknown> = {};

    if (messageExtraction.phone && !currentLead?.phone) {
      messageUpdates.phone = toStoredPhone(messageExtraction.phone) || messageExtraction.phone;
      console.log(`[Enrichment] Found phone in message for lead ${lead.id}: ${messageExtraction.phone}`);
    }
    if (messageExtraction.linkedinUrl) {
      const linkedInUpdates = buildLinkedInFieldUpdates({
        currentProfileUrl: currentLead?.linkedinUrl,
        currentCompanyUrl: currentLead?.linkedinCompanyUrl,
        incomingUrl: messageExtraction.linkedinUrl,
      });
      Object.assign(messageUpdates, linkedInUpdates);
      const classified = classifyLinkedInUrl(messageExtraction.linkedinUrl);
      console.log(
        `[Enrichment] Found LinkedIn in message for lead ${lead.id}: ${
          classified.profileUrl || classified.companyUrl || "unclassified"
        }`
      );
    }

    if (Object.keys(messageUpdates).length > 0) {
      messageUpdates.enrichmentSource = "message_content";
      messageUpdates.enrichedAt = new Date();
      await prisma.lead.update({
        where: { id: lead.id },
        data: messageUpdates,
      });
      console.log(`[Enrichment] Updated lead ${lead.id} from message content`);
    }
  }

  // STEP 2: EmailBison custom variables.
  let emailBisonData: EmailBisonEnrichmentData | undefined;
  if (lead.emailBisonLeadId && client.emailBisonApiKey) {
    const enrichResult = await enrichLeadFromEmailBison(
      lead.id,
      lead.emailBisonLeadId,
      client.emailBisonApiKey,
      emailBisonBaseHost
    );
    emailBisonData = enrichResult.clayData;
  }

  // STEP 3: Signature extraction.
  const leadFullName = `${lead.firstName || ""} ${lead.lastName || ""}`.trim() || "Lead";
  await enrichLeadFromSignature({
    clientId: client.id,
    leadId: lead.id,
    leadName: leadFullName,
    leadEmail: lead.email || "",
    emailBody: fullEmailBody,
  });

  await ensureCallRequestedTask({ leadId: lead.id, latestInboundText: inboundText }).catch(() => undefined);
  await handleLeadSchedulerLinkIfPresent({ leadId: lead.id, latestInboundText: inboundText }).catch(() => undefined);

  let actionSignals = EMPTY_ACTION_SIGNAL_RESULT;
  let actionSignalCallRequested = false;
  let actionSignalExternalCalendar = false;
  let actionSignalRouteSummary: string | null = null;
  try {
    if (isPositiveSentiment(lead.sentimentTag)) {
      const workspaceBookingLink = await resolveBookingLink(client.id, null)
        .then((result) => result.bookingLink)
        .catch(() => null);
      actionSignals = await detectActionSignals({
        strippedText: inboundReplyOnly,
        fullText: fullEmailBody,
        sentimentTag: lead.sentimentTag,
        workspaceBookingLink,
        clientId: client.id,
        leadId: lead.id,
        channel: "email",
        provider: "emailbison",
        aiRouteBookingProcessEnabled: client.settings?.aiRouteBookingProcessEnabled ?? true,
      });
      actionSignalCallRequested = hasActionSignal(actionSignals, "call_requested");
      actionSignalExternalCalendar = hasActionSignal(actionSignals, "book_on_external_calendar");
      actionSignalRouteSummary = buildActionSignalsGateSummary(actionSignals);
      if (actionSignals.signals.length > 0) {
        console.log("[Email PostProcess] Action signals:", actionSignals.signals.map((signal) => signal.type).join(", "));
        notifyActionSignals({
          clientId: client.id,
          leadId: lead.id,
          messageId: message.id,
          signals: actionSignals.signals,
          latestInboundText: inboundReplyOnly || inboundText,
          route: actionSignals.route,
        }).catch((error) => console.warn("[Email PostProcess] Action signal notify failed:", error));
      }

      // If the lead asked for a call but we don't have a phone number, try to hydrate it (then Clay if needed).
      if (actionSignalCallRequested && !(lead.phone || "").trim()) {
        enrichPhoneThenSyncToGhl(lead.id, {
          includeSignatureAi: false,
          triggerReason: "call_intent",
          triggerChannel: "email",
        }).catch(() => undefined);
      }
    }
  } catch (error) {
    console.warn("[Email PostProcess] Action signal detection failed (non-fatal):", error);
  }

  // If the lead is a positive reply, ensure they exist in GHL for SMS syncing.
  if (isPositiveSentiment(lead.sentimentTag)) {
    try {
      const ensureResult = await ensureGhlContactIdForLead(lead.id, { allowCreateWithoutPhone: true });
      if (!ensureResult.success && ensureResult.error) {
        console.log(`[GHL Contact] Lead ${lead.id}: ${ensureResult.error}`);
      }

      const sync = await syncGhlContactPhoneForLead(lead.id).catch((err) => ({
        success: false,
        updated: false,
        error: err instanceof Error ? err.message : "Failed to sync phone to GHL",
      }));
      if (!sync.success) {
        console.log(`[GHL Contact] Phone sync for lead ${lead.id}: ${sync.error || "unknown error"}`);
      }
    } catch (error) {
      console.error(`[GHL Contact] Failed to ensure contact for lead ${lead.id}:`, error);
    }
  }

  // Resume any follow-ups that were paused waiting for enrichment.
  await resumeAwaitingEnrichmentFollowUpsForLead(lead.id).catch(() => undefined);

  // STEP 4: Clay enrichment if still missing.
  await triggerClayEnrichmentIfNeeded({
    leadId: lead.id,
    sentimentTag: lead.sentimentTag,
    emailBisonData,
  });

  // Draft generation (skip bounce emails and auto-booked appointments).
  const schedulingHandled = Boolean(autoBook.context.followUpTaskCreated || timingFollowUpScheduled);
  if (schedulingHandled) {
    console.log("[Email PostProcess] Skipping draft generation; scheduling follow-up task already created by auto-booking");
    if (actionSignals.signals.length === 0) {
      notifyDraftSkipForOps({
        clientId: client.id,
        leadId: lead.id,
        messageId: message.id,
        sentimentTag: lead.sentimentTag,
        reason: "scheduling_followup_task",
      }).catch((error) => console.warn("[Email PostProcess] Draft-skip notify failed:", error));
    }
  }

  if (!autoBook.booked && !schedulingHandled && lead.sentimentTag && shouldGenerateDraft(lead.sentimentTag, lead.email)) {
    const messages = await prisma.message.findMany({
      where: { leadId: lead.id },
      orderBy: { sentAt: "asc" },
      take: 80,
      select: {
        sentAt: true,
        channel: true,
        direction: true,
        body: true,
        subject: true,
      },
    });

    const transcript = buildSentimentTranscriptFromMessages(messages);
    const subject = message.subject ?? null;
    const latestInbound = `Subject: ${subject ?? ""}\n\n${inboundText}`;

    // Hard safety: don’t draft for opt-outs/bounces even if sentiment is stale.
    const combined = `Subject: ${subject ?? ""} | ${inboundText}`;
    const mustBlacklist = isOptOutText(combined) || detectBounce([{ body: combined, direction: "inbound", channel: "email" }]);
    if (!mustBlacklist) {
      let leadPhoneOnFileForCallPolicy = Boolean((lead.phone || "").trim());
      if (actionSignalCallRequested && !leadPhoneOnFileForCallPolicy) {
        // Best-effort: signature extraction may have enriched the phone after the lead record was loaded.
        leadPhoneOnFileForCallPolicy = await prisma.lead
          .findUnique({ where: { id: lead.id }, select: { phone: true } })
          .then((row) => Boolean((row?.phone || "").trim()))
          .catch(() => leadPhoneOnFileForCallPolicy);
      }

      const suppressDraftForCallRequestedNoPhone =
        actionSignalCallRequested && !leadPhoneOnFileForCallPolicy;

      if (suppressDraftForCallRequestedNoPhone) {
        console.log("[Email PostProcess] Skipping draft generation; call requested but no phone on file (notify-only policy)");
        if (actionSignals.signals.length === 0) {
          notifyDraftSkipForOps({
            clientId: client.id,
            leadId: lead.id,
            messageId: message.id,
            sentimentTag: lead.sentimentTag,
            reason: "call_requested_no_phone",
          }).catch((error) => console.warn("[Email PostProcess] Draft-skip notify failed:", error));
        }
      } else {
        const draftResult = await generateResponseDraft(lead.id, transcript || latestInbound, lead.sentimentTag, "email", {
          triggerMessageId: message.id,
          autoBookingContext: autoBook.context?.schedulingDetected ? autoBook.context : null,
          actionSignals: actionSignals.signals.length > 0 || actionSignals.route ? actionSignals : null,
        });

        if (draftResult.success && draftResult.draftId && draftResult.content) {
          const draftId = draftResult.draftId;
          const draftContent = draftResult.content;
          const workspaceBookingLink = await resolveBookingLink(client.id, null)
            .then((result) => result.bookingLink)
            .catch(() => null);

          let autoReplySent = false;
          const leadAutoSendContext = await prisma.lead.findUnique({
            where: { id: lead.id },
            select: {
              offeredSlots: true,
              externalSchedulingLink: true,
            },
          });
          const offeredSlots = (() => {
            if (!leadAutoSendContext?.offeredSlots) return [];
            try {
              const parsed = JSON.parse(leadAutoSendContext.offeredSlots);
              return Array.isArray(parsed) ? parsed : [];
            } catch {
              return [];
            }
          })();

          const autoSendResult = await executeAutoSend({
            clientId: client.id,
            leadId: lead.id,
            triggerMessageId: message.id,
            draftId,
            draftContent,
            draftPipelineRunId: draftResult.runId ?? null,
            channel: "email",
            latestInbound: inboundText,
            subject,
            conversationHistory: transcript,
            sentimentTag: lead.sentimentTag,
            messageSentAt: message.sentAt ?? new Date(),
            automatedReply: null,
            leadFirstName: lead.firstName,
            leadLastName: lead.lastName,
            leadEmail: lead.email,
            leadPhoneOnFile: leadPhoneOnFileForCallPolicy,
            leadTimezone: lead.timezone ?? null,
            offeredSlots,
            bookingLink: workspaceBookingLink,
            leadSchedulerLink: leadAutoSendContext?.externalSchedulingLink ?? null,
            actionSignalCallRequested,
            actionSignalExternalCalendar,
            actionSignalRouteSummary,
            emailCampaign: lead.emailCampaign,
            autoReplyEnabled: lead.autoReplyEnabled,
            workspaceSettings: client.settings ?? null,
            validateImmediateSend: true,
            includeDraftPreviewInSlack: true,
          });

          switch (autoSendResult.outcome.action) {
            case "send_immediate": {
              autoReplySent = true;
              break;
            }
            case "send_delayed": {
              console.log(
                `[Auto-Send] Scheduled delayed send for draft ${draftId}, runAt: ${autoSendResult.outcome.runAt.toISOString()}`
              );
              break;
            }
            case "needs_review": {
              if (!autoSendResult.outcome.slackDm.sent && !autoSendResult.outcome.slackDm.skipped) {
                console.error(
                  `[Slack DM] Failed to notify Slack reviewers for draft ${draftId}: ${autoSendResult.outcome.slackDm.error || "unknown error"}`
                );
              }
              break;
            }
            case "skip": {
              if (autoSendResult.telemetry.delayedScheduleSkipReason) {
                console.log(`[Auto-Send] Delayed send not scheduled: ${autoSendResult.telemetry.delayedScheduleSkipReason}`);
              } else if (
                autoSendResult.telemetry.immediateValidationSkipReason ||
                autoSendResult.telemetry.immediateValidationSkipReason === ""
              ) {
                console.log(
                  `[Auto-Send] Skipping immediate send for draft ${draftId}: ${autoSendResult.telemetry.immediateValidationSkipReason || "unknown_reason"}`
                );
              }
              break;
            }
            case "error": {
              const prefix = autoSendResult.mode === "LEGACY_AUTO_REPLY" ? "Auto-Reply" : "Auto-Send";
              console.error(`[${prefix}] Failed to send draft ${draftId}: ${autoSendResult.outcome.error}`);
              break;
            }
          }

          if (autoReplySent) {
            console.log(`[Email PostProcess] Auto-replied for lead ${lead.id} (draft ${draftId})`);
          }
        }
      }
    }
  }

  // Enqueue lead scoring job (non-blocking, fire-and-forget)
  // Score the lead based on conversation after all other processing is done
  try {
    await enqueueLeadScoringJob({
      clientId: client.id,
      leadId: lead.id,
      messageId: message.id,
    });
  } catch (error) {
    // Don't fail the job if scoring enqueue fails
    console.error(`[Email PostProcess] Failed to enqueue lead scoring job for lead ${lead.id}:`, error);
  }
}
