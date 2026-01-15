import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exportMessages, getGHLContact } from "@/lib/ghl-api";
import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { approveAndSendDraftSystem } from "@/actions/message-actions";
import { buildSentimentTranscriptFromMessages, classifySentiment, SENTIMENT_TO_STATUS } from "@/lib/sentiment";
import { findOrCreateLead, normalizePhone } from "@/lib/lead-matching";
import { normalizeSmsCampaignLabel } from "@/lib/sms-campaign";
import { autoStartMeetingRequestedSequenceIfEligible } from "@/lib/followup-automation";
import { pauseFollowUpsOnReply, pauseFollowUpsUntil, processMessageForAutoBooking } from "@/lib/followup-engine";
import { decideShouldAutoReply } from "@/lib/auto-reply-gate";
import { evaluateAutoSend } from "@/lib/auto-send-evaluator";
import { ensureLeadTimezone } from "@/lib/timezone-inference";
import { detectSnoozedUntilUtcFromMessage } from "@/lib/snooze-detection";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { sendSlackDmByEmail } from "@/lib/slack-dm";
import { getPublicAppUrl } from "@/lib/app-url";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 800;

function normalizeLooseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function coerceToLabelString(value: unknown): string | null {
  if (typeof value === "string") {
    const s = value.trim();
    return s ? s : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value && typeof value === "object") {
    const anyVal = value as any;
    const candidates = [anyVal.name, anyVal.label, anyVal.value, anyVal.text];
    for (const c of candidates) {
      if (typeof c === "string") {
        const s = c.trim();
        if (s) return s;
      }
    }
  }

  return null;
}

function extractSmsSubClientLabelFromWebhookPayload(payload: GHLWebhookPayload): string | null {
  const direct = coerceToLabelString(payload.customData?.Client ?? payload.customData?.client);
  if (direct) return direct;

  const normalizedKeysByPriority = [
    "client",
    "clientname",
    "subclient",
    "subclientname",
    "smsclient",
    "smsclientname",
    "smssubclient",
    "smssubclientname",
    "smscampaign",
    "smscampaignname",
    "campaign",
    "campaignname",
  ];
  const allowed = new Set(normalizedKeysByPriority);

  const maybeSources: Array<unknown> = [payload.customData, payload.triggerData];
  for (const source of maybeSources) {
    if (!source || typeof source !== "object") continue;

    for (const [rawKey, rawValue] of Object.entries(source as Record<string, unknown>)) {
      const key = normalizeLooseKey(rawKey);
      if (!allowed.has(key)) continue;
      const label = coerceToLabelString(rawValue);
      if (label) return label;
    }
  }

  return null;
}

/**
 * GHL Workflow Webhook Payload Structure
 * Based on actual GHL webhook data
 */
interface GHLWebhookPayload {
  // Contact fields (snake_case from GHL)
  contact_id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  tags?: string;
  country?: string;
  date_created?: string;
  full_address?: string;
  contact_type?: string;

  // Location info
  location?: {
    id: string;
    name?: string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
    fullAddress?: string;
  };

  // Message info
  message?: {
    type?: number;
    body?: string;
  };

  // Workflow info
  workflow?: {
    id?: string;
    name?: string;
  };

  // Custom data passed through the webhook
  customData?: {
    ID?: string;
    "Phone Number"?: string;
    "First Name"?: string;
    "Last Name"?: string;
    Email?: string;
    Message?: string;
    Date?: string;
    Time?: string;
    [key: string]: string | undefined;
  };

  // Attribution
  contact?: {
    attributionSource?: Record<string, unknown>;
    lastAttributionSource?: Record<string, unknown>;
  };
  attributionSource?: Record<string, unknown>;
  triggerData?: Record<string, unknown>;
}

/**
 * GHL Message from export API
 * Based on the actual API response structure
 */
