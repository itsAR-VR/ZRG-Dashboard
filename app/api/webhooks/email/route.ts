import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildSentimentTranscriptFromMessages, classifySentiment, SENTIMENT_TO_STATUS, isPositiveSentiment, type SentimentTag } from "@/lib/sentiment";
import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { approveAndSendDraft } from "@/actions/message-actions";
import { findOrCreateLead } from "@/lib/lead-matching";
import { createEmailBisonLead, fetchEmailBisonLead, fetchEmailBisonSentEmails, getCustomVariable } from "@/lib/emailbison-api";
import { extractContactFromSignature, extractContactFromMessageContent } from "@/lib/signature-extractor";
import { normalizeLinkedInUrl } from "@/lib/linkedin-utils";
import { triggerEnrichmentForLead } from "@/lib/clay-api";
import { normalizePhone } from "@/lib/lead-matching";
import { autoStartMeetingRequestedSequenceIfEligible } from "@/lib/followup-automation";
import { ensureGhlContactIdForLead } from "@/lib/ghl-contacts";

// =============================================================================
// Type Definitions
// =============================================================================

type InboxxiaWebhook = {
  event?: {
    type?: string;
    name?: string;
    instance_url?: string;
    workspace_id?: number | string;
    workspace_name?: string;
  };
  data?: {
    campaign?: {
      id?: number | string;
      name?: string;
    };
    campaign_event?: {
      id?: number | string;
      type?: string;
      created_at?: string;
      created_at_local?: string;
      local_timezone?: string;
    };
    lead?: {
      id?: number | string;
      email?: string;
      first_name?: string | null;
      last_name?: string | null;
      status?: string | null;
      company?: string | null;
      title?: string | null;
    } | null;
    reply?: {
      id?: number | string;
      uuid?: string | null;
      email_subject?: string | null;
      from_email_address?: string | null;
      from_name?: string | null;
      to?: { address: string; name: string | null }[] | null;
      cc?: { address: string; name: string | null }[] | null;
      bcc?: { address: string; name: string | null }[] | null;
      html_body?: string | null;
      text_body?: string | null;
      date_received?: string | null;
      created_at?: string | null;
      automated_reply?: boolean | null;
      interested?: boolean | null;
      type?: string | null;
      folder?: string | null;
    };
    scheduled_email?: {
      id?: number | string;
      lead_id?: number | string;
      sequence_step_id?: number | string;
      email_subject?: string | null;
      email_body?: string | null;
      status?: string | null;
      sent_at?: string | null;
      scheduled_date_local?: string | null;
      raw_message_id?: string | null;
    };
    sender_email?: {
      id?: number | string;
      email?: string;
      name?: string | null;
    };
  };
};

type Client = {
  id: string;
  name: string;
  ghlLocationId: string;
  ghlPrivateKey: string;
  emailBisonApiKey: string | null;
  emailBisonWorkspaceId: string | null;
  userId: string;
};

// =============================================================================
// Helper Functions
// =============================================================================

function stripQuotedSections(text: string): string {
  let result = text.split("\n").filter((line) => !line.trim().startsWith(">")).join("\n");

  const replyHeaderIndex = result.search(/On .*wrote:/i);
  if (replyHeaderIndex !== -1) {
    result = result.slice(0, replyHeaderIndex);
  }

  const signatureIndex = result.search(/^\s*--/m);
  if (signatureIndex !== -1) {
    result = result.slice(0, signatureIndex);
  }

  return result.trim();
}

function htmlToPlain(html: string): string {
  return stripQuotedSections(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  );
}

function cleanEmailBody(htmlBody?: string | null, textBody?: string | null): { cleaned: string; rawText?: string; rawHtml?: string } {
  const rawText = textBody ?? undefined;
  const rawHtml = htmlBody ?? undefined;

  const source = textBody || htmlBody || "";
  if (!source.trim()) {
    return { cleaned: "", rawText, rawHtml };
  }

  const cleaned = textBody
    ? stripQuotedSections(textBody)
    : htmlToPlain(htmlBody || "");

  return {
    cleaned: cleaned.trim(),
    rawText,
    rawHtml,
  };
}

async function findClient(request: NextRequest, payload?: InboxxiaWebhook): Promise<Client | null> {
  const url = new URL(request.url);
  const clientIdParam = url.searchParams.get("clientId");

  // Strategy 1: Look up by clientId query param (explicit, most reliable)
  if (clientIdParam) {
    const client = await prisma.client.findUnique({ where: { id: clientIdParam } });
    if (client) {
      console.log(`[Email Webhook] Client found via clientId param: ${client.name} (${client.id})`);
      return client;
    }
    console.warn(`[Email Webhook] clientId param provided but no client found: ${clientIdParam}`);
  }

  // Strategy 2: Look up by EmailBison workspace_id from payload
  const workspaceId = payload?.event?.workspace_id;
  if (workspaceId) {
    const workspaceIdStr = String(workspaceId);
    const client = await prisma.client.findUnique({
      where: { emailBisonWorkspaceId: workspaceIdStr },
    });
    if (client) {
      console.log(`[Email Webhook] Client found via workspace_id: ${client.name} (${client.id})`);
      return client;
    }
    console.warn(`[Email Webhook] workspace_id in payload but no matching client: ${workspaceIdStr}`);
  }

  // No client found - log diagnostic info
  console.error(`[Email Webhook] Client lookup failed. clientId param: ${clientIdParam || "none"}, workspace_id: ${workspaceId || "none"}`);
  return null;
}

async function triggerSlackNotification(message: string) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
  } catch (error) {
    console.error("[Slack] Failed to send notification:", error);
  }
}

/**
 * Result from EmailBison enrichment including data for Clay
 */
interface EmailBisonEnrichmentResult {
  linkedinUrl?: string;
  phone?: string;
  // Additional data for Clay enrichment
  clayData: EmailBisonEnrichmentData;
}

/**
 * Fetch EmailBison lead data and extract LinkedIn URL, phone, and other data from custom variables
 * Updates lead with enriched data if found
 * Returns additional data needed for Clay enrichment
 */
