import { NextRequest, NextResponse } from "next/server";
import { BackgroundJobStatus, BackgroundJobType } from "@prisma/client";
import { prisma, isPrismaUniqueConstraintError } from "@/lib/prisma";
import {
  buildSentimentTranscriptFromMessages,
  detectBounce,
  isOptOutText,
  SENTIMENT_TO_STATUS,
  isPositiveSentiment,
  type SentimentTag,
} from "@/lib/sentiment";
import { findOrCreateLead } from "@/lib/lead-matching";
import { cleanEmailBody } from "@/lib/email-cleaning";
import { autoStartNoResponseSequenceOnOutbound } from "@/lib/followup-automation";
import { pauseFollowUpsOnReply } from "@/lib/followup-engine";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";
import { addToAlternateEmails, detectCcReplier, normalizeOptionalEmail } from "@/lib/email-participants";
import { getDbSchemaMissingColumnsForModels, isPrismaMissingTableOrColumnError } from "@/lib/db-schema-compat";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
// Reduced from 800s to 60s after moving AI classification to background jobs (Phase 31g).
export const maxDuration = 60;

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
  ghlLocationId: string | null;
  ghlPrivateKey: string | null;
  emailBisonApiKey: string | null;
  emailBisonWorkspaceId: string | null;
  userId: string;
};

// =============================================================================
// Helper Functions
// =============================================================================

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
  const workspaceIdStr =
    workspaceId !== undefined && workspaceId !== null ? String(workspaceId).trim() : "";
  if (workspaceIdStr) {
    const client = await prisma.client.findUnique({
      where: { emailBisonWorkspaceId: workspaceIdStr },
    });
    if (client) {
      console.log(`[Email Webhook] Client found via workspace_id: ${client.name} (${client.id})`);
      return client;
    }
    console.warn(`[Email Webhook] workspace_id in payload but no matching client: ${workspaceIdStr}`);
  }

  // Strategy 3 (safe backstop): Exact match by workspace name (only if unique globally)
  const rawWorkspaceName = payload?.event?.workspace_name || payload?.event?.name;
  const workspaceName = typeof rawWorkspaceName === "string" ? rawWorkspaceName.trim() : "";
  if (workspaceName) {
    const candidates = Array.from(
      new Set(
        [
          workspaceName,
          workspaceName.replace(/\s*-\s*Inboxxia\s*Client\s*$/i, "").trim(),
          workspaceName.replace(/\s*-\s*EmailBison\s*Client\s*$/i, "").trim(),
          workspaceName.replace(/\s*-\s*Inboxxia\s*$/i, "").trim(),
          workspaceName.replace(/\s*-\s*EmailBison\s*$/i, "").trim(),
        ].filter(Boolean)
      )
    );

    for (const candidate of candidates) {
      const matches = await prisma.client.findMany({
        where: { name: { equals: candidate, mode: "insensitive" } },
        take: 2,
      });

      if (matches.length === 1) {
        console.warn(
          `[Email Webhook] Client matched by workspace_name (emailBisonWorkspaceId missing/mismatched): ${matches[0].name} (${matches[0].id})`
        );
        return matches[0];
      }

      if (matches.length > 1) {
        console.warn(
          `[Email Webhook] Multiple clients match workspace_name "${candidate}". Skipping name-based routing.`
        );
        break;
      }
    }
  }

  // No client found - log diagnostic info
  const instanceUrl = payload?.event?.instance_url;
  const leadEmail = payload?.data?.lead?.email || payload?.data?.reply?.from_email_address;

  console.error(
    `[Email Webhook] Client lookup failed. clientId param: ${clientIdParam || "none"}, workspace_id: ${workspaceIdStr || "none"}, workspace_name: ${workspaceName || "none"}, instance_url: ${typeof instanceUrl === "string" ? instanceUrl : "none"}, lead: ${leadEmail || "unknown"}`
  );

  await triggerSlackNotification(
    `[Email Webhook] Client lookup failed. workspace_id=${workspaceIdStr || "none"} workspace_name=${workspaceName || "none"} lead=${leadEmail || "unknown"} instance_url=${typeof instanceUrl === "string" ? instanceUrl : "none"}. Fix: set EmailBison Workspace ID in Dashboard → Settings → Integrations.`
  );
  return null;
}

async function triggerSlackNotification(message: string) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error("[Slack] Failed to send notification:", error);
  }
}

async function enqueueEmailInboundPostProcessJob(opts: {
  clientId: string;
  leadId: string;
  messageId: string;
  dedupeKey: string;
}): Promise<void> {
  try {
    await prisma.backgroundJob.upsert({
      where: { dedupeKey: opts.dedupeKey },
      update: {
        status: BackgroundJobStatus.PENDING,
        runAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        startedAt: null,
        finishedAt: null,
        lastError: null,
      },
      create: {
        type: BackgroundJobType.EMAIL_INBOUND_POST_PROCESS,
        status: BackgroundJobStatus.PENDING,
        dedupeKey: opts.dedupeKey,
        clientId: opts.clientId,
        leadId: opts.leadId,
        messageId: opts.messageId,
        runAt: new Date(),
      },
    });
  } catch (error) {
    console.error("[Email Webhook] Failed to enqueue background job:", error);
  }
}