interface GHLExportedMessage {
  id: string;
  direction: "inbound" | "outbound";
  status: string;
  type: number;
  locationId: string;
  attachments: unknown[];
  body: string;
  contactId: string;
  contentType: string;
  conversationId: string;
  dateAdded: string;
  dateUpdated: string;
  altId?: string;
  messageType: string;
  userId?: string;
  source?: string;
}

interface GHLExportResponse {
  messages: GHLExportedMessage[];
  nextCursor: string | null;
  total: number;
  traceId: string;
}

/**
 * Fetch full conversation history from GHL using the export API
 * Endpoint: GET /conversations/messages/export
 * Docs: https://marketplace.gohighlevel.com/docs/ghl/conversations/export-messages-by-location
 */
async function fetchGHLConversationHistory(
  locationId: string,
  contactId: string,
  privateKey: string
): Promise<{ messages: GHLExportedMessage[]; transcript: string }> {
  try {
    console.log(`[GHL API] Fetching conversation history (export) for contact ${contactId}`);

    const exportResult = await exportMessages(locationId, contactId, privateKey, "SMS");
    if (!exportResult.success || !exportResult.data) {
      console.error(`[GHL API] Export failed: ${exportResult.error || "unknown error"}`);
      return { messages: [], transcript: "" };
    }

    const data: GHLExportResponse = exportResult.data as unknown as GHLExportResponse;
    const messages = data.messages || [];

    // Sort messages by date (oldest first for transcript)
    const sortedMessages = [...messages].sort(
      (a, b) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime()
    );

    // Build transcript for AI classification
    const transcript = buildSentimentTranscriptFromMessages(
      sortedMessages.map((m) => ({
        sentAt: m.dateAdded,
        channel: "sms",
        direction: m.direction,
        body: m.body,
      }))
    );

    return { messages: sortedMessages, transcript };
  } catch (error) {
    console.error("[GHL API] Error fetching conversation history:", error);
    return { messages: [], transcript: "" };
  }
}

/**
 * Import historical messages into our database
 * Uses GHL Message ID (ghlId) as source of truth for deduplication
 * Stores the actual GHL timestamp in sentAt for accurate time display
 */
async function importHistoricalMessages(
  leadId: string,
  messages: GHLExportedMessage[]
): Promise<{ imported: number; healed: number }> {
  let importedCount = 0;
  let healedCount = 0;

  for (const msg of messages) {
    try {
      const msgTimestamp = new Date(msg.dateAdded); // Actual time from GHL
      const ghlId = msg.id;

      // Step 1: Check if message exists by ghlId (definitive match)
      // @ts-ignore ghlId exists on Message model
      const existingByGhlId = await prisma.message.findUnique({
        where: { ghlId },
      } as any);

      if (existingByGhlId) {
        // Already imported with correct ghlId - just fix timestamp if needed
        if ((existingByGhlId as any).sentAt.getTime() !== msgTimestamp.getTime()) {
          await prisma.message.update({
            where: { ghlId },
            data: { sentAt: msgTimestamp },
          } as any);
          await bumpLeadMessageRollup({
            leadId,
            direction: (msg.direction as "inbound" | "outbound") === "inbound" ? "inbound" : "outbound",
            sentAt: msgTimestamp,
          });
          healedCount++;
          console.log(`[Import] Fixed timestamp for ghlId ${ghlId}`);
        }
        continue;
      }

      // Step 2: Check for legacy message without ghlId
      const existingByContent = await prisma.message.findFirst({
        where: {
          leadId,
          body: msg.body,
          direction: msg.direction,
          ghlId: null,
        },
      } as any);

      if (existingByContent) {
        // Heal the legacy message
        await prisma.message.update({
          where: { id: existingByContent.id },
          data: {
            ghlId,
            sentAt: msgTimestamp,
          },
        } as any);
        await bumpLeadMessageRollup({
          leadId,
          direction: (msg.direction as "inbound" | "outbound") === "inbound" ? "inbound" : "outbound",
          sentAt: msgTimestamp,
        });
        healedCount++;
        console.log(`[Import] Healed: "${msg.body.substring(0, 30)}..." -> ghlId: ${ghlId}`);
        continue;
      }

      // Step 3: Create new message with ghlId
      await prisma.message.create({
        data: {
          ghlId,
          body: msg.body,
          direction: msg.direction,
          channel: "sms",
          leadId,
          sentAt: msgTimestamp,
        },
      } as any);
      await bumpLeadMessageRollup({
        leadId,
        direction: (msg.direction as "inbound" | "outbound") === "inbound" ? "inbound" : "outbound",
        sentAt: msgTimestamp,
      });
      importedCount++;
      console.log(`[Import] Saved: "${msg.body.substring(0, 30)}..." (${msg.direction}) @ ${msgTimestamp.toISOString()}`);
    } catch (error) {
      console.error(`[Import] Error importing message ${msg.id}: ${error}`);
    }
  }

  return { imported: importedCount, healed: healedCount };
}