async function enrichLeadFromEmailBison(
  leadId: string,
  emailBisonLeadId: string,
  apiKey: string
): Promise<EmailBisonEnrichmentResult> {
  const result: EmailBisonEnrichmentResult = {
    clayData: {},
  };

  try {
    const leadDetails = await fetchEmailBisonLead(apiKey, emailBisonLeadId);

    if (!leadDetails.success || !leadDetails.data) {
      console.log(`[EmailBison Enrichment] Failed to fetch lead ${emailBisonLeadId}: ${leadDetails.error}`);
      return result;
    }

    const leadData = leadDetails.data;
    const customVars = leadData.custom_variables;

    // Extract LinkedIn URL from custom variables
    const linkedinUrlRaw = getCustomVariable(customVars, "linkedin url") ||
      getCustomVariable(customVars, "linkedin_url") ||
      getCustomVariable(customVars, "linkedinurl");

    if (linkedinUrlRaw) {
      const normalized = normalizeLinkedInUrl(linkedinUrlRaw);
      if (normalized) {
        result.linkedinUrl = normalized;
        result.clayData.linkedInProfile = normalized;
        console.log(`[EmailBison Enrichment] Found LinkedIn URL for lead ${leadId}: ${normalized}`);
      }
    }

    // Extract phone from custom variables
    const phoneRaw = getCustomVariable(customVars, "phone") ||
      getCustomVariable(customVars, "mobile") ||
      getCustomVariable(customVars, "phone number");

    if (phoneRaw && phoneRaw !== "-") {
      const normalized = normalizePhone(phoneRaw);
      if (normalized) {
        result.phone = normalized;
        result.clayData.existingPhone = normalized;
        console.log(`[EmailBison Enrichment] Found phone for lead ${leadId}: ${normalized}`);
      }
    }

    // Extract additional data for Clay enrichment
    // Company name from main lead data
    if (leadData.company) {
      result.clayData.companyName = leadData.company;
    }

    // Company domain from 'website' custom variable (full URL)
    const website = getCustomVariable(customVars, "website");
    if (website && website !== "-") {
      result.clayData.companyDomain = website;
    }

    // State from 'company state' custom variable
    const companyState = getCustomVariable(customVars, "company state");
    if (companyState && companyState !== "-") {
      result.clayData.state = companyState;
    }

    // Update lead with enriched data
    if (result.linkedinUrl || result.phone) {
      const updates: Record<string, unknown> = {};

      // Get current lead to check what's missing
      const currentLead = await prisma.lead.findUnique({ where: { id: leadId } });

      if (result.linkedinUrl && !currentLead?.linkedinUrl) {
        updates.linkedinUrl = result.linkedinUrl;
      }
      if (result.phone && !currentLead?.phone) {
        updates.phone = result.phone;
      }

      if (Object.keys(updates).length > 0) {
        updates.enrichmentStatus = "enriched";
        updates.enrichmentSource = "emailbison";
        updates.enrichedAt = new Date();

        await prisma.lead.update({
          where: { id: leadId },
          data: updates,
        });
        console.log(`[EmailBison Enrichment] Updated lead ${leadId} with EmailBison data`);
      }
    }
  } catch (error) {
    console.error(`[EmailBison Enrichment] Error enriching lead ${leadId}:`, error);
  }

  return result;
}

/**
 * Extract contact info from email signature using AI
 * Only updates lead if extraction is confident and from actual lead
 */
async function enrichLeadFromSignature(
  leadId: string,
  leadName: string,
  leadEmail: string,
  emailBody: string
): Promise<{ phone?: string; linkedinUrl?: string }> {
  const result: { phone?: string; linkedinUrl?: string } = {};

  try {
    // Get current lead to check what's missing
    const currentLead = await prisma.lead.findUnique({ where: { id: leadId } });

    // Only extract if lead is missing phone or LinkedIn
    if (currentLead?.phone && currentLead?.linkedinUrl) {
      console.log(`[Signature Extraction] Lead ${leadId} already has phone and LinkedIn, skipping`);
      return result;
    }

    const extraction = await extractContactFromSignature(emailBody, leadName, leadEmail);

    // Only use extraction if from actual lead and high confidence
    if (!extraction.isFromLead) {
      console.log(`[Signature Extraction] Email not from lead (possibly assistant), skipping`);
      return result;
    }

    if (extraction.confidence === "low") {
      console.log(`[Signature Extraction] Low confidence extraction, skipping`);
      return result;
    }

    const updates: Record<string, unknown> = {};

    // Extract phone if missing
    if (!currentLead?.phone && extraction.phone) {
      updates.phone = extraction.phone;
      result.phone = extraction.phone;
      console.log(`[Signature Extraction] Extracted phone for lead ${leadId}: ${extraction.phone}`);
    }

    // Extract LinkedIn if missing
    if (!currentLead?.linkedinUrl && extraction.linkedinUrl) {
      updates.linkedinUrl = extraction.linkedinUrl;
      result.linkedinUrl = extraction.linkedinUrl;
      console.log(`[Signature Extraction] Extracted LinkedIn for lead ${leadId}: ${extraction.linkedinUrl}`);
    }

    if (Object.keys(updates).length > 0) {
      updates.enrichmentStatus = "enriched";
      updates.enrichmentSource = "signature";
      updates.enrichedAt = new Date();

      await prisma.lead.update({
        where: { id: leadId },
        data: updates,
      });
      console.log(`[Signature Extraction] Updated lead ${leadId} from signature`);
    }
  } catch (error) {
    console.error(`[Signature Extraction] Error extracting from signature for lead ${leadId}:`, error);
  }

  return result;
}

/**
 * Data extracted from EmailBison for Clay enrichment
 */
interface EmailBisonEnrichmentData {
  companyName?: string;
  companyDomain?: string;  // From 'website' custom var
  state?: string;          // From 'company state' custom var
  linkedInProfile?: string; // From 'linkedin url' custom var
  existingPhone?: string;  // From 'phone' custom var (to skip enrichment if exists)
}

/**
 * Trigger Clay enrichment for leads missing LinkedIn or phone
 * Only for email leads (not SMS-only) with POSITIVE sentiment
 * Uses smart logic to skip enrichment if valid data already exists in EmailBison
 * 
 * @param leadId - The lead ID to enrich
 * @param sentimentTag - The lead's current sentiment (enrichment only triggers for positive sentiments)
 * @param emailBisonData - Optional data from EmailBison for additional context
 */
