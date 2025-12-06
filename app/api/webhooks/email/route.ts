import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { classifySentiment, SENTIMENT_TO_STATUS } from "@/lib/sentiment";
import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { approveAndSendDraft } from "@/actions/message-actions";

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

async function findClient(request: NextRequest): Promise<Client | null> {
  const url = new URL(request.url);
  const clientIdParam = url.searchParams.get("clientId");

  if (clientIdParam) {
    const client = await prisma.client.findUnique({ where: { id: clientIdParam } });
    if (client) return client;
  }

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

  const existingLead = await prisma.lead.findFirst({
    where: {
      clientId: client.id,
      OR: [
        emailBisonLeadId ? { emailBisonLeadId } : undefined,
        { email },
      ].filter(Boolean) as any,
    },
  });

  const placeholderContactId = emailBisonLeadId
    ? `emailbison-${emailBisonLeadId}`
    : `emailbison-${email.toLowerCase()}`;

  if (existingLead) {
    return prisma.lead.update({
      where: { id: existingLead.id },
      data: {
        firstName: leadData?.first_name ?? existingLead.firstName ?? undefined,
        lastName: leadData?.last_name ?? existingLead.lastName ?? undefined,
        email,
        emailBisonLeadId,
        emailCampaignId: emailCampaignId ?? existingLead.emailCampaignId ?? undefined,
        senderAccountId: senderAccountId ?? existingLead.senderAccountId ?? undefined,
      },
    });
  }

  return prisma.lead.create({
    data: {
      ghlContactId: placeholderContactId,
      firstName: leadData?.first_name || null,
      lastName: leadData?.last_name || null,
      email,
      status: leadData?.status || "new",
      clientId: client.id,
      emailBisonLeadId,
      emailCampaignId,
      senderAccountId: senderAccountId ?? null,
    },
  });
}

function parseDate(dateStr?: string | null): Date {
  if (dateStr && !Number.isNaN(new Date(dateStr).getTime())) {
    return new Date(dateStr);
  }
  return new Date();
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

  const client = await findClient(request);
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

  // If Inboxxia already marked as interested, use that; otherwise classify with AI
  let sentimentTag: string;
  if (reply.interested === true) {
    sentimentTag = "Interested";
  } else {
    sentimentTag = await classifySentiment(
      `Subject: ${reply.email_subject ?? ""}\n${contentForClassification}`
    );
  }

  const leadStatus = SENTIMENT_TO_STATUS[sentimentTag] || lead.status || "new";

  const sentAt = parseDate(reply.date_received) || parseDate(reply.created_at);

  const ccAddresses = reply.cc?.map((entry) => entry.address).filter(Boolean) ?? [];
  const bccAddresses = reply.bcc?.map((entry) => entry.address).filter(Boolean) ?? [];

  // Create inbound message
  await prisma.message.create({
    data: {
      emailBisonReplyId,
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

  if (leadStatus === "meeting-booked") {
    await triggerSlackNotification(
      `Meeting booked via Inboxxia for lead ${lead.email || lead.id} (client ${client.name})`
    );
  }

  // Generate AI draft if appropriate
  let draftId: string | undefined;
  let autoReplySent = false;

  if (shouldGenerateDraft(sentimentTag)) {
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

  const client = await findClient(request);
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

  const sentAt = parseDate(reply.date_received) || parseDate(reply.created_at);
  const ccAddresses = reply.cc?.map((entry) => entry.address).filter(Boolean) ?? [];
  const bccAddresses = reply.bcc?.map((entry) => entry.address).filter(Boolean) ?? [];

  await prisma.message.create({
    data: {
      emailBisonReplyId,
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

  const client = await findClient(request);
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

  // For untracked replies, lead data is null - create from reply sender info
  const fromEmail = reply.from_email_address;
  const fromName = reply.from_name;

  if (!fromEmail) {
    return NextResponse.json({ error: "Missing from_email_address" }, { status: 400 });
  }

  const senderAccountId = data?.sender_email?.id ? String(data.sender_email.id) : undefined;

  // Create lead from reply sender info (no campaign association)
  const lead = await upsertLead(
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

  const cleaned = cleanEmailBody(reply.html_body, reply.text_body);
  const contentForClassification = cleaned.cleaned || cleaned.rawText || cleaned.rawHtml || "";

  const sentimentTag = await classifySentiment(
    `Subject: ${reply.email_subject ?? ""}\n${contentForClassification}`
  );
  const leadStatus = SENTIMENT_TO_STATUS[sentimentTag] || lead.status || "new";

  const sentAt = parseDate(reply.date_received) || parseDate(reply.created_at);
  const ccAddresses = reply.cc?.map((entry) => entry.address).filter(Boolean) ?? [];
  const bccAddresses = reply.bcc?.map((entry) => entry.address).filter(Boolean) ?? [];

  await prisma.message.create({
    data: {
      emailBisonReplyId,
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

  // Generate AI draft
  let draftId: string | undefined;
  if (shouldGenerateDraft(sentimentTag)) {
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

  const client = await findClient(request);
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

  const client = await findClient(request);
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

  const client = await findClient(request);
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

  const client = await findClient(request);
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
      sentimentTag: "Unsubscribed",
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

    console.log(`[Inboxxia Webhook] Received event: ${eventType}`);

    if (!payload.data) {
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