/**
 * POST handler for GHL SMS webhooks
 * Handles the workflow webhook payload from GoHighLevel
 */
export async function POST(request: NextRequest) {
  return withAiTelemetrySource(request.nextUrl.pathname, async () => {
    try {
      const payload: GHLWebhookPayload = await request.json();

    console.log("=== GHL SMS Webhook Received ===");
    console.log(
      "Payload meta:",
      JSON.stringify(
        {
          locationId: payload.location?.id,
          contactId: payload.contact_id,
          workflowName: payload.workflow?.name,
          hasCustomData: !!payload.customData,
          customDataKeys: payload.customData ? Object.keys(payload.customData) : [],
        },
        null,
        2
      )
    );

    // Extract location ID (for client lookup)
    const locationId = payload.location?.id;

    if (!locationId) {
      console.error("Missing location.id in payload");
      return NextResponse.json(
        { error: "Missing location.id" },
        { status: 400 }
      );
    }

    // Extract contact ID
    const contactId = payload.contact_id;

    if (!contactId) {
      console.error("Missing contact_id in payload");
      return NextResponse.json(
        { error: "Missing contact_id" },
        { status: 400 }
      );
    }

    // Look up the client by locationId
    const client = await prisma.client.findUnique({
      where: { ghlLocationId: locationId },
    });

    if (!client) {
      console.log(`No client found for locationId: ${locationId}`);
      return NextResponse.json(
        { error: `Client not registered for location: ${locationId}` },
        { status: 404 }
      );
    }

    console.log(`Found client: ${client.name} (${client.id})`);

    // Extract contact info from root level fields
    let firstName = payload.first_name || payload.customData?.["First Name"] || null;
    let lastName = payload.last_name || payload.customData?.["Last Name"] || null;
    let email = payload.email || payload.customData?.Email || null;
    let phone = payload.phone || payload.customData?.["Phone Number"] || null;

    // Best-effort: hydrate missing fields directly from the GHL contact record.
    // Some workflow webhooks omit phone/email; fetching the contact fixes cross-channel lead matching
    // and prevents the UI from hiding the SMS channel due to a missing phone.
    if ((!email || !phone || !firstName || !lastName) && client.ghlPrivateKey) {
      try {
        const contactResult = await getGHLContact(contactId, client.ghlPrivateKey, { locationId });
        const contact = contactResult.success ? contactResult.data?.contact : null;

        if (contact) {
          if (!email && contact.email) email = contact.email;
          if (!phone && contact.phone) phone = contact.phone;
          if (!firstName && contact.firstName) firstName = contact.firstName;
          if (!lastName && contact.lastName) lastName = contact.lastName;

          console.log(
            `[Webhook] Hydrated contact fields from GHL: email=${!!email} phone=${!!phone} first=${!!firstName} last=${!!lastName}`
          );
        }
      } catch (err) {
        console.warn("[Webhook] Failed to hydrate contact fields from GHL:", err);
      }
    }

    const normalizedPhone = normalizePhone(phone);

    // Get the message body from current webhook
    const messageBody =
      payload.message?.body || payload.customData?.Message || "";

    // Try to extract message timestamp from webhook payload.
    //
    // IMPORTANT: GHL workflow webhooks provide Date/Time as workspace-local strings (no timezone).
    // On Vercel (UTC), parsing those strings produces a consistent offset (e.g. -5h), which
    // breaks message ordering and deduplication vs. the GHL export/conversation APIs.
    //
    // Prefer receipt time, and only trust webhook-provided timestamps when they're very close
    // to receipt time (i.e. already in UTC / explicitly offset).
    const receivedAt = new Date();
    let webhookMessageTime: Date = receivedAt;

    type TimestampCandidate = { label: string; value: Date };
    const candidates: TimestampCandidate[] = [];

    if (payload.customData?.Date && payload.customData?.Time) {
      const dateStr = `${payload.customData.Date} ${payload.customData.Time}`;
      const parsed = new Date(dateStr);
      if (!Number.isNaN(parsed.getTime())) {
        candidates.push({ label: "customData", value: parsed });
      } else {
        console.log(`[Webhook] Could not parse customData Date/Time: "${dateStr}"`);
      }
    }

    if (payload.date_created) {
      const parsed = new Date(payload.date_created);
      if (!Number.isNaN(parsed.getTime())) {
        candidates.push({ label: "date_created", value: parsed });
      } else {
        console.log(`[Webhook] Could not parse date_created: "${payload.date_created}"`);
      }
    }

    const maxDriftMs = 20 * 60_000; // 20 minutes
    let best: { label: string; value: Date; driftMs: number } | null = null;

    for (const candidate of candidates) {
      const driftMs = Math.abs(candidate.value.getTime() - receivedAt.getTime());
      if (driftMs > maxDriftMs) continue;

      if (!best || driftMs < best.driftMs) {
        best = { ...candidate, driftMs };
      }
    }

    if (best) {
      webhookMessageTime = best.value;
      console.log(
        `[Webhook] Using ${best.label} timestamp (drift ${Math.round(best.driftMs / 1000)}s): ${webhookMessageTime.toISOString()}`
      );
    } else {
      webhookMessageTime = receivedAt;
      console.log(`[Webhook] Using receipt time: ${webhookMessageTime.toISOString()}`);
    }

    console.log(
      `Processing inbound SMS (contactId=${contactId}) name=${(firstName || "").trim()} ${(lastName || "").trim()} bodyLen=${
        (messageBody || "").length
      }`
    );
    console.log(
      `Contact fields present: email=${!!email} phone=${!!phone} normalizedPhone=${!!normalizedPhone}`
    );

    // Extract SMS sub-client campaign label (e.g. customData.Client)
    const extractedSubClientLabel = extractSmsSubClientLabelFromWebhookPayload(payload);
    const smsCampaignLabel = normalizeSmsCampaignLabel(extractedSubClientLabel);
    let smsCampaignId: string | null = null;

    if (!smsCampaignLabel) {
      console.log(
        `[Webhook] No SMS sub-client label found (contactId=${contactId}, locationId=${locationId}, customDataKeys=${
          payload.customData ? Object.keys(payload.customData).join(",") : ""
        })`
      );
    }

    if (smsCampaignLabel) {
      const smsCampaign = await prisma.smsCampaign.upsert({
        where: {
          clientId_nameNormalized: {
            clientId: client.id,
            nameNormalized: smsCampaignLabel.nameNormalized,
          },
        },
        create: {
          clientId: client.id,
          name: smsCampaignLabel.name,
          nameNormalized: smsCampaignLabel.nameNormalized,
        },
        update: {
          name: smsCampaignLabel.name,
        },
      });
      smsCampaignId = smsCampaign.id;
    }

    // Use findOrCreateLead for cross-channel deduplication
    // This will match by email OR phone to find existing leads from other channels
    const leadResult = await findOrCreateLead(
      client.id,
      { email, phone, firstName, lastName },
      { ghlContactId: contactId },
      { smsCampaignId }
    );

    const isNewLead = leadResult.isNew;
    console.log(`Lead ${leadResult.lead.id}: ${isNewLead ? "NEW" : "EXISTING"} (matched by ${leadResult.matchedBy})`);

    // Check if this lead has existing SMS messages (not just any channel)
    // This matters for cross-channel matching where the lead might already have email messages.
    const smsMessageCount = await prisma.message.count({
      where: { leadId: leadResult.lead.id, channel: "sms" },
    });
    const hasNoSmsMessages = smsMessageCount === 0;

    console.log(`Lead status: ${isNewLead ? "NEW" : "EXISTING"}, hasSmsMessages: ${!hasNoSmsMessages}`);

    // Fetch conversation history from GHL
    // Do this for new leads OR leads with no messages (to backfill history)
    let transcript = "";
    let historicalMessages: GHLExportedMessage[] = [];

    if (isNewLead || hasNoSmsMessages) {
      console.log("[History Import] Fetching full conversation history from GHL...");
      const historyResult = await fetchGHLConversationHistory(
        locationId,
        contactId,
        client.ghlPrivateKey
      );
      historicalMessages = historyResult.messages;
      console.log(`[History Import] Got ${historicalMessages.length} historical messages`);

      // Ensure the *current* inbound webhook message is included for classification.
      // GHL's export API can lag and omit the latest inbound message, which would otherwise
      // cause the model to classify based on outbound-only history.
      const lastHistorical = historicalMessages[historicalMessages.length - 1];
      const shouldAppendWebhook =
        !!messageBody?.trim() &&
        !(
          lastHistorical &&
          lastHistorical.direction === "inbound" &&
          lastHistorical.body.trim() === messageBody.trim()
        );

      const transcriptMessages = [
        ...historicalMessages.map((m) => ({
          sentAt: m.dateAdded,
          channel: "sms",
          direction: m.direction,
          body: m.body,
        })),
        ...(shouldAppendWebhook
          ? [
              {
                sentAt: webhookMessageTime!,
                channel: "sms",
                direction: "inbound" as const,
                body: messageBody,
              },
            ]
          : []),
      ];

      transcript = buildSentimentTranscriptFromMessages(transcriptMessages);
    } else {
      // For existing leads, include turn-by-turn context (with timestamps) so ultra-short replies
      // like "yes/ok/sure" can be classified correctly based on what the agent asked right before.
      const recentSmsMessages = await prisma.message.findMany({
        where: { leadId: leadResult.lead.id, channel: "sms" },
        orderBy: { sentAt: "desc" },
        take: 25,
        select: {
          sentAt: true,
          channel: true,
          direction: true,
          body: true,
        },
      });

      transcript = buildSentimentTranscriptFromMessages([
        ...recentSmsMessages.reverse(),
        {
          sentAt: webhookMessageTime!,
          channel: "sms",
          direction: "inbound",
          body: messageBody,
        },
      ]);
    }

    // Track if we're clearing a "Follow Up" or "Snoozed" tag (for logging)
    const previousSentiment = leadResult.lead.sentimentTag;
    const wasFollowUp = previousSentiment === "Follow Up" || previousSentiment === "Snoozed";

    // Classify sentiment using AI
    // Note: Any inbound reply will reclassify sentiment, clearing "Follow Up" or "Snoozed" tags
    const sentimentTag = await classifySentiment(transcript || messageBody, {
      clientId: client.id,
      leadId: leadResult.lead.id,
      maxRetries: 1,
    });
    console.log(`AI Classification: ${sentimentTag}`);

    // Log when "Follow Up" or "Snoozed" tag is being cleared by a reply
    if (wasFollowUp) {
      console.log(`[FOLLOWUP_CLEARED] Lead ${leadResult.lead.id} replied via SMS - clearing "${previousSentiment}" tag, new sentiment: ${sentimentTag}`);
    }

    // Determine lead status based on sentiment
    const leadStatus = SENTIMENT_TO_STATUS[sentimentTag] || "new";
    console.log(`Lead status: ${leadStatus}`);

    // Update lead with sentiment classification
    const lead = await prisma.lead.update({
      where: { id: leadResult.lead.id },
      data: {
        sentimentTag,
        status: leadStatus,
      },
    });

    console.log(`Updated lead ${lead.id} with sentiment: ${sentimentTag}`);

    await autoStartMeetingRequestedSequenceIfEligible({
      leadId: lead.id,
      previousSentiment,
      newSentiment: sentimentTag,
    });

    // Any inbound message pauses active follow-up sequences (re-engage after 7 days of no inbound).
    await pauseFollowUpsOnReply(lead.id);

    // If the lead asks to reconnect after a specific date, snooze/pause follow-ups until then.
    const inboundText = (messageBody || "").trim();
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

    // Import historical messages if this is a new lead or has no messages
    let importedMessagesCount = 0;
    let healedMessagesCount = 0;
    const isFirstInbound = isNewLead || hasNoSmsMessages;

    if (isFirstInbound && historicalMessages.length > 0) {
      console.log(`[History Import] Importing ${historicalMessages.length} messages...`);
      const importResult = await importHistoricalMessages(lead.id, historicalMessages);
      importedMessagesCount = importResult.imported;
      healedMessagesCount = importResult.healed;
      console.log(`[History Import] Imported ${importedMessagesCount} new, healed ${healedMessagesCount}`);

      // IMPORTANT: Check if the current webhook message was in the history
      // GHL's export API might not include the very latest message due to indexing delay
      // We save without ghlId here - it will be "healed" on next sync
      if (messageBody) {
        // Check by ghlId first (from history), then by content
        const normalizedWebhookBody = messageBody.trim();
        const currentMsgInHistory = historicalMessages.find(
          (m) => m.direction === "inbound" && m.body.trim() === normalizedWebhookBody
        );

        if (currentMsgInHistory) {
          // Already imported with ghlId from history
          console.log(`[Webhook] Current message already in history with ghlId: ${currentMsgInHistory.id}`);
        } else {
          // Not in history - save without ghlId (will be healed on next sync)
          console.log(`[Webhook] Current message not in history, saving without ghlId...`);
          const windowStart = new Date(webhookMessageTime.getTime() - 60_000);
          const windowEnd = new Date(webhookMessageTime.getTime() + 60_000);

          const existing = await prisma.message.findFirst({
            where: {
              leadId: lead.id,
              channel: "sms",
              direction: "inbound",
              body: messageBody,
              sentAt: { gte: windowStart, lte: windowEnd },
            },
            select: { id: true },
          });

          if (existing) {
            console.log(`[Webhook] Skipping duplicate inbound message (existing id: ${existing.id})`);
          } else {
            await prisma.message.create({
              data: {
                body: messageBody,
                direction: "inbound",
                channel: "sms",
                leadId: lead.id,
                sentAt: webhookMessageTime,
                // ghlId will be added on next sync
              },
            } as any);
            await bumpLeadMessageRollup({ leadId: lead.id, direction: "inbound", sentAt: webhookMessageTime });
            importedMessagesCount++;
            console.log(`[Webhook] Saved current inbound message @ ${webhookMessageTime.toISOString()}`);
          }
        }
      }
    } else if (messageBody) {
      // For existing leads with messages, save the current message
      // Check by ghlId first (if we have it from a previous sync)
      // Webhook payload doesn't include ghlId, so we check by content
      const windowStart = new Date(webhookMessageTime.getTime() - 60_000);
      const windowEnd = new Date(webhookMessageTime.getTime() + 60_000);

      const existingByContent = await prisma.message.findFirst({
        where: {
          leadId: lead.id,
          channel: "sms",
          body: messageBody,
          direction: "inbound",
          sentAt: { gte: windowStart, lte: windowEnd },
        },
      });

      if (!existingByContent) {
        const message = await prisma.message.create({
          data: {
            body: messageBody,
            direction: "inbound",
            channel: "sms",
            leadId: lead.id,
            sentAt: webhookMessageTime,
            // ghlId will be added on next sync
          },
        } as any);
        await bumpLeadMessageRollup({ leadId: lead.id, direction: "inbound", sentAt: webhookMessageTime });
        console.log(`Created message: ${message.id} @ ${webhookMessageTime.toISOString()}`);
      } else {
        console.log(`[Webhook] Message already exists (id: ${existingByContent.id})`);
      }
    }

    // NOTE: Avoid invoking Server Actions from webhook context (no user session cookies).
    // If message healing/backfill is required beyond the first inbound import, run it from an
    // internal/cron-safe path instead of a user-authenticated Server Action.

    // Auto-booking: only books when the lead clearly accepts one of the offered slots.
    // If ambiguous, it creates a follow-up task instead (no booking).
    const autoBook = await processMessageForAutoBooking(lead.id, messageBody);
    if (autoBook.booked) {
      console.log(`[Auto-Book] Booked appointment for lead ${lead.id}: ${autoBook.appointmentId}`);
    }

    // Generate AI draft if appropriate for this sentiment
    let draftId: string | undefined;
    if (!autoBook.booked && shouldGenerateDraft(sentimentTag)) {
      try {
        const webhookDraftTimeoutMs =
          Number.parseInt(process.env.OPENAI_DRAFT_WEBHOOK_TIMEOUT_MS || "30000", 10) || 30_000;

        const draftResult = await generateResponseDraft(
          lead.id,
          transcript || `Lead: ${messageBody}`,
          sentimentTag,
          "sms",
          { timeoutMs: webhookDraftTimeoutMs }
        );
        if (draftResult.success) {
          draftId = draftResult.draftId;
          const draftContent = draftResult.content || "";
          console.log(`Generated AI draft: ${draftId}`);

          const emailCampaign = lead.emailCampaignId
            ? await prisma.emailCampaign.findUnique({
                where: { id: lead.emailCampaignId },
                select: { responseMode: true, autoSendConfidenceThreshold: true, name: true, bisonCampaignId: true },
              })
            : null;

          const responseMode = emailCampaign?.responseMode ?? null;
          const autoSendThreshold = emailCampaign?.autoSendConfidenceThreshold ?? 0.9;

          if (responseMode === "AI_AUTO_SEND" && draftId && draftContent) {
            const evaluation = await evaluateAutoSend({
              clientId: client.id,
              leadId: lead.id,
              channel: "sms",
              latestInbound: messageBody,
              subject: null,
              conversationHistory: transcript || `Lead: ${messageBody}`,
              categorization: sentimentTag,
              automatedReply: null,
              replyReceivedAt: webhookMessageTime,
              draft: draftContent,
            });

            if (evaluation.safeToSend && evaluation.confidence >= autoSendThreshold) {
              console.log(
                `[Auto-Send] Sending draft ${draftId} for lead ${lead.id} (confidence ${evaluation.confidence.toFixed(2)} >= ${autoSendThreshold.toFixed(2)})`
              );
              const sendResult = await approveAndSendDraftSystem(draftId, { sentBy: "ai" });
              if (sendResult.success) {
                console.log(`[Auto-Send] Sent message: ${sendResult.messageId}`);
                // Draft status is now 'approved' in DB
              } else {
                console.error(`[Auto-Send] Failed to send draft: ${sendResult.error}`);
              }
            } else {
              const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
              const campaignLabel = emailCampaign ? `${emailCampaign.name} (${emailCampaign.bisonCampaignId})` : "Unknown campaign";
              const url = `${getPublicAppUrl()}/?view=inbox&leadId=${lead.id}`;
              const confidenceText = `${evaluation.confidence.toFixed(2)} < ${autoSendThreshold.toFixed(2)}`;

              const dmResult = await sendSlackDmByEmail({
                email: "jon@zeroriskgrowth.com",
                dedupeKey: `auto_send_review:${draftId}`,
                text: `AI auto-send review needed (${confidenceText})`,
                blocks: [
                  { type: "header", text: { type: "plain_text", text: "AI Auto-Send: Review Needed", emoji: true } },
                  {
                    type: "section",
                    fields: [
                      { type: "mrkdwn", text: `*Lead:*\n${leadName}${lead.email ? `\n${lead.email}` : ""}` },
                      { type: "mrkdwn", text: `*Campaign:*\n${campaignLabel}` },
                      { type: "mrkdwn", text: `*Sentiment:*\n${sentimentTag || "Unknown"}` },
                      { type: "mrkdwn", text: `*Confidence:*\n${evaluation.confidence.toFixed(2)} (thresh ${autoSendThreshold.toFixed(2)})` },
                    ],
                  },
                  { type: "section", text: { type: "mrkdwn", text: `*Reason:*\n${evaluation.reason}` } },
                  {
                    type: "section",
                    text: { type: "mrkdwn", text: `*Draft Preview:*\n\`\`\`\n${draftContent.slice(0, 1400)}\n\`\`\`` },
                  },
                  { type: "section", text: { type: "mrkdwn", text: `<${url}|Open lead in dashboard>` } },
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
              channel: "sms",
              latestInbound: messageBody,
              subject: null,
              conversationHistory: transcript || `Lead: ${messageBody}`,
              categorization: sentimentTag,
              automatedReply: null,
              replyReceivedAt: webhookMessageTime,
            });

            if (!decision.shouldReply) {
              console.log(`[Auto-Reply] Skipped auto-send for lead ${lead.id}: ${decision.reason}`);
            } else {
              console.log(`[Auto-Reply] Auto-approving draft ${draftId} for lead ${lead.id}`);
              const sendResult = await approveAndSendDraftSystem(draftId, { sentBy: "ai" });
              if (sendResult.success) {
                console.log(`[Auto-Reply] Sent message: ${sendResult.messageId}`);
                // Draft status is now 'approved' in DB
              } else {
                console.error(`[Auto-Reply] Failed to send draft: ${sendResult.error}`);
              }
            }
          }
        } else {
          console.error("Failed to generate AI draft:", draftResult.error);
        }
      } catch (error) {
        console.error("Error generating AI draft:", error);
      }
    } else {
      console.log(`Skipping AI draft for sentiment: ${sentimentTag}`);
    }

    // TODO: Auto-FollowUp feature - if lead.autoFollowUpEnabled is true, schedule follow-up tasks

    console.log("=== Webhook Processing Complete ===");
    console.log(`Lead ID: ${lead.id}`);
    console.log(`Sentiment: ${sentimentTag}`);
    console.log(`Status: ${leadStatus}`);
    console.log(`Imported Messages: ${importedMessagesCount}, Healed: ${healedMessagesCount}`);
    console.log(`Draft ID: ${draftId || "none"}`);

    return NextResponse.json({
      success: true,
      leadId: lead.id,
      contactId,
      sentimentTag,
      status: leadStatus,
      importedMessages: importedMessagesCount,
      draftId,
      message: "Webhook processed successfully",
    });
    } catch (error) {
      console.error("Webhook processing error:", error);
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

/**
 * GET handler for webhook health check
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "GHL SMS webhook endpoint is active",
    timestamp: new Date().toISOString(),
    endpoints: {
      webhook: "POST /api/webhooks/ghl/sms",
      healthCheck: "GET /api/webhooks/ghl/sms",
    },
  });
}