async function triggerClayEnrichmentIfNeeded(
  leadId: string,
  sentimentTag: string | null,
  emailBisonData?: EmailBisonEnrichmentData
): Promise<void> {
  try {
    // Only enrich leads with positive sentiment
    // This saves costs by not enriching leads who are not interested
    if (!isPositiveSentiment(sentimentTag)) {
      console.log(`[Clay Enrichment] Skipping lead ${leadId} - sentiment "${sentimentTag}" is not positive`);
      return;
    }

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });

    if (!lead || !lead.email) {
      // SMS-only lead or invalid, skip enrichment
      return;
    }

    // Skip if already enriched or processing
    if (lead.enrichmentStatus && lead.enrichmentStatus !== "pending") {
      return;
    }

    // Determine what's missing
    // For LinkedIn: check lead record
    const missingLinkedIn = !lead.linkedinUrl && !emailBisonData?.linkedInProfile;

    // For phone: check lead record AND EmailBison custom var
    // Skip phone enrichment if we already have a valid phone from EmailBison
    const existingPhone = lead.phone || emailBisonData?.existingPhone;
    const hasValidPhone = existingPhone && normalizePhone(existingPhone);
    const missingPhone = !hasValidPhone;

    if (!missingLinkedIn && !missingPhone) {
      // Nothing to enrich
      await prisma.lead.update({
        where: { id: leadId },
        data: { enrichmentStatus: "not_needed" },
      });
      return;
    }

    // Mark as pending and trigger enrichment (with timestamp for timeout tracking)
    await prisma.lead.update({
      where: { id: leadId },
      data: { 
        enrichmentStatus: "pending",
        enrichmentLastRetry: new Date(), // Initialize for follow-up engine timeout calculations
      },
    });

    // Build the full enrichment request with all available data
    const fullName = `${lead.firstName || ""} ${lead.lastName || ""}`.trim();

    const enrichmentRequest = {
      leadId: lead.id,
      emailAddress: lead.email,
      firstName: lead.firstName || undefined,
      lastName: lead.lastName || undefined,
      fullName: fullName || undefined,
      companyName: emailBisonData?.companyName,
      companyDomain: emailBisonData?.companyDomain,
      state: emailBisonData?.state,
      linkedInProfile: emailBisonData?.linkedInProfile || lead.linkedinUrl || undefined,
    };

    await triggerEnrichmentForLead(
      enrichmentRequest,
      missingLinkedIn,
      missingPhone
    );

    console.log(`[Clay Enrichment] Triggered for lead ${leadId} (linkedin: ${missingLinkedIn}, phone: ${missingPhone})`);
  } catch (error) {
    console.error(`[Clay Enrichment] Error triggering enrichment for lead ${leadId}:`, error);
  }
}

/**
 * Detect if an email is a bounce notification based on sender
 */
function isBounceEmail(fromEmail: string | null | undefined): boolean {
  if (!fromEmail) return false;
  const lowerEmail = fromEmail.toLowerCase();
  return (
    lowerEmail.includes("mailer-daemon") ||
    lowerEmail.includes("postmaster") ||
    lowerEmail.includes("mail-delivery") ||
    lowerEmail.includes("maildelivery") ||
    lowerEmail.includes("noreply") && lowerEmail.includes("google") ||
    lowerEmail.startsWith("bounce")
  );
}

/**
 * Parse bounce email body to extract the original recipient email address
 * Handles various bounce formats from different mail providers
 */
function parseBounceRecipient(htmlBody: string | null | undefined, textBody: string | null | undefined): string | null {
  const body = textBody || htmlBody || "";
  if (!body) return null;

  // Common bounce patterns (case-insensitive)
  const patterns = [
    // Google/Gmail bounces
    /wasn't delivered to\s+([^\s<]+@[^\s>]+)/i,
    /delivery to\s+([^\s<]+@[^\s>]+)\s+failed/i,
    /couldn't be delivered to\s+([^\s<]+@[^\s>]+)/i,
    /message wasn't delivered to\s+([^\s<]+@[^\s>]+)/i,
    // Generic SMTP bounces
    /550[- ]\d+\.\d+\.\d+\s+<?([^\s<>]+@[^\s<>]+)>?/i,
    /recipient[:\s]+<?([^\s<>]+@[^\s<>]+)>?/i,
    /failed recipient[:\s]+<?([^\s<>]+@[^\s<>]+)>?/i,
    // Microsoft/Outlook bounces
    /Delivery has failed to these recipients[^<]*<?([^\s<>]+@[^\s<>]+)>?/i,
    /couldn't reach\s+<?([^\s<>]+@[^\s<>]+)>?/i,
    // Amazon SES bounces
    /failed:?\s+<?([^\s<>]+@[^\s<>]+)>?/i,
    // Catch-all pattern for email in angle brackets after error keywords
    /(?:undeliverable|bounced|failed|rejected)[^<]*<([^\s<>]+@[^\s<>]+)>/i,
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match && match[1]) {
      const email = match[1].trim().toLowerCase();
      // Validate it looks like an email and isn't a daemon address
      if (email.includes("@") && !isBounceEmail(email)) {
        console.log(`[Bounce Parser] Found recipient: ${email}`);
        return email;
      }
    }
  }

  console.log("[Bounce Parser] Could not extract recipient from bounce body");
  return null;
}

async function upsertCampaign(client: Client, campaignData?: { id?: number | string; name?: string }) {
  if (!campaignData?.id) return null;

  const bisonCampaignId = String(campaignData.id);
  return prisma.emailCampaign.upsert({
    where: {
      clientId_bisonCampaignId: {
        clientId: client.id,
        bisonCampaignId,
      },
    },
    update: {
      name: campaignData.name || "Inboxxia Campaign",
    },
    create: {
      clientId: client.id,
      bisonCampaignId,
      name: campaignData.name || "Inboxxia Campaign",
    },
  });
}

async function upsertLead(
  client: Client,
  leadData: { id?: number | string; email?: string; first_name?: string | null; last_name?: string | null; status?: string | null } | null,
  emailCampaignId: string | null,
  senderAccountId: string | undefined,
  fromEmail?: string
) {
  const email = fromEmail || leadData?.email;
  if (!email) return null;

  const emailBisonLeadId = leadData?.id ? String(leadData.id) : undefined;

  // Use findOrCreateLead for cross-channel deduplication
  // This will match by email OR phone to find existing leads from SMS channel
  const result = await findOrCreateLead(
    client.id,
    {
      email,
      firstName: leadData?.first_name || null,
      lastName: leadData?.last_name || null,
    },
    { emailBisonLeadId },
    { emailCampaignId, senderAccountId }
  );

  console.log(`[Email Webhook] Lead ${result.lead.id}: ${result.isNew ? "NEW" : "EXISTING"} (matched by ${result.matchedBy})`);

  return result.lead;
}

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

async function backfillOutboundEmailMessagesIfMissing(opts: {
  leadId: string;
  emailBisonLeadId: string;
  apiKey: string;
  limit?: number;
}) {
  const limit = opts.limit ?? 12;

  const existingOutboundCount = await prisma.message.count({
    where: {
      leadId: opts.leadId,
      channel: "email",
      direction: "outbound",
    },
  });

  if (existingOutboundCount > 0) return;

  const sentEmailsResult = await fetchEmailBisonSentEmails(opts.apiKey, opts.emailBisonLeadId);
  if (!sentEmailsResult.success || !sentEmailsResult.data || sentEmailsResult.data.length === 0) return;

  const sorted = [...sentEmailsResult.data].sort((a, b) => {
    const aTime = parseDate(a.sent_at, a.scheduled_date_local).getTime();
    const bTime = parseDate(b.sent_at, b.scheduled_date_local).getTime();
    return aTime - bTime;
  });

  const tail = sorted.slice(Math.max(0, sorted.length - limit));
  const data: Prisma.MessageCreateManyInput[] = tail
    .map((sentEmail): Prisma.MessageCreateManyInput | null => {
      const cleaned = cleanEmailBody(sentEmail.email_body, null);
      const body = cleaned.cleaned || sentEmail.email_subject || "";
      if (!body.trim()) return null;

      return {
        inboxxiaScheduledEmailId: String(sentEmail.id),
        channel: "email",
        source: "inboxxia_campaign",
        body,
        rawHtml: cleaned.rawHtml ?? null,
        subject: sentEmail.email_subject ?? null,
        isRead: true,
        direction: "outbound",
        leadId: opts.leadId,
        sentAt: parseDate(sentEmail.sent_at, sentEmail.scheduled_date_local),
      };
    })
    .filter((record): record is Prisma.MessageCreateManyInput => record !== null);

  if (data.length === 0) return;

  await prisma.message.createMany({
    data,
    skipDuplicates: true,
  });
}