async function applyAutoFollowUpPolicyOnInboundEmail(opts: {
  clientId: string;
  leadId: string;
  sentimentTag: string | null;
}): Promise<void> {
  // If the lead is no longer positive, ensure we don't leave them stuck "enriching".
  if (!isPositiveSentiment(opts.sentimentTag)) {
    await prisma.lead.updateMany({
      where: { id: opts.leadId, enrichmentStatus: "pending" },
      data: { enrichmentStatus: "not_needed" },
    });
    return;
  }

  // If workspace policy is enabled, auto-enable follow-ups for positive inbound EMAIL replies.
  const settings = await prisma.workspaceSettings.findUnique({
    where: { clientId: opts.clientId },
    select: { autoFollowUpsOnReply: true },
  });
  if (!settings?.autoFollowUpsOnReply) return;

  await prisma.lead.updateMany({
    where: { id: opts.leadId, autoFollowUpEnabled: false },
    data: { autoFollowUpEnabled: true },
  });
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
        console.log("[Bounce Parser] Found recipient email in bounce body");
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
  fromEmail?: string,
  fromName?: string | null
) {
  const email = fromEmail || leadData?.email;
  if (!email) return null;

  const parseFromName = (full: string | null | undefined) => {
    const trimmed = (full || "").trim();
    if (!trimmed) return { firstName: null as string | null, lastName: null as string | null };
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { firstName: null, lastName: null };
    return {
      firstName: parts[0] || null,
      lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
    };
  };

  const emailBisonLeadId = leadData?.id ? String(leadData.id) : undefined;
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedLeadEmail = (leadData?.email || "").trim().toLowerCase();
  // IMPORTANT:
  // EmailBison lead IDs are stable identifiers for the campaign lead. Even if a reply comes from a
  // different address (e.g. personal Gmail), we still want to attach the reply to the same lead thread.
  const canUseEmailBisonLeadIdForMatching = Boolean(emailBisonLeadId);

  if (emailBisonLeadId && normalizedLeadEmail && normalizedEmail !== normalizedLeadEmail) {
    console.warn("[Email Webhook] Reply sender differs from campaign lead email; matching by emailBisonLeadId anyway");
  }

  const isSenderDifferentFromCampaignLead = Boolean(normalizedLeadEmail && normalizedEmail !== normalizedLeadEmail);
  const parsedFromName = parseFromName(fromName);
  const firstName = isSenderDifferentFromCampaignLead
    ? parsedFromName.firstName
    : leadData?.first_name || parsedFromName.firstName || null;
  const lastName = isSenderDifferentFromCampaignLead
    ? parsedFromName.lastName
    : leadData?.last_name || parsedFromName.lastName || null;

  // Use findOrCreateLead for cross-channel deduplication
  // This will match by email OR phone to find existing leads from SMS channel
  const result = await findOrCreateLead(
    client.id,
    {
      email,
      firstName,
      lastName,
    },
    canUseEmailBisonLeadIdForMatching ? { emailBisonLeadId } : undefined,
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

async function updateLeadReplierState(params: {
  leadId: string;
  leadEmail: string | null;
  fromEmail: string | null;
  fromName: string | null;
  logLabel: string;
}): Promise<void> {
  const leadEmail = normalizeOptionalEmail(params.leadEmail);
  const inboundFromEmail = normalizeOptionalEmail(params.fromEmail);
  const inboundFromName = (params.fromName || "").trim() || null;
  if (!leadEmail || !inboundFromEmail) return;
  const { isCcReplier } = detectCcReplier({
    leadEmail,
    inboundFromEmail,
  });

  const currentLead = await prisma.lead.findUnique({
    where: { id: params.leadId },
    select: { alternateEmails: true, currentReplierEmail: true },
  });

  if (isCcReplier && inboundFromEmail) {
    await prisma.lead.update({
      where: { id: params.leadId },
      data: {
        currentReplierEmail: inboundFromEmail,
        currentReplierName: inboundFromName,
        currentReplierSince: new Date(),
        alternateEmails: addToAlternateEmails(
          currentLead?.alternateEmails || [],
          inboundFromEmail,
          leadEmail
        ),
      },
    });

    console.log(`[Email Webhook] CC replier detected (${params.logLabel}): ${inboundFromEmail} (lead: ${leadEmail})`);
    return;
  }

  if (!isCcReplier && currentLead?.currentReplierEmail) {
    await prisma.lead.update({
      where: { id: params.leadId },
      data: {
        currentReplierEmail: null,
        currentReplierName: null,
        currentReplierSince: null,
      },
    });
  }
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
  const dedupeKey = `email_inbound_post_process:${emailBisonReplyId}`;

  // Deduplication check
  const existingMessage = await prisma.message.findUnique({
    where: { emailBisonReplyId },
    select: { id: true, leadId: true, lead: { select: { clientId: true } } },
  });

  if (existingMessage) {
    await enqueueEmailInboundPostProcessJob({
      clientId: existingMessage.lead?.clientId || client.id,
      leadId: existingMessage.leadId,
      messageId: existingMessage.id,
      dedupeKey,
    });

    return NextResponse.json({
      success: true,
      deduped: true,
      postProcessEnqueued: true,
      eventType: "LEAD_REPLIED",
      leadId: existingMessage.leadId,
    });
  }

  // Upsert campaign
  const emailCampaign = await upsertCampaign(client, data?.campaign);
  const senderAccountId = data?.sender_email?.id ? String(data.sender_email.id) : undefined;
  const fromEmail = reply.from_email_address || data?.lead?.email;

  if (!fromEmail) {
    return NextResponse.json({ error: "Missing from email" }, { status: 400 });
  }

  // Upsert lead
  const lead = await upsertLead(client, data?.lead ?? null, emailCampaign?.id ?? null, senderAccountId, fromEmail, reply.from_name ?? null);
  if (!lead) {
    return NextResponse.json({ error: "Failed to create/find lead" }, { status: 500 });
  }

  // Clean and classify email
  const cleaned = cleanEmailBody(reply.html_body, reply.text_body);
  const contentForClassification = cleaned.cleaned || cleaned.rawText || cleaned.rawHtml || "";
  const sentAt = parseDate(reply.date_received, reply.created_at);

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

  // FAST PATH: Use quick heuristics for immediate response, defer AI classification to background job.
  // This prevents webhook timeouts by avoiding slow AI calls on the critical path.
  // Note: Any inbound reply will reclassify sentiment, clearing "Follow Up" or "Snoozed" tags.
  let sentimentTag: SentimentTag;
  const cleanedBodyForStorage: string = cleaned.cleaned || contentForClassification;
  const inboundCombinedForSafety = `Subject: ${reply.email_subject ?? ""} | ${cleaned.cleaned || contentForClassification}`;
  const mustBlacklist =
    isOptOutText(inboundCombinedForSafety) ||
    detectBounce([{ body: inboundCombinedForSafety, direction: "inbound", channel: "email" }]);

  if (mustBlacklist) {
    // Safety-critical: opt-outs and bounces must be classified immediately
    sentimentTag = "Blacklist";
  } else if (reply.interested === true) {
    // Provider-flagged interest is reliable
    sentimentTag = "Interested";
  } else {
    // Use "Neutral" as placeholder - background job will run full AI classification
    sentimentTag = "Neutral";
  }

  // Log when "Follow Up" or "Snoozed" tag is being cleared by a reply
  if (wasFollowUp) {
    console.log(`[FOLLOWUP_CLEARED] Lead ${lead.id} replied - clearing "${previousSentiment}" tag, new sentiment: ${sentimentTag}`);
  }

  const leadStatus = SENTIMENT_TO_STATUS[sentimentTag] || lead.status || "new";

  const ccAddresses = reply.cc?.map((entry) => entry.address).filter(Boolean) ?? [];
  const bccAddresses = reply.bcc?.map((entry) => entry.address).filter(Boolean) ?? [];

  // Create inbound message - use try/catch to handle P2002 race condition
  // (two concurrent webhook deliveries can both pass the initial dedup check)
  let message: { id: string };
  try {
    message = await prisma.message.create({
      data: {
        emailBisonReplyId,
        channel: "email",
        source: "zrg", // Inbound replies are processed by ZRG
        body: cleanedBodyForStorage,
        rawText: cleaned.rawText ?? null,
        rawHtml: cleaned.rawHtml ?? null,
        subject: reply.email_subject ?? null,
        cc: ccAddresses,
        bcc: bccAddresses,
        // Phase 50: Email participant metadata
        fromEmail: reply.from_email_address ?? null,
        fromName: reply.from_name ?? null,
        toEmail: data?.sender_email?.email ?? null,
        toName: data?.sender_email?.name ?? null,
        isRead: false,
        direction: "inbound",
        leadId: lead.id,
        sentAt,
      },
      select: { id: true },
    });
  } catch (error) {
    // Handle P2002 unique constraint violation (race condition with duplicate webhook)
    if (isPrismaUniqueConstraintError(error)) {
      console.log(`[LEAD_REPLIED] Dedupe race: emailBisonReplyId=${emailBisonReplyId} already exists`);
      const existing = await prisma.message.findUnique({
        where: { emailBisonReplyId },
        select: { id: true, leadId: true },
      });
      if (existing) {
        await enqueueEmailInboundPostProcessJob({
          clientId: client.id,
          leadId: existing.leadId,
          messageId: existing.id,
          dedupeKey,
        });
        return NextResponse.json({
          success: true,
          deduped: true,
          postProcessEnqueued: true,
          eventType: "LEAD_REPLIED",
          leadId: existing.leadId,
        });
      }
    }
    throw error;
  }

  await updateLeadReplierState({
    leadId: lead.id,
    leadEmail: lead.email ?? null,
    fromEmail: reply.from_email_address ?? null,
    fromName: reply.from_name ?? null,
    logLabel: "LEAD_REPLIED",
  });

  await bumpLeadMessageRollup({ leadId: lead.id, direction: "inbound", sentAt });

  // Update lead sentiment/status
  await prisma.lead.update({
    where: { id: lead.id },
    data: { sentimentTag, status: leadStatus },
  });

  await applyAutoFollowUpPolicyOnInboundEmail({
    clientId: client.id,
    leadId: lead.id,
    sentimentTag,
  });

  // Phase 66: Removed sentiment-based Meeting Requested auto-start.
  // Meeting Requested is now triggered by setter email reply only.

  // Any inbound message pauses no-response sequences (meeting-requested sequences continue).
  pauseFollowUpsOnReply(lead.id).catch((err) =>
    console.error("[Email Webhook] Failed to pause follow-ups on reply:", err)
  );

  // Compliance/backstop: if the lead opted out (detected via quick heuristics), reject any pending drafts.
  // Note: "Automated Reply" detection moved to background job where full AI classification runs.
  if (sentimentTag === "Blacklist") {
    await prisma.aIDraft.updateMany({
      where: {
        leadId: lead.id,
        status: "pending",
      },
      data: { status: "rejected" },
    });
  }

  if (leadStatus === "meeting-booked") {
    await triggerSlackNotification(`Meeting booked via Inboxxia for lead ${lead.email || lead.id} (client ${client.name})`);
  }

  // Enqueue slow post-processing to cron-driven background jobs.
  await enqueueEmailInboundPostProcessJob({
    clientId: client.id,
    leadId: lead.id,
    messageId: message.id,
    dedupeKey,
  });

  return NextResponse.json({
    success: true,
    eventType: "LEAD_REPLIED",
    leadId: lead.id,
    sentimentTag,
    status: leadStatus,
    postProcessEnqueued: true,
  });

  /*
  // If the lead asks to reconnect after a specific date, snooze/pause follow-ups until then.
  const inboundText = (cleanedBodyForStorage || "").trim();
  const snoozeKeywordHit =
    /\b(after|until|from)\b/i.test(inboundText) &&
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(inboundText);

  if (snoozeKeywordHit) {
    const tzResult = await ensureLeadTimezone(lead.id);
    const { snoozedUntilUtc, confidence } = detectSnoozedUntilUtcFromMessage({
      messageText: inboundText,
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

  // Auto-booking: only books when the lead clearly accepts one of the offered slots.
  const autoBook = await processMessageForAutoBooking(lead.id, cleanedBodyForStorage);
  if (autoBook.booked) {
    console.log(`[Auto-Book] Booked appointment for lead ${lead.id}: ${autoBook.appointmentId}`);
  }

  // Compliance/backstop: if the lead opted out (detected via quick heuristics), reject any pending drafts.
  // Note: "Automated Reply" detection moved to background job where full AI classification runs.
  if (sentimentTag === "Blacklist") {
    await prisma.aIDraft.updateMany({
      where: {
        leadId: lead.id,
        status: "pending",
      },
      data: { status: "rejected" },
    });
  }

  // Phase 66: Removed sentiment-based Meeting Requested auto-start.
  // Meeting Requested is now triggered by setter email reply only.

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
      messageUpdates.phone = toStoredPhone(messageExtraction.phone) || messageExtraction.phone;
      console.log(`[Enrichment] Found phone in message for lead ${lead.id}`);
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
  await enrichLeadFromSignature(client.id, lead.id, leadFullName, fromEmail, fullEmailBody);

  // If the lead is a positive reply and we have a phone, ensure they exist in GHL
  // so SMS history and future messages can be synced.
  if (isPositiveSentiment(sentimentTag)) {
    try {
      const ensureResult = await ensureGhlContactIdForLead(lead.id, { allowCreateWithoutPhone: true });
      if (!ensureResult.success && ensureResult.error) {
        console.log(`[GHL Contact] Lead ${lead.id}: ${ensureResult.error}`);
      }

      // If we have a phone (from message/custom vars/signature), sync it to the GHL contact so SMS can send.
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

  // If any follow-up instances were paused waiting for enrichment, resume them now.
  await resumeAwaitingEnrichmentFollowUpsForLead(lead.id).catch(() => undefined);

  // STEP 4: Trigger Clay enrichment if still missing LinkedIn or phone after other enrichment
  // Only triggers for positive sentiments (Meeting Requested, Call Requested, Info Requested, Interested)
  // Pass EmailBison data for additional context (company, state, etc.)
  await triggerClayEnrichmentIfNeeded(lead.id, sentimentTag, emailBisonData);

  // Generate AI draft if appropriate (skip bounce emails)
  let draftId: string | undefined;
  let draftContent: string | undefined;
  let autoReplySent = false;

  if (!autoBook.booked && shouldGenerateDraft(sentimentTag, fromEmail)) {
    const draftResult = await generateResponseDraft(
      lead.id,
      `Subject: ${reply.email_subject ?? ""}\n\n${contentForClassification}`,
      sentimentTag,
      "email",
      { timeoutMs: WEBHOOK_DRAFT_TIMEOUT_MS }
    );
    if (draftResult.success) {
      draftId = draftResult.draftId;
      draftContent = draftResult.content || undefined;
      console.log(`[LEAD_REPLIED] Generated AI draft: ${draftId}`);

      const responseMode = emailCampaign?.responseMode ?? null;
      const autoSendThreshold = emailCampaign?.autoSendConfidenceThreshold ?? 0.9;

      if (responseMode === "AI_AUTO_SEND" && draftId && draftContent) {
        const evaluation = await evaluateAutoSend({
          clientId: client.id,
          leadId: lead.id,
          channel: "email",
          latestInbound: cleaned.cleaned || contentForClassification,
          subject: reply.email_subject ?? null,
          conversationHistory: transcript,
          categorization: sentimentTag,
          automatedReply: reply.automated_reply ?? null,
          replyReceivedAt: sentAt,
          draft: draftContent,
        });

        if (evaluation.safeToSend && evaluation.confidence >= autoSendThreshold) {
          console.log(
            `[Auto-Send] Sending draft ${draftId} for lead ${lead.id} (confidence ${evaluation.confidence.toFixed(2)} >= ${autoSendThreshold.toFixed(2)})`
          );
          const sendResult = await approveAndSendDraftSystem(draftId, { sentBy: "ai" });
          if (sendResult.success) {
            console.log(`[Auto-Send] Sent message: ${sendResult.messageId}`);
            autoReplySent = true;
          } else {
            console.error(`[Auto-Send] Failed to send draft: ${sendResult.error}`);
          }
        } else {
          const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
          const campaignLabel = emailCampaign
            ? `${emailCampaign.name} (${emailCampaign.bisonCampaignId})`
            : "Unknown campaign";
          const url = `${getPublicAppUrl()}/?view=inbox&clientId=${encodeURIComponent(client.id)}&leadId=${encodeURIComponent(lead.id)}&draftId=${encodeURIComponent(draftId)}`;
          const confidenceText = `${evaluation.confidence.toFixed(2)} < ${autoSendThreshold.toFixed(2)}`;
          const approvalValue = JSON.stringify({ draftId, leadId: lead.id, clientId: client.id });

          const dmResult = await sendSlackDmByEmail({
            email: "jonandmika@gmail.com",
            dedupeKey: `auto_send_review:${draftId}`,
            text: `AI auto-send review needed (${confidenceText})`,
            blocks: [
              {
                type: "header",
                text: { type: "plain_text", text: "AI Auto-Send: Review Needed", emoji: true },
              },
              {
                type: "section",
                fields: [
                  { type: "mrkdwn", text: `*Lead:*\n${leadName}${lead.email ? `\n${lead.email}` : ""}` },
                  { type: "mrkdwn", text: `*Campaign:*\n${campaignLabel}` },
                  { type: "mrkdwn", text: `*Sentiment:*\n${sentimentTag || "Unknown"}` },
                  { type: "mrkdwn", text: `*Confidence:*\n${evaluation.confidence.toFixed(2)} (thresh ${autoSendThreshold.toFixed(2)})` },
                ],
              },
              {
                type: "section",
                text: { type: "mrkdwn", text: `*Reason:*\n${evaluation.reason}` },
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*Draft Preview:*\n\`\`\`\n${draftContent.slice(0, 1400)}\n\`\`\``,
                },
              },
              {
                type: "actions",
                block_id: `review_actions_${draftId}`,
                elements: [
                  {
                    type: "button",
                    text: { type: "plain_text", text: "Edit in dashboard", emoji: true },
                    url,
                    action_id: "edit_dashboard",
                  },
                  {
                    type: "button",
                    text: { type: "plain_text", text: "Approve & Send", emoji: true },
                    style: "primary",
                    action_id: "approve_send",
                    value: approvalValue,
                  },
                ],
              },
            ],
          });
          if (!dmResult.success) {
            console.error(`[Slack DM] Failed to notify Jon for draft ${draftId}: ${dmResult.error || "unknown error"}`);
          }
        }
      } else if (!emailCampaign && lead.autoReplyEnabled && draftId) {
        // Legacy per-lead auto-reply path (only when no EmailCampaign is present).
        const decision = await decideShouldAutoReply({
          clientId: client.id,
          leadId: lead.id,
          channel: "email",
          latestInbound: cleaned.cleaned || contentForClassification,
          subject: reply.email_subject ?? null,
          conversationHistory: transcript,
          categorization: sentimentTag,
          automatedReply: reply.automated_reply ?? null,
          replyReceivedAt: sentAt,
        });

        if (!decision.shouldReply) {
          console.log(`[Auto-Reply] Skipped auto-send for lead ${lead.id}: ${decision.reason}`);
        } else {
          console.log(`[Auto-Reply] Auto-approving draft ${draftId} for lead ${lead.id}`);
          const sendResult = await approveAndSendDraftSystem(draftId, { sentBy: "ai" });
          if (sendResult.success) {
            console.log(`[Auto-Reply] Sent message: ${sendResult.messageId}`);
            autoReplySent = true;
          } else {
            console.error(`[Auto-Reply] Failed to send draft: ${sendResult.error}`);
          }
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
  */
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
  const dedupeKey = `email_inbound_post_process:${emailBisonReplyId}`;

  const existingMessage = await prisma.message.findUnique({
    where: { emailBisonReplyId },
    select: {
      id: true,
      leadId: true,
      subject: true,
      body: true,
      lead: { select: { clientId: true, status: true, sentimentTag: true } },
    },
  });

  if (existingMessage) {
    const inboundCombinedForSafety = `Subject: ${existingMessage.subject ?? ""} | ${existingMessage.body ?? ""}`;
    const mustBlacklist =
      isOptOutText(inboundCombinedForSafety) ||
      detectBounce([{ body: inboundCombinedForSafety, direction: "inbound", channel: "email" }]);

    const sentimentTag: SentimentTag = mustBlacklist ? "Blacklist" : "Interested";
    const leadStatus = SENTIMENT_TO_STATUS[sentimentTag] || existingMessage.lead?.status || "engaged";
    const previousSentiment = existingMessage.lead?.sentimentTag ?? null;

    await prisma.lead.update({
      where: { id: existingMessage.leadId },
      data: { sentimentTag, status: leadStatus },
    });

    if (sentimentTag === "Blacklist") {
      await prisma.aIDraft.updateMany({
        where: {
          leadId: existingMessage.leadId,
          status: "pending",
        },
        data: { status: "rejected" },
      });
    }

    await applyAutoFollowUpPolicyOnInboundEmail({
      clientId: existingMessage.lead?.clientId || client.id,
      leadId: existingMessage.leadId,
      sentimentTag,
    });

    // Phase 66: Removed sentiment-based Meeting Requested auto-start.
    // Meeting Requested is now triggered by setter email reply only.

    await enqueueEmailInboundPostProcessJob({
      clientId: existingMessage.lead?.clientId || client.id,
      leadId: existingMessage.leadId,
      messageId: existingMessage.id,
      dedupeKey,
    });

    return NextResponse.json({
      success: true,
      eventType: "LEAD_INTERESTED",
      leadId: existingMessage.leadId,
      updatedExisting: true,
      sentimentTag,
      status: leadStatus,
      postProcessEnqueued: true,
    });
  }

  const emailCampaign = await upsertCampaign(client, data?.campaign);
  const senderAccountId = data?.sender_email?.id ? String(data.sender_email.id) : undefined;
  const fromEmail = reply.from_email_address || data?.lead?.email;

  if (!fromEmail) {
    return NextResponse.json({ error: "Missing from email" }, { status: 400 });
  }

  const lead = await upsertLead(
    client,
    data?.lead ?? null,
    emailCampaign?.id ?? null,
    senderAccountId,
    fromEmail,
    reply.from_name ?? null
  );
  if (!lead) {
    return NextResponse.json({ error: "Failed to create/find lead" }, { status: 500 });
  }

  const cleaned = cleanEmailBody(reply.html_body, reply.text_body);
  const contentForClassification = cleaned.cleaned || cleaned.rawText || cleaned.rawHtml || "";
  const cleanedBodyForStorage = cleaned.cleaned || contentForClassification;

  const inboundCombinedForSafety = `Subject: ${reply.email_subject ?? ""} | ${cleaned.cleaned || contentForClassification}`;
  const mustBlacklist =
    isOptOutText(inboundCombinedForSafety) ||
    detectBounce([{ body: inboundCombinedForSafety, direction: "inbound", channel: "email" }]);

  const sentimentTag: SentimentTag = mustBlacklist ? "Blacklist" : "Interested";
  const leadStatus = SENTIMENT_TO_STATUS[sentimentTag] || "engaged";
  const previousSentiment = lead.sentimentTag;

  const sentAt = parseDate(reply.date_received, reply.created_at);
  const ccAddresses = reply.cc?.map((entry) => entry.address).filter(Boolean) ?? [];
  const bccAddresses = reply.bcc?.map((entry) => entry.address).filter(Boolean) ?? [];

  // Create inbound message - use try/catch to handle P2002 race condition
  let message: { id: string };
  try {
    message = await prisma.message.create({
      data: {
        emailBisonReplyId,
        channel: "email",
        source: "zrg",
        body: cleanedBodyForStorage,
        rawText: cleaned.rawText ?? null,
        rawHtml: cleaned.rawHtml ?? null,
        subject: reply.email_subject ?? null,
        cc: ccAddresses,
        bcc: bccAddresses,
        // Phase 50: Email participant metadata
        fromEmail: reply.from_email_address ?? null,
        fromName: reply.from_name ?? null,
        toEmail: data?.sender_email?.email ?? null,
        toName: data?.sender_email?.name ?? null,
        isRead: false,
        direction: "inbound",
        leadId: lead.id,
        sentAt,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      console.log(`[LEAD_INTERESTED] Dedupe race: emailBisonReplyId=${emailBisonReplyId} already exists`);
      const existing = await prisma.message.findUnique({
        where: { emailBisonReplyId },
        select: { id: true, leadId: true },
      });
      if (existing) {
        await enqueueEmailInboundPostProcessJob({
          clientId: client.id,
          leadId: existing.leadId,
          messageId: existing.id,
          dedupeKey,
        });
        return NextResponse.json({
          success: true,
          deduped: true,
          postProcessEnqueued: true,
          eventType: "LEAD_INTERESTED",
          leadId: existing.leadId,
        });
      }
    }
    throw error;
  }

  await updateLeadReplierState({
    leadId: lead.id,
    leadEmail: lead.email ?? null,
    fromEmail: reply.from_email_address ?? null,
    fromName: reply.from_name ?? null,
    logLabel: "LEAD_INTERESTED",
  });

  await bumpLeadMessageRollup({ leadId: lead.id, direction: "inbound", sentAt });

  await prisma.lead.update({
    where: { id: lead.id },
    data: { sentimentTag, status: leadStatus },
  });

  await applyAutoFollowUpPolicyOnInboundEmail({
    clientId: client.id,
    leadId: lead.id,
    sentimentTag,
  });

  // Phase 66: Removed sentiment-based Meeting Requested auto-start.
  // Meeting Requested is now triggered by setter email reply only.

  pauseFollowUpsOnReply(lead.id).catch((err) => console.error("[Email Webhook] Failed to pause follow-ups on reply:", err));

  if (sentimentTag === "Blacklist") {
    await prisma.aIDraft.updateMany({
      where: {
        leadId: lead.id,
        status: "pending",
      },
      data: { status: "rejected" },
    });
  }

  await enqueueEmailInboundPostProcessJob({
    clientId: client.id,
    leadId: lead.id,
    messageId: message.id,
    dedupeKey,
  });

  return NextResponse.json({
    success: true,
    eventType: "LEAD_INTERESTED",
    leadId: lead.id,
    sentimentTag,
    status: leadStatus,
    postProcessEnqueued: true,
  });
}

/*
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
    const inboundCombinedForSafety = `Subject: ${existingMessage.subject ?? ""} | ${existingMessage.body ?? ""}`;
    const mustBlacklist =
      isOptOutText(inboundCombinedForSafety) ||
      detectBounce([{ body: inboundCombinedForSafety, direction: "inbound", channel: "email" }]);

    if (mustBlacklist) {
      await prisma.lead.update({
        where: { id: existingMessage.leadId },
        data: {
          sentimentTag: "Blacklist",
          status: SENTIMENT_TO_STATUS["Blacklist"] || "blacklisted",
        },
      });

      // Auto-reject any pending drafts for this lead
      await prisma.aIDraft.updateMany({
        where: {
          leadId: existingMessage.leadId,
          status: "pending",
        },
        data: { status: "rejected" },
      });

      console.log(`[LEAD_INTERESTED] Override → Blacklist for lead ${existingMessage.leadId} (provider interest ignored)`);

      return NextResponse.json({
        success: true,
        eventType: "LEAD_INTERESTED",
        leadId: existingMessage.leadId,
        updatedExisting: true,
        sentimentTag: "Blacklist",
        status: SENTIMENT_TO_STATUS["Blacklist"] || "blacklisted",
      });
    }

    // Message exists - just update lead sentiment to "Interested"
    await prisma.lead.update({
      where: { id: existingMessage.leadId },
      data: {
        sentimentTag: "Interested",
        status: SENTIMENT_TO_STATUS["Interested"] || existingMessage.lead.status,
      },
    });

    try {
      const ensureResult = await ensureGhlContactIdForLead(existingMessage.leadId, { allowCreateWithoutPhone: true });
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
      "email",
      { timeoutMs: WEBHOOK_DRAFT_TIMEOUT_MS }
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

  const lead = await upsertLead(client, data?.lead ?? null, emailCampaign?.id ?? null, senderAccountId, fromEmail, reply.from_name ?? null);
  if (!lead) {
    return NextResponse.json({ error: "Failed to create/find lead" }, { status: 500 });
  }

  const cleaned = cleanEmailBody(reply.html_body, reply.text_body);
  const contentForClassification = cleaned.cleaned || cleaned.rawText || cleaned.rawHtml || "";
  const cleanedBodyForStorage = cleaned.cleaned || contentForClassification;
  const inboundCombinedForSafety = `Subject: ${reply.email_subject ?? ""} | ${cleaned.cleaned || contentForClassification}`;
  const mustBlacklist =
    isOptOutText(inboundCombinedForSafety) ||
    detectBounce([{ body: inboundCombinedForSafety, direction: "inbound", channel: "email" }]);

  const sentimentTag: SentimentTag = mustBlacklist ? "Blacklist" : "Interested";
  const leadStatus = SENTIMENT_TO_STATUS[sentimentTag] || "engaged";

  const sentAt = parseDate(reply.date_received, reply.created_at);
  const ccAddresses = reply.cc?.map((entry) => entry.address).filter(Boolean) ?? [];
  const bccAddresses = reply.bcc?.map((entry) => entry.address).filter(Boolean) ?? [];

  const message = await prisma.message.create({
    data: {
      emailBisonReplyId,
      channel: "email",
      source: "zrg",
      body: cleanedBodyForStorage,
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
    select: { id: true },
  });

  await bumpLeadMessageRollup({ leadId: lead.id, direction: "inbound", sentAt });

  await prisma.lead.update({
    where: { id: lead.id },
    data: { sentimentTag, status: leadStatus },
  });

  await applyAutoFollowUpPolicyOnInboundEmail({
    clientId: client.id,
    leadId: lead.id,
    sentimentTag,
  });

  // Any inbound message pauses no-response sequences.
  pauseFollowUpsOnReply(lead.id).catch((err) =>
    console.error("[Email Webhook] Failed to pause follow-ups on reply:", err)
  );

  // If the lead asks to reconnect after a specific date, snooze/pause follow-ups until then.
  const inboundText = (cleanedBodyForStorage || "").trim();
  const snoozeKeywordHit =
    /\b(after|until|from)\b/i.test(inboundText) &&
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(inboundText);

  if (snoozeKeywordHit) {
    const tzResult = await ensureLeadTimezone(lead.id);
    const { snoozedUntilUtc, confidence } = detectSnoozedUntilUtcFromMessage({
      messageText: inboundText,
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

  const autoBook = await processMessageForAutoBooking(lead.id, cleanedBodyForStorage);
  if (autoBook.booked) {
    console.log(`[Auto-Book] Booked appointment for lead ${lead.id}: ${autoBook.appointmentId}`);
  }

  if (isPositiveSentiment(sentimentTag)) {
    try {
      const ensureResult = await ensureGhlContactIdForLead(lead.id, { allowCreateWithoutPhone: true });
      if (!ensureResult.success && ensureResult.error) {
        console.log(`[GHL Contact] Lead ${lead.id}: ${ensureResult.error}`);
      }
    } catch (error) {
      console.error(`[GHL Contact] Failed to ensure contact for lead ${lead.id}:`, error);
    }
  }

  // Generate AI draft when appropriate (skip blacklists/automated/system replies)
  const shouldDraft = !autoBook.booked && shouldGenerateDraft(sentimentTag, fromEmail);
  const draftResult = shouldDraft
    ? await generateResponseDraft(
        lead.id,
        `Subject: ${reply.email_subject ?? ""}\n\n${contentForClassification}`,
        sentimentTag,
        "email",
        { timeoutMs: WEBHOOK_DRAFT_TIMEOUT_MS }
      )
    : { success: false as const, draftId: undefined as string | undefined };

  console.log(`[LEAD_INTERESTED] New lead ${lead.id} marked as ${sentimentTag}`);

  return NextResponse.json({
    success: true,
    eventType: "LEAD_INTERESTED",
    leadId: lead.id,
    sentimentTag,
    status: leadStatus,
    draftId: draftResult.success ? draftResult.draftId : undefined,
  });
}
*/

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
  const dedupeKey = `email_inbound_post_process:${emailBisonReplyId}`;

  // Deduplication check
  const existingMessage = await prisma.message.findUnique({
    where: { emailBisonReplyId },
    select: { id: true, leadId: true, lead: { select: { clientId: true } } },
  });

  if (existingMessage) {
    await enqueueEmailInboundPostProcessJob({
      clientId: existingMessage.lead?.clientId || client.id,
      leadId: existingMessage.leadId,
      messageId: existingMessage.id,
      dedupeKey,
    });

    return NextResponse.json({
      success: true,
      deduped: true,
      postProcessEnqueued: true,
      eventType: "UNTRACKED_REPLY_RECEIVED",
      leadId: existingMessage.leadId,
    });
  }

  const fromEmail = reply.from_email_address;
  const fromName = reply.from_name;

  if (!fromEmail) {
    return NextResponse.json({ error: "Missing from_email_address" }, { status: 400 });
  }

  const senderAccountId = data?.sender_email?.id ? String(data.sender_email.id) : undefined;

  // Check if this is a bounce notification
  if (isBounceEmail(fromEmail)) {
    console.log("[UNTRACKED_REPLY] Detected bounce email");

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

        // Create bounce message attached to the ORIGINAL lead - handle P2002 race
        try {
          await prisma.message.create({
            data: {
              emailBisonReplyId,
              channel: "email",
              source: "bounce",
              body: cleaned.cleaned || `Email delivery failed to ${originalRecipient}`,
              rawText: cleaned.rawText ?? null,
              rawHtml: cleaned.rawHtml ?? null,
              subject: reply.email_subject ?? "Delivery Status Notification (Failure)",
              // Phase 50: Email participant metadata (bounce notification)
              fromEmail: reply.from_email_address ?? null,
              fromName: reply.from_name ?? null,
              toEmail: data?.sender_email?.email ?? null,
              toName: data?.sender_email?.name ?? null,
              isRead: false,
              direction: "inbound",
              leadId: originalLead.id,
              sentAt,
            },
          });
        } catch (error) {
          if (isPrismaUniqueConstraintError(error)) {
            console.log(`[BOUNCE] Dedupe race: emailBisonReplyId=${emailBisonReplyId} already exists`);
            return NextResponse.json({
              success: true,
              deduped: true,
              eventType: "BOUNCE_HANDLED",
              originalLeadId: originalLead.id,
              bouncedEmail: originalRecipient,
            });
          }
          throw error;
        }

        await bumpLeadMessageRollup({ leadId: originalLead.id, direction: "inbound", sentAt });

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
  const lead = await upsertLead(
    client,
    {
      email: fromEmail,
      first_name: null,
      last_name: null,
    },
    null, // No campaign
    senderAccountId,
    fromEmail,
    fromName ?? null
  );

  if (!lead) {
    return NextResponse.json({ error: "Failed to create/find lead" }, { status: 500 });
  }

  const cleaned = cleanEmailBody(reply.html_body, reply.text_body);
  const contentForClassification = cleaned.cleaned || cleaned.rawText || cleaned.rawHtml || "";
  const sentAt = parseDate(reply.date_received, reply.created_at);

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

  // FAST PATH: Use quick heuristics for immediate response, defer AI classification to background job.
  // This prevents webhook timeouts by avoiding slow AI calls on the critical path.
  let sentimentTag: SentimentTag;
  const cleanedBodyForStorage: string = cleaned.cleaned || contentForClassification;

  const inboundCombinedForSafety = `Subject: ${reply.email_subject ?? ""} | ${cleaned.cleaned || contentForClassification}`;
  const mustBlacklist =
    isOptOutText(inboundCombinedForSafety) ||
    detectBounce([{ body: inboundCombinedForSafety, direction: "inbound", channel: "email" }]);

  if (mustBlacklist) {
    // Safety-critical: opt-outs and bounces must be classified immediately
    sentimentTag = "Blacklist";
  } else if (reply.interested === true) {
    // Provider-flagged interest is reliable
    sentimentTag = "Interested";
  } else {
    // Use "Neutral" as placeholder - background job will run full AI classification
    sentimentTag = "Neutral";
  }

  // Log when "Follow Up" or "Snoozed" tag is being cleared by a reply
  if (wasFollowUp) {
    console.log(`[FOLLOWUP_CLEARED] Lead ${lead.id} replied (untracked) - clearing "${previousSentiment}" tag, new sentiment: ${sentimentTag}`);
  }

  const leadStatus = SENTIMENT_TO_STATUS[sentimentTag] || lead.status || "new";

  const ccAddresses = reply.cc?.map((entry) => entry.address).filter(Boolean) ?? [];
  const bccAddresses = reply.bcc?.map((entry) => entry.address).filter(Boolean) ?? [];

  // Create inbound message - use try/catch to handle P2002 race condition
  let message: { id: string };
  try {
    message = await prisma.message.create({
      data: {
        emailBisonReplyId,
        channel: "email",
        source: "zrg",
        body: cleanedBodyForStorage,
        rawText: cleaned.rawText ?? null,
        rawHtml: cleaned.rawHtml ?? null,
        subject: reply.email_subject ?? null,
        cc: ccAddresses,
        bcc: bccAddresses,
        // Phase 50: Email participant metadata
        fromEmail: reply.from_email_address ?? null,
        fromName: reply.from_name ?? null,
        toEmail: data?.sender_email?.email ?? null,
        toName: data?.sender_email?.name ?? null,
        isRead: false,
        direction: "inbound",
        leadId: lead.id,
        sentAt,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      console.log(`[UNTRACKED_REPLY] Dedupe race: emailBisonReplyId=${emailBisonReplyId} already exists`);
      const existing = await prisma.message.findUnique({
        where: { emailBisonReplyId },
        select: { id: true, leadId: true },
      });
      if (existing) {
        await enqueueEmailInboundPostProcessJob({
          clientId: client.id,
          leadId: existing.leadId,
          messageId: existing.id,
          dedupeKey,
        });
        return NextResponse.json({
          success: true,
          deduped: true,
          postProcessEnqueued: true,
          eventType: "UNTRACKED_REPLY_RECEIVED",
          leadId: existing.leadId,
        });
      }
    }
    throw error;
  }

  await updateLeadReplierState({
    leadId: lead.id,
    leadEmail: lead.email ?? null,
    fromEmail: reply.from_email_address ?? null,
    fromName: reply.from_name ?? null,
    logLabel: "UNTRACKED_REPLY",
  });

  await bumpLeadMessageRollup({ leadId: lead.id, direction: "inbound", sentAt });

  await prisma.lead.update({
    where: { id: lead.id },
    data: { sentimentTag, status: leadStatus },
  });

  await applyAutoFollowUpPolicyOnInboundEmail({
    clientId: client.id,
    leadId: lead.id,
    sentimentTag,
  });

  // Phase 66: Removed sentiment-based Meeting Requested auto-start.
  // Meeting Requested is now triggered by setter email reply only.

  // Any inbound message pauses no-response sequences (meeting-requested sequences continue).
  pauseFollowUpsOnReply(lead.id).catch((err) =>
    console.error("[Email Webhook] Failed to pause follow-ups on reply:", err)
  );

  // Compliance/backstop: if the lead opted out (detected via quick heuristics), reject any pending drafts.
  // Note: "Automated Reply" detection moved to background job where full AI classification runs.
  if (sentimentTag === "Blacklist") {
    await prisma.aIDraft.updateMany({
      where: {
        leadId: lead.id,
        status: "pending",
      },
      data: { status: "rejected" },
    });
  }

  // Enqueue slow post-processing to cron-driven background jobs.
  await enqueueEmailInboundPostProcessJob({
    clientId: client.id,
    leadId: lead.id,
    messageId: message.id,
    dedupeKey,
  });

  return NextResponse.json({
    success: true,
    eventType: "UNTRACKED_REPLY_RECEIVED",
    leadId: lead.id,
    sentimentTag,
    status: leadStatus,
    postProcessEnqueued: true,
  });

  /*
  // If the lead asks to reconnect after a specific date, snooze/pause follow-ups until then.
  const inboundText = (cleanedBodyForStorage || "").trim();
  const snoozeKeywordHit =
    /\b(after|until|from)\b/i.test(inboundText) &&
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(inboundText);

  if (snoozeKeywordHit) {
    const tzResult = await ensureLeadTimezone(lead.id);
    const { snoozedUntilUtc, confidence } = detectSnoozedUntilUtcFromMessage({
      messageText: inboundText,
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

  // Auto-booking: only books when the lead clearly accepts one of the offered slots.
  const autoBook = await processMessageForAutoBooking(lead.id, cleanedBodyForStorage);
  if (autoBook.booked) {
    console.log(`[Auto-Book] Booked appointment for lead ${lead.id}: ${autoBook.appointmentId}`);
  }

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
      messageUpdates.phone = toStoredPhone(messageExtraction.phone) || messageExtraction.phone;
      console.log(`[Enrichment] Found phone in message for lead ${lead.id}`);
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
  await enrichLeadFromSignature(client.id, lead.id, leadFullName, fromEmail, fullEmailBody);

  // STEP 3: Trigger Clay enrichment if still missing LinkedIn or phone
  // Only triggers for positive sentiments (Meeting Requested, Call Requested, Info Requested, Interested)
  await triggerClayEnrichmentIfNeeded(lead.id, sentimentTag);

  // Generate AI draft (skip bounce emails)
  let draftId: string | undefined;
  if (!autoBook.booked && shouldGenerateDraft(sentimentTag, fromEmail)) {
    const draftResult = await generateResponseDraft(
      lead.id,
      `Subject: ${reply.email_subject ?? ""}\n\n${contentForClassification}`,
      sentimentTag,
      "email",
      { timeoutMs: WEBHOOK_DRAFT_TIMEOUT_MS }
    );
    if (draftResult.success) {
      draftId = draftResult.draftId;
    }
  }

  console.log(`[UNTRACKED_REPLY] Lead: ${lead.id}, Sentiment: ${sentimentTag}`);

  return NextResponse.json({
    success: true,
    eventType: "UNTRACKED_REPLY_RECEIVED",
    leadId: lead.id,
    sentimentTag,
    status: leadStatus,
    draftId,
  });
  */
}

async function handleEmailSent(request: NextRequest, payload: InboxxiaWebhook): Promise<NextResponse> {
  const data = payload.data;
  const scheduledEmail = data?.scheduled_email;

  if (!scheduledEmail?.id) {
    return NextResponse.json({ error: "Missing scheduled_email.id" }, { status: 400 });
  }

  const inboxxiaScheduledEmailId = String(scheduledEmail.id);

  // Phase 53: high-volume EMAIL_SENT events can arrive in bursts and must not do heavy DB work on the request path.
  // When enabled, we enqueue the event to a durable queue and return immediately.
  const asyncEnabled =
    process.env.INBOXXIA_EMAIL_SENT_ASYNC === "1" ||
    process.env.INBOXXIA_EMAIL_SENT_ASYNC === "true" ||
    process.env.INBOXXIA_EMAIL_SENT_ASYNC === "yes";

  if (asyncEnabled) {
    const workspaceId = payload.event?.workspace_id;
    const workspaceIdStr = workspaceId !== undefined && workspaceId !== null ? String(workspaceId).trim() : null;
    const dedupeKey = `inboxxia:EMAIL_SENT:${inboxxiaScheduledEmailId}`;

    try {
      await prisma.webhookEvent.upsert({
        where: { dedupeKey },
        update: {
          status: "PENDING",
          runAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          startedAt: null,
          finishedAt: null,
          lastError: null,
          provider: "INBOXXIA",
          eventType: "EMAIL_SENT",
          workspaceId: workspaceIdStr,
          workspaceName: payload.event?.workspace_name || payload.event?.name || null,
          campaignId: data?.campaign?.id ? String(data.campaign.id) : null,
          campaignName: data?.campaign?.name || null,
          emailBisonLeadId: data?.lead?.id ? String(data.lead.id) : null,
          leadEmail: data?.lead?.email ?? null,
          leadFirstName: data?.lead?.first_name ?? null,
          leadLastName: data?.lead?.last_name ?? null,
          senderEmailId: data?.sender_email?.id ? String(data.sender_email.id) : null,
          senderEmail: data?.sender_email?.email ?? null,
          senderName: data?.sender_email?.name ?? null,
          scheduledEmailId: inboxxiaScheduledEmailId,
          emailSubject: scheduledEmail.email_subject ?? null,
          emailBodyHtml: scheduledEmail.email_body ?? null,
          emailStatus: scheduledEmail.status ?? null,
          emailSentAt: scheduledEmail.sent_at ? parseDate(scheduledEmail.sent_at) : null,
        },
        create: {
          provider: "INBOXXIA",
          eventType: "EMAIL_SENT",
          dedupeKey,
          status: "PENDING",
          runAt: new Date(),
          workspaceId: workspaceIdStr,
          workspaceName: payload.event?.workspace_name || payload.event?.name || null,
          campaignId: data?.campaign?.id ? String(data.campaign.id) : null,
          campaignName: data?.campaign?.name || null,
          emailBisonLeadId: data?.lead?.id ? String(data.lead.id) : null,
          leadEmail: data?.lead?.email ?? null,
          leadFirstName: data?.lead?.first_name ?? null,
          leadLastName: data?.lead?.last_name ?? null,
          senderEmailId: data?.sender_email?.id ? String(data.sender_email.id) : null,
          senderEmail: data?.sender_email?.email ?? null,
          senderName: data?.sender_email?.name ?? null,
          scheduledEmailId: inboxxiaScheduledEmailId,
          emailSubject: scheduledEmail.email_subject ?? null,
          emailBodyHtml: scheduledEmail.email_body ?? null,
          emailStatus: scheduledEmail.status ?? null,
          emailSentAt: scheduledEmail.sent_at ? parseDate(scheduledEmail.sent_at) : null,
        },
      });
    } catch (error) {
      console.error("[Email Webhook] Failed to enqueue EMAIL_SENT webhook event:", error);
      return NextResponse.json({ error: "Failed to enqueue EMAIL_SENT webhook event" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      queued: true,
      eventType: "EMAIL_SENT",
      scheduledEmailId: inboxxiaScheduledEmailId,
      dedupeKey,
    });
  }

  const client = await findClient(request, payload);
  if (!client) {
    return NextResponse.json({ error: "Client not found for webhook" }, { status: 404 });
  }

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

  // Create outbound message from campaign - handle P2002 race condition
  try {
    await prisma.message.create({
      data: {
        inboxxiaScheduledEmailId,
        channel: "email",
        source: "inboxxia_campaign",
        body: scheduledEmail.email_body || "",
        rawHtml: scheduledEmail.email_body ?? null,
        subject: scheduledEmail.email_subject ?? null,
        // Phase 50: Email participant metadata (outbound campaign)
        fromEmail: data?.sender_email?.email ?? null,
        fromName: data?.sender_email?.name ?? null,
        toEmail: lead.email ?? null,
        toName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || null,
        isRead: true, // Outbound messages are "read"
        direction: "outbound",
        leadId: lead.id,
        sentAt,
      },
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      console.log(`[EMAIL_SENT] Dedupe race: inboxxiaScheduledEmailId=${inboxxiaScheduledEmailId} already exists`);
      return NextResponse.json({ success: true, deduped: true, eventType: "EMAIL_SENT" });
    }
    throw error;
  }

  await bumpLeadMessageRollup({ leadId: lead.id, direction: "outbound", sentAt });

  await autoStartNoResponseSequenceOnOutbound({ leadId: lead.id, outboundAt: sentAt });

  console.log(`[EMAIL_SENT] Lead: ${lead.id} (subjectLen=${(scheduledEmail.email_subject || "").length})`);

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

  console.log(`[EMAIL_OPENED] Lead: ${leadId || "unknown"}, ClientId: ${client.id}`);

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
  await prisma.lead.updateMany({
    where: { id: lead.id, enrichmentStatus: "pending" },
    data: { enrichmentStatus: "not_needed" },
  });

  // Create a visible bounce message in the conversation
  const bounceBody = reply?.text_body || reply?.html_body || "Email bounced - address invalid or blocked.";
  const cleaned = cleanEmailBody(reply?.html_body, reply?.text_body);
  const sentAt = new Date();

  await prisma.message.create({
    data: {
      channel: "email",
      source: "zrg",
      body: `[BOUNCED] ${cleaned.cleaned || bounceBody}`,
      rawHtml: reply?.html_body ?? null,
      rawText: reply?.text_body ?? null,
      subject: reply?.email_subject ?? "Delivery Status Notification (Failure)",
      // Phase 50: Email participant metadata (bounce notification)
      fromEmail: reply?.from_email_address ?? null,
      fromName: reply?.from_name ?? null,
      toEmail: data?.sender_email?.email ?? null,
      toName: data?.sender_email?.name ?? null,
      isRead: false,
      direction: "inbound",
      leadId: lead.id,
      sentAt,
    },
  });

  await bumpLeadMessageRollup({ leadId: lead.id, direction: "inbound", sentAt });

  console.log(`[EMAIL_BOUNCED] Lead: ${lead.id} - BLACKLISTED`);

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
  await prisma.lead.updateMany({
    where: { id: lead.id, enrichmentStatus: "pending" },
    data: { enrichmentStatus: "not_needed" },
  });

  // Reject any pending drafts - unsubscribed leads must never get a reply.
  await prisma.aIDraft.updateMany({
    where: {
      leadId: lead.id,
      status: "pending",
    },
    data: { status: "rejected" },
  });

  console.log(`[LEAD_UNSUBSCRIBED] Lead: ${lead.id} - BLACKLISTED (Unsubscribed)`);

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
  return withAiTelemetrySource(request.nextUrl.pathname, async () => {
    try {
      const payload: InboxxiaWebhook = await request.json();
      const eventType = payload.event?.type;
      const workspaceId = payload.event?.workspace_id;
      const workspaceName = payload.event?.workspace_name;
      const leadEmail = payload.data?.lead?.email || payload.data?.reply?.from_email_address;

      console.log(
        `[Inboxxia Webhook] Received event: ${eventType} | workspace: ${workspaceName || workspaceId || "unknown"} | lead: ${
          leadEmail || "unknown"
        }`
      );

      if (!payload.data) {
        console.error(`[Inboxxia Webhook] Missing data field in payload for event: ${eventType}`);
        return NextResponse.json({ error: "Missing data" }, { status: 400 });
      }

      // Fail fast (retryable) if the deployed Prisma schema expects columns that aren't present yet.
      // This avoids noisy Prisma P2022 stack traces during migrations/rollouts.
      try {
        const missing = await getDbSchemaMissingColumnsForModels({
          models: ["Client", "Lead", "Message", "BackgroundJob", "WorkspaceSettings", "EmailCampaign", "AIDraft"],
        });
        if (missing.length > 0) {
          console.error("[SchemaCompat] DB schema out of date:", { path: request.nextUrl.pathname, missing });
          return NextResponse.json(
            { error: "DB schema out of date", path: request.nextUrl.pathname, missing },
            { status: 503, headers: { "Retry-After": "60" } }
          );
        }
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        console.error("[SchemaCompat] Failed to validate DB schema:", { path: request.nextUrl.pathname, details });
        return NextResponse.json(
          { error: "DB unavailable", path: request.nextUrl.pathname, details },
          { status: 503, headers: { "Retry-After": "60" } }
        );
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
      if (isPrismaMissingTableOrColumnError(error)) {
        const details = error instanceof Error ? error.message : String(error);
        console.error("[SchemaCompat] Prisma schema drift detected:", { path: request.nextUrl.pathname, details });
        return NextResponse.json(
          { error: "DB schema out of date", path: request.nextUrl.pathname, details },
          { status: 503, headers: { "Retry-After": "60" } }
        );
      }

      console.error("[Inboxxia Webhook] Error processing payload:", error);
      return NextResponse.json(
        {
          error: "Internal server error",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 }
      );
    }
  });
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