// =============================================================================
// Event Handlers
// =============================================================================

async function handleLeadReplied(request: NextRequest, payload: InboxxiaWebhook): Promise<NextResponse> {
  const data = payload.data;
  const reply = data?.reply;

  if (!reply?.id) {
    return NextResponse.json({ error: "Missing reply.id" }, { status: 400 });
  }

  const client = await findClient(request, payload);
  if (!client) {
    return NextResponse.json({ error: "Client not found for webhook" }, { status: 404 });
  }

  const emailBisonReplyId = String(reply.id);

  // Deduplication check
  const existingMessage = await prisma.message.findUnique({
    where: { emailBisonReplyId },
  });

  if (existingMessage) {
    return NextResponse.json({ success: true, deduped: true, eventType: "LEAD_REPLIED" });
  }

  // Upsert campaign
  const emailCampaign = await upsertCampaign(client, data?.campaign);
  const senderAccountId = data?.sender_email?.id ? String(data.sender_email.id) : undefined;
  const fromEmail = reply.from_email_address || data?.lead?.email;

  if (!fromEmail) {
    return NextResponse.json({ error: "Missing from email" }, { status: 400 });
  }

  // Upsert lead
  const lead = await upsertLead(client, data?.lead ?? null, emailCampaign?.id ?? null, senderAccountId, fromEmail);
  if (!lead) {
    return NextResponse.json({ error: "Failed to create/find lead" }, { status: 500 });
  }

  // Clean and classify email
  const cleaned = cleanEmailBody(reply.html_body, reply.text_body);
  const contentForClassification = cleaned.cleaned || cleaned.rawText || cleaned.rawHtml || "";
  const sentAt = parseDate(reply.date_received, reply.created_at);

  if (client.emailBisonApiKey && lead.emailBisonLeadId) {
    await backfillOutboundEmailMessagesIfMissing({
      leadId: lead.id,
      emailBisonLeadId: lead.emailBisonLeadId,
      apiKey: client.emailBisonApiKey,
    });
  }

  const contextMessages = await prisma.message.findMany({
    where: { leadId: lead.id },
    orderBy: { sentAt: "desc" },
    take: 40,
    select: {
      sentAt: true,
      channel: true,
      direction: true,
      body: true,
      subject: true,
    },
  });

  const transcript = buildSentimentTranscriptFromMessages([
    ...contextMessages.reverse(),
    {
      sentAt,
      channel: "email",
      direction: "inbound",
      body: cleaned.cleaned || contentForClassification,
      subject: reply.email_subject ?? null,
    },
  ]);

  // Track if we're clearing a "Follow Up" or "Snoozed" tag (for logging)
  const previousSentiment = lead.sentimentTag;
  const wasFollowUp = previousSentiment === "Follow Up" || previousSentiment === "Snoozed";

  // If Inboxxia already marked as interested, use that; otherwise classify with AI
  // Note: Any inbound reply will reclassify sentiment, clearing "Follow Up" or "Snoozed" tags
  let sentimentTag: SentimentTag;
  if (reply.interested === true) {
    sentimentTag = "Interested";
  } else {
    sentimentTag = await classifySentiment(transcript);
  }

  // Log when "Follow Up" or "Snoozed" tag is being cleared by a reply
  if (wasFollowUp) {
    console.log(`[FOLLOWUP_CLEARED] Lead ${lead.id} replied - clearing "${previousSentiment}" tag, new sentiment: ${sentimentTag}`);
  }

  const leadStatus = SENTIMENT_TO_STATUS[sentimentTag] || lead.status || "new";

  const ccAddresses = reply.cc?.map((entry) => entry.address).filter(Boolean) ?? [];
  const bccAddresses = reply.bcc?.map((entry) => entry.address).filter(Boolean) ?? [];

  // Create inbound message
  await prisma.message.create({
    data: {
      emailBisonReplyId,
      channel: "email",
      source: "zrg", // Inbound replies are processed by ZRG
      body: cleaned.cleaned || contentForClassification,
      rawText: cleaned.rawText ?? null,
      rawHtml: cleaned.rawHtml ?? null,
      subject: reply.email_subject ?? null,
      cc: ccAddresses,
      bcc: bccAddresses,
      isRead: false,
      direction: "inbound",
      leadId: lead.id,
      sentAt,
    },
  });

  // Update lead sentiment/status
  await prisma.lead.update({
    where: { id: lead.id },
    data: { sentimentTag, status: leadStatus },
  });

  await autoStartMeetingRequestedSequenceIfEligible({
    leadId: lead.id,
    previousSentiment,
    newSentiment: sentimentTag,
  });

  if (leadStatus === "meeting-booked") {
    await triggerSlackNotification(
      `Meeting booked via Inboxxia for lead ${lead.email || lead.id} (client ${client.name})`
    );
  }

  // ==========================================================================
  // ENRICHMENT SEQUENCE (in order of priority)
  // 1. Message content extraction (regex) - check if lead shared contact info in message
  // 2. EmailBison custom variables - data from the lead record
  // 3. Signature extraction (AI) - extract from email signature
  // 4. Clay enrichment (external API) - only if still missing data
  // ==========================================================================

  const fullEmailBody = cleaned.rawText || cleaned.rawHtml || cleaned.cleaned || "";

  // STEP 1: Extract contact info from message content FIRST
  // This catches cases where the lead shares their phone/LinkedIn in the message itself
  const messageExtraction = extractContactFromMessageContent(fullEmailBody);
  if (messageExtraction.foundInMessage) {
    const currentLead = await prisma.lead.findUnique({ where: { id: lead.id } });
    const messageUpdates: Record<string, unknown> = {};

    if (messageExtraction.phone && !currentLead?.phone) {
      messageUpdates.phone = messageExtraction.phone;
      console.log(`[Enrichment] Found phone in message for lead ${lead.id}: ${messageExtraction.phone}`);
    }
    if (messageExtraction.linkedinUrl && !currentLead?.linkedinUrl) {
      messageUpdates.linkedinUrl = messageExtraction.linkedinUrl;
      console.log(`[Enrichment] Found LinkedIn in message for lead ${lead.id}: ${messageExtraction.linkedinUrl}`);
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

  // STEP 2: Fetch EmailBison lead data for custom variables (LinkedIn URL, phone)
  // Only if we have an emailBisonLeadId
  let emailBisonData: EmailBisonEnrichmentData | undefined;
  if (lead.emailBisonLeadId && client.emailBisonApiKey) {
    const enrichResult = await enrichLeadFromEmailBison(lead.id, lead.emailBisonLeadId, client.emailBisonApiKey);
    emailBisonData = enrichResult.clayData;
  }

  // STEP 3: Extract contact info from email signature (AI-powered)
  const leadFullName = `${lead.firstName || ""} ${lead.lastName || ""}`.trim() || "Lead";
  await enrichLeadFromSignature(lead.id, leadFullName, fromEmail, fullEmailBody);

  // If the lead is a positive reply and we have a phone, ensure they exist in GHL
  // so SMS history and future messages can be synced.
  if (isPositiveSentiment(sentimentTag)) {
    try {
      const ensureResult = await ensureGhlContactIdForLead(lead.id, { requirePhone: true });
      if (!ensureResult.success && ensureResult.error) {
        console.log(`[GHL Contact] Lead ${lead.id}: ${ensureResult.error}`);
      }
    } catch (error) {
      console.error(`[GHL Contact] Failed to ensure contact for lead ${lead.id}:`, error);
    }
  }

  // STEP 4: Trigger Clay enrichment if still missing LinkedIn or phone after other enrichment
  // Only triggers for positive sentiments (Meeting Requested, Call Requested, Info Requested, Interested)
  // Pass EmailBison data for additional context (company, state, etc.)
  await triggerClayEnrichmentIfNeeded(lead.id, sentimentTag, emailBisonData);

  // Generate AI draft if appropriate (skip bounce emails)
  let draftId: string | undefined;
  let autoReplySent = false;

  if (shouldGenerateDraft(sentimentTag, fromEmail)) {
    const draftResult = await generateResponseDraft(
      lead.id,
      `Subject: ${reply.email_subject ?? ""}\n\n${contentForClassification}`,
      sentimentTag,
      "email"
    );
    if (draftResult.success) {
      draftId = draftResult.draftId;
      console.log(`[LEAD_REPLIED] Generated AI draft: ${draftId}`);

      if (lead.autoReplyEnabled && draftId) {
        console.log(`[Auto-Reply] Auto-approving draft ${draftId} for lead ${lead.id}`);
        const sendResult = await approveAndSendDraft(draftId);
        if (sendResult.success) {
          console.log(`[Auto-Reply] Sent message: ${sendResult.messageId}`);
          autoReplySent = true;
        } else {
          console.error(`[Auto-Reply] Failed to send draft: ${sendResult.error}`);
        }
      }
    }
  }

  console.log(`[LEAD_REPLIED] Lead: ${lead.id}, Sentiment: ${sentimentTag}, Draft: ${draftId || "none"}`);

  return NextResponse.json({
    success: true,
    eventType: "LEAD_REPLIED",
    leadId: lead.id,
    sentimentTag,
    status: leadStatus,
    draftId,
    autoReplySent,
  });
}

async function handleLeadInterested(request: NextRequest, payload: InboxxiaWebhook): Promise<NextResponse> {
  const data = payload.data;
  const reply = data?.reply;

  if (!reply?.id) {
    return NextResponse.json({ error: "Missing reply.id" }, { status: 400 });
  }

  const client = await findClient(request, payload);
  if (!client) {
    return NextResponse.json({ error: "Client not found for webhook" }, { status: 404 });
  }

  const emailBisonReplyId = String(reply.id);

  // Check if message already exists (from LEAD_REPLIED)
  const existingMessage = await prisma.message.findUnique({
    where: { emailBisonReplyId },
    include: { lead: true },
  });

  if (existingMessage) {
    // Message exists - just update lead sentiment to "Interested"
    await prisma.lead.update({
      where: { id: existingMessage.leadId },
      data: {
        sentimentTag: "Interested",
        status: SENTIMENT_TO_STATUS["Interested"] || existingMessage.lead.status,
      },
    });

    try {
      const ensureResult = await ensureGhlContactIdForLead(existingMessage.leadId, { requirePhone: true });
      if (!ensureResult.success && ensureResult.error) {
        console.log(`[GHL Contact] Lead ${existingMessage.leadId}: ${ensureResult.error}`);
      }
    } catch (error) {
      console.error(`[GHL Contact] Failed to ensure contact for lead ${existingMessage.leadId}:`, error);
    }

    // Regenerate AI draft with "Interested" context
    const draftResult = await generateResponseDraft(
      existingMessage.leadId,
      `Subject: ${reply.email_subject ?? ""}\n\n${existingMessage.body}`,
      "Interested",
      "email"
    );

    console.log(`[LEAD_INTERESTED] Updated existing lead ${existingMessage.leadId} to Interested`);

    return NextResponse.json({
      success: true,
      eventType: "LEAD_INTERESTED",
      leadId: existingMessage.leadId,
      updatedExisting: true,
      draftId: draftResult.success ? draftResult.draftId : undefined,
    });
  }

  // Message doesn't exist yet - process like LEAD_REPLIED but with forced "Interested" sentiment
  const emailCampaign = await upsertCampaign(client, data?.campaign);
  const senderAccountId = data?.sender_email?.id ? String(data.sender_email.id) : undefined;
  const fromEmail = reply.from_email_address || data?.lead?.email;

  if (!fromEmail) {
    return NextResponse.json({ error: "Missing from email" }, { status: 400 });
  }

  const lead = await upsertLead(client, data?.lead ?? null, emailCampaign?.id ?? null, senderAccountId, fromEmail);
  if (!lead) {
    return NextResponse.json({ error: "Failed to create/find lead" }, { status: 500 });
  }

  const cleaned = cleanEmailBody(reply.html_body, reply.text_body);
  const contentForClassification = cleaned.cleaned || cleaned.rawText || cleaned.rawHtml || "";
  const sentimentTag = "Interested";
  const leadStatus = SENTIMENT_TO_STATUS[sentimentTag] || "engaged";

  const sentAt = parseDate(reply.date_received, reply.created_at);
  const ccAddresses = reply.cc?.map((entry) => entry.address).filter(Boolean) ?? [];
  const bccAddresses = reply.bcc?.map((entry) => entry.address).filter(Boolean) ?? [];

  await prisma.message.create({
    data: {
      emailBisonReplyId,
      channel: "email",
      source: "zrg",
      body: cleaned.cleaned || contentForClassification,
      rawText: cleaned.rawText ?? null,
      rawHtml: cleaned.rawHtml ?? null,
      subject: reply.email_subject ?? null,
      cc: ccAddresses,
      bcc: bccAddresses,
      isRead: false,
      direction: "inbound",
      leadId: lead.id,
      sentAt,
    },
  });

  await prisma.lead.update({
    where: { id: lead.id },
    data: { sentimentTag, status: leadStatus },
  });

  try {
    const ensureResult = await ensureGhlContactIdForLead(lead.id, { requirePhone: true });
    if (!ensureResult.success && ensureResult.error) {
      console.log(`[GHL Contact] Lead ${lead.id}: ${ensureResult.error}`);
    }
  } catch (error) {
    console.error(`[GHL Contact] Failed to ensure contact for lead ${lead.id}:`, error);
  }

  // Generate AI draft with "Interested" context
  const draftResult = await generateResponseDraft(
    lead.id,
    `Subject: ${reply.email_subject ?? ""}\n\n${contentForClassification}`,
    sentimentTag,
    "email"
  );

  console.log(`[LEAD_INTERESTED] New lead ${lead.id} marked as Interested`);

  return NextResponse.json({
    success: true,
    eventType: "LEAD_INTERESTED",
    leadId: lead.id,
    sentimentTag,
    status: leadStatus,
    draftId: draftResult.success ? draftResult.draftId : undefined,
  });
}

async function handleUntrackedReply(request: NextRequest, payload: InboxxiaWebhook): Promise<NextResponse> {
  const data = payload.data;
  const reply = data?.reply;

  if (!reply?.id) {
    return NextResponse.json({ error: "Missing reply.id" }, { status: 400 });
  }

  const client = await findClient(request, payload);
  if (!client) {
    return NextResponse.json({ error: "Client not found for webhook" }, { status: 404 });
  }

  const emailBisonReplyId = String(reply.id);

  // Deduplication check
  const existingMessage = await prisma.message.findUnique({
    where: { emailBisonReplyId },
  });

  if (existingMessage) {
    return NextResponse.json({ success: true, deduped: true, eventType: "UNTRACKED_REPLY_RECEIVED" });
  }

  const fromEmail = reply.from_email_address;
  const fromName = reply.from_name;

  if (!fromEmail) {
    return NextResponse.json({ error: "Missing from_email_address" }, { status: 400 });
  }

  const senderAccountId = data?.sender_email?.id ? String(data.sender_email.id) : undefined;

  // Check if this is a bounce notification
  if (isBounceEmail(fromEmail)) {
    console.log(`[UNTRACKED_REPLY] Detected bounce email from: ${fromEmail}`);

    // Try to parse the original recipient from the bounce body
    const originalRecipient = parseBounceRecipient(reply.html_body, reply.text_body);

    if (originalRecipient) {
      // Find the original lead by the recipient email
      const originalLead = await prisma.lead.findFirst({
        where: {
          clientId: client.id,
          email: { equals: originalRecipient, mode: "insensitive" },
        },
      });

      if (originalLead) {
        console.log(`[BOUNCE] Linking bounce to original lead: ${originalLead.id} (${originalRecipient})`);

        const cleaned = cleanEmailBody(reply.html_body, reply.text_body);
        const sentAt = parseDate(reply.date_received, reply.created_at);

        // Create bounce message attached to the ORIGINAL lead
        await prisma.message.create({
          data: {
            emailBisonReplyId,
            channel: "email",
            source: "bounce",
            body: cleaned.cleaned || `Email delivery failed to ${originalRecipient}`,
            rawText: cleaned.rawText ?? null,
            rawHtml: cleaned.rawHtml ?? null,
            subject: reply.email_subject ?? "Delivery Status Notification (Failure)",
            isRead: false,
            direction: "inbound",
            leadId: originalLead.id,
            sentAt,
          },
        });

        // Mark the original lead as blacklisted (email is invalid)
        await prisma.lead.update({
          where: { id: originalLead.id },
          data: {
            status: "blacklisted",
            sentimentTag: "Blacklist",
          },
        });

        // Auto-reject any pending drafts for this lead
        await prisma.aIDraft.updateMany({
          where: {
            leadId: originalLead.id,
            status: "pending",
          },
          data: { status: "rejected" },
        });

        console.log(`[BOUNCE] Marked lead ${originalLead.id} as blacklisted due to bounce (rejected pending drafts)`);

        return NextResponse.json({
          success: true,
          eventType: "BOUNCE_HANDLED",
          originalLeadId: originalLead.id,
          bouncedEmail: originalRecipient,
          status: "blacklisted",
        });
      } else {
        console.log(`[BOUNCE] Could not find original lead for: ${originalRecipient}`);
      }
    }

    // If we couldn't parse recipient or find the lead, log but don't create fake lead
    console.log(`[BOUNCE] Ignoring bounce - could not link to original lead`);
    return NextResponse.json({
      success: true,
      eventType: "BOUNCE_IGNORED",
      reason: "Could not identify original recipient",
    });
  }

  // Regular untracked reply - create/find lead from sender info
  let lead = await upsertLead(
    client,
    {
      email: fromEmail,
      first_name: fromName?.split(" ")[0] || null,
      last_name: fromName?.split(" ").slice(1).join(" ") || null,
    },
    null, // No campaign
    senderAccountId,
    fromEmail
  );

  if (!lead) {
    return NextResponse.json({ error: "Failed to create/find lead" }, { status: 500 });
  }

  // For untracked replies, the lead won't have an emailBisonLeadId
  // Create the lead in EmailBison to get an ID for future syncing
  if (!lead.emailBisonLeadId && client.emailBisonApiKey) {
    console.log(`[UNTRACKED_REPLY] Lead ${lead.id} has no emailBisonLeadId, creating in EmailBison...`);

    const createResult = await createEmailBisonLead(client.emailBisonApiKey, {
      email: fromEmail,
      first_name: fromName?.split(" ")[0] || null,
      last_name: fromName?.split(" ").slice(1).join(" ") || null,
    });

    if (createResult.success && createResult.leadId) {
      // Update local lead with the EmailBison lead ID
      lead = await prisma.lead.update({
        where: { id: lead.id },
        data: { emailBisonLeadId: createResult.leadId },
      });
      console.log(`[UNTRACKED_REPLY] Created EmailBison lead ${createResult.leadId} for local lead ${lead.id}`);
    } else {
      // API call failed - flag lead as needs_repair so it can be fixed later
      lead = await prisma.lead.update({
        where: { id: lead.id },
        data: { status: "needs_repair" },
      });
      console.error(`[UNTRACKED_REPLY] Failed to create EmailBison lead: ${createResult.error}. Marked lead ${lead.id} as needs_repair`);
    }
  }

  const cleaned = cleanEmailBody(reply.html_body, reply.text_body);
  const contentForClassification = cleaned.cleaned || cleaned.rawText || cleaned.rawHtml || "";
  const sentAt = parseDate(reply.date_received, reply.created_at);

  if (client.emailBisonApiKey && lead.emailBisonLeadId) {
    await backfillOutboundEmailMessagesIfMissing({
      leadId: lead.id,
      emailBisonLeadId: lead.emailBisonLeadId,
      apiKey: client.emailBisonApiKey,
    });
  }

  const contextMessages = await prisma.message.findMany({
    where: { leadId: lead.id },
    orderBy: { sentAt: "desc" },
    take: 40,
    select: {
      sentAt: true,
      channel: true,
      direction: true,
      body: true,
      subject: true,
    },
  });

  const transcript = buildSentimentTranscriptFromMessages([
    ...contextMessages.reverse(),
    {
      sentAt,
      channel: "email",
      direction: "inbound",
      body: cleaned.cleaned || contentForClassification,
      subject: reply.email_subject ?? null,
    },
  ]);

  // Track if we're clearing a "Follow Up" or "Snoozed" tag (for logging)
  const previousSentiment = lead.sentimentTag;
  const wasFollowUp = previousSentiment === "Follow Up" || previousSentiment === "Snoozed";

  // Classify sentiment - any inbound reply clears "Follow Up" or "Snoozed" tags
  const sentimentTag = await classifySentiment(transcript);

  // Log when "Follow Up" or "Snoozed" tag is being cleared by a reply
  if (wasFollowUp) {
    console.log(`[FOLLOWUP_CLEARED] Lead ${lead.id} replied (untracked) - clearing "${previousSentiment}" tag, new sentiment: ${sentimentTag}`);
  }

  const leadStatus = SENTIMENT_TO_STATUS[sentimentTag] || lead.status || "new";

  const ccAddresses = reply.cc?.map((entry) => entry.address).filter(Boolean) ?? [];
  const bccAddresses = reply.bcc?.map((entry) => entry.address).filter(Boolean) ?? [];

  await prisma.message.create({
    data: {
      emailBisonReplyId,
      channel: "email",
      source: "zrg",
      body: cleaned.cleaned || contentForClassification,
      rawText: cleaned.rawText ?? null,
      rawHtml: cleaned.rawHtml ?? null,
      subject: reply.email_subject ?? null,
      cc: ccAddresses,
      bcc: bccAddresses,
      isRead: false,
      direction: "inbound",
      leadId: lead.id,
      sentAt,
    },
  });

  await prisma.lead.update({
    where: { id: lead.id },
    data: { sentimentTag, status: leadStatus },
  });

  // ==========================================================================
  // ENRICHMENT SEQUENCE (in order of priority)
  // 1. Message content extraction (regex) - check if lead shared contact info in message
  // 2. Signature extraction (AI) - extract from email signature
  // 3. Clay enrichment (external API) - only if still missing data
  // ==========================================================================

  const fullEmailBody = cleaned.rawText || cleaned.rawHtml || cleaned.cleaned || "";

  // STEP 1: Extract contact info from message content FIRST
  // This catches cases where the lead shares their phone/LinkedIn in the message itself
  const messageExtraction = extractContactFromMessageContent(fullEmailBody);
  if (messageExtraction.foundInMessage) {
    const currentLead = await prisma.lead.findUnique({ where: { id: lead.id } });
    const messageUpdates: Record<string, unknown> = {};

    if (messageExtraction.phone && !currentLead?.phone) {
      messageUpdates.phone = messageExtraction.phone;
      console.log(`[Enrichment] Found phone in message for lead ${lead.id}: ${messageExtraction.phone}`);
    }
    if (messageExtraction.linkedinUrl && !currentLead?.linkedinUrl) {
      messageUpdates.linkedinUrl = messageExtraction.linkedinUrl;
      console.log(`[Enrichment] Found LinkedIn in message for lead ${lead.id}: ${messageExtraction.linkedinUrl}`);
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

  // STEP 2: Extract contact info from email signature (AI-powered)
  const leadFullName = fromName || `${lead.firstName || ""} ${lead.lastName || ""}`.trim() || "Lead";
  await enrichLeadFromSignature(lead.id, leadFullName, fromEmail, fullEmailBody);

  // STEP 3: Trigger Clay enrichment if still missing LinkedIn or phone
  // Only triggers for positive sentiments (Meeting Requested, Call Requested, Info Requested, Interested)
  await triggerClayEnrichmentIfNeeded(lead.id, sentimentTag);

  // Generate AI draft (skip bounce emails)
  let draftId: string | undefined;
  if (shouldGenerateDraft(sentimentTag, fromEmail)) {
    const draftResult = await generateResponseDraft(
      lead.id,
      `Subject: ${reply.email_subject ?? ""}\n\n${contentForClassification}`,
      sentimentTag,
      "email"
    );
    if (draftResult.success) {
      draftId = draftResult.draftId;
    }
  }

  console.log(`[UNTRACKED_REPLY] Lead: ${lead.id}, From: ${fromEmail}, Sentiment: ${sentimentTag}`);

  return NextResponse.json({
    success: true,
    eventType: "UNTRACKED_REPLY_RECEIVED",
    leadId: lead.id,
    sentimentTag,
    status: leadStatus,
    draftId,
  });
}

async function handleEmailSent(request: NextRequest, payload: InboxxiaWebhook): Promise<NextResponse> {
  const data = payload.data;
  const scheduledEmail = data?.scheduled_email;

  if (!scheduledEmail?.id) {
    return NextResponse.json({ error: "Missing scheduled_email.id" }, { status: 400 });
  }

  const client = await findClient(request, payload);
  if (!client) {
    return NextResponse.json({ error: "Client not found for webhook" }, { status: 404 });
  }

  const inboxxiaScheduledEmailId = String(scheduledEmail.id);

  // Deduplication check
  const existingMessage = await prisma.message.findUnique({
    where: { inboxxiaScheduledEmailId },
  });

  if (existingMessage) {
    return NextResponse.json({ success: true, deduped: true, eventType: "EMAIL_SENT" });
  }

  // Upsert campaign and lead
  const emailCampaign = await upsertCampaign(client, data?.campaign);
  const senderAccountId = data?.sender_email?.id ? String(data.sender_email.id) : undefined;

  if (!data?.lead?.email) {
    return NextResponse.json({ error: "Missing lead email" }, { status: 400 });
  }

  const lead = await upsertLead(client, data.lead, emailCampaign?.id ?? null, senderAccountId);
  if (!lead) {
    return NextResponse.json({ error: "Failed to create/find lead" }, { status: 500 });
  }

  const sentAt = parseDate(scheduledEmail.sent_at);

  // Create outbound message from campaign
  await prisma.message.create({
    data: {
      inboxxiaScheduledEmailId,
      channel: "email",
      source: "inboxxia_campaign",
      body: scheduledEmail.email_body || "",
      rawHtml: scheduledEmail.email_body ?? null,
      subject: scheduledEmail.email_subject ?? null,
      isRead: true, // Outbound messages are "read"
      direction: "outbound",
      leadId: lead.id,
      sentAt,
    },
  });

  console.log(`[EMAIL_SENT] Lead: ${lead.id}, Subject: ${scheduledEmail.email_subject}`);

  return NextResponse.json({
    success: true,
    eventType: "EMAIL_SENT",
    leadId: lead.id,
    scheduledEmailId: inboxxiaScheduledEmailId,
  });
}

async function handleEmailOpened(request: NextRequest, payload: InboxxiaWebhook): Promise<NextResponse> {
  const data = payload.data;

  const client = await findClient(request, payload);
  if (!client) {
    return NextResponse.json({ error: "Client not found for webhook" }, { status: 404 });
  }

  // Log the open event for now (analytics deferred)
  const leadEmail = data?.lead?.email;
  const leadId = data?.lead?.id;

  console.log(`[EMAIL_OPENED] Lead: ${leadId || "unknown"}, Email: ${leadEmail || "unknown"}, Client: ${client.name}`);

  // Future: Could increment Lead.emailOpens counter here

  return NextResponse.json({
    success: true,
    eventType: "EMAIL_OPENED",
    logged: true,
  });
}

async function handleEmailBounced(request: NextRequest, payload: InboxxiaWebhook): Promise<NextResponse> {
  const data = payload.data;
  const reply = data?.reply;

  const client = await findClient(request, payload);
  if (!client) {
    return NextResponse.json({ error: "Client not found for webhook" }, { status: 404 });
  }

  if (!data?.lead?.email) {
    return NextResponse.json({ error: "Missing lead email" }, { status: 400 });
  }

  // Find or create the lead
  const emailCampaign = await upsertCampaign(client, data?.campaign);
  const senderAccountId = data?.sender_email?.id ? String(data.sender_email.id) : undefined;

  const lead = await upsertLead(client, data.lead, emailCampaign?.id ?? null, senderAccountId);
  if (!lead) {
    return NextResponse.json({ error: "Failed to create/find lead" }, { status: 500 });
  }

  // Blacklist the lead
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status: "blacklisted",
      sentimentTag: "Blacklist",
    },
  });

  // Create a visible bounce message in the conversation
  const bounceBody = reply?.text_body || reply?.html_body || "Email bounced - address invalid or blocked.";
  const cleaned = cleanEmailBody(reply?.html_body, reply?.text_body);

  await prisma.message.create({
    data: {
      channel: "email",
      source: "zrg",
      body: `[BOUNCED] ${cleaned.cleaned || bounceBody}`,
      rawHtml: reply?.html_body ?? null,
      rawText: reply?.text_body ?? null,
      subject: reply?.email_subject ?? "Delivery Status Notification (Failure)",
      isRead: false,
      direction: "inbound",
      leadId: lead.id,
      sentAt: new Date(),
    },
  });

  console.log(`[EMAIL_BOUNCED] Lead: ${lead.id}, Email: ${lead.email} - BLACKLISTED`);

  return NextResponse.json({
    success: true,
    eventType: "EMAIL_BOUNCED",
    leadId: lead.id,
    blacklisted: true,
  });
}

async function handleLeadUnsubscribed(request: NextRequest, payload: InboxxiaWebhook): Promise<NextResponse> {
  const data = payload.data;

  const client = await findClient(request, payload);
  if (!client) {
    return NextResponse.json({ error: "Client not found for webhook" }, { status: 404 });
  }

  if (!data?.lead?.email) {
    return NextResponse.json({ error: "Missing lead email" }, { status: 400 });
  }

  // Find or create the lead
  const emailCampaign = await upsertCampaign(client, data?.campaign);
  const senderAccountId = data?.sender_email?.id ? String(data.sender_email.id) : undefined;

  const lead = await upsertLead(client, data.lead, emailCampaign?.id ?? null, senderAccountId);
  if (!lead) {
    return NextResponse.json({ error: "Failed to create/find lead" }, { status: 500 });
  }

  // Blacklist the lead with "Unsubscribed" tag
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status: "blacklisted",
      sentimentTag: "Blacklist",
    },
  });

  console.log(`[LEAD_UNSUBSCRIBED] Lead: ${lead.id}, Email: ${lead.email} - BLACKLISTED (Unsubscribed)`);

  return NextResponse.json({
    success: true,
    eventType: "LEAD_UNSUBSCRIBED",
    leadId: lead.id,
    blacklisted: true,
  });
}

// =============================================================================
// Main POST Handler - Event Dispatcher
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const payload: InboxxiaWebhook = await request.json();
    const eventType = payload.event?.type;
    const workspaceId = payload.event?.workspace_id;
    const workspaceName = payload.event?.workspace_name;
    const leadEmail = payload.data?.lead?.email || payload.data?.reply?.from_email_address;

    console.log(`[Inboxxia Webhook] Received event: ${eventType} | workspace: ${workspaceName || workspaceId || "unknown"} | lead: ${leadEmail || "unknown"}`);

    if (!payload.data) {
      console.error(`[Inboxxia Webhook] Missing data field in payload for event: ${eventType}`);
      return NextResponse.json({ error: "Missing data" }, { status: 400 });
    }

    switch (eventType) {
      case "LEAD_REPLIED":
        return handleLeadReplied(request, payload);

      case "LEAD_INTERESTED":
        return handleLeadInterested(request, payload);

      case "UNTRACKED_REPLY_RECEIVED":
        return handleUntrackedReply(request, payload);

      case "EMAIL_SENT":
        return handleEmailSent(request, payload);

      case "EMAIL_OPENED":
        return handleEmailOpened(request, payload);

      case "EMAIL_BOUNCED":
        return handleEmailBounced(request, payload);

      case "LEAD_UNSUBSCRIBED":
        return handleLeadUnsubscribed(request, payload);

      default:
        console.log(`[Inboxxia Webhook] Ignoring unknown event type: ${eventType}`);
        return NextResponse.json({
          success: true,
          ignored: true,
          eventType: eventType || "unknown",
        });
    }
  } catch (error) {
    console.error("[Inboxxia Webhook] Error processing payload:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "Inboxxia webhook endpoint is active",
    supportedEvents: [
      "LEAD_REPLIED",
      "LEAD_INTERESTED",
      "UNTRACKED_REPLY_RECEIVED",
      "EMAIL_SENT",
      "EMAIL_OPENED",
      "EMAIL_BOUNCED",
      "LEAD_UNSUBSCRIBED",
    ],
    timestamp: new Date().toISOString(),
  });
}
