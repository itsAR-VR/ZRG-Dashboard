import "server-only";

import { prisma } from "@/lib/prisma";
import { exportMessages, getConversationByContact, getConversationMessages, getGHLContact } from "@/lib/ghl-api";
import { fetchEmailBisonReplies, fetchEmailBisonSentEmails } from "@/lib/emailbison-api";
import { recomputeLeadMessageRollups } from "@/lib/lead-message-rollups";
import {
  buildSentimentTranscriptFromMessages,
  classifySentiment,
  detectBounce,
  isPositiveSentiment,
  SENTIMENT_TO_STATUS,
  type SentimentTag,
} from "@/lib/sentiment";
import { shouldGenerateDraft } from "@/lib/ai-drafts";
import { normalizeEmail } from "@/lib/lead-matching";
import { toStoredPhone } from "@/lib/phone-utils";

export type SyncOptions = {
  forceReclassify?: boolean;
};

export type SyncHistoryResult = {
  success: boolean;
  importedCount?: number;
  healedCount?: number;
  totalMessages?: number;
  skippedDuplicates?: number;
  reclassifiedSentiment?: boolean;
  leadUpdated?: boolean;
  error?: string;
};

function isValidGhlContactId(value: string): boolean {
  return /^[A-Za-z0-9]{15,64}$/.test(value);
}

function preClassifySentiment(messages: { direction: string }[]): SentimentTag | null {
  if (messages.length === 0) {
    return "New";
  }

  const hasInboundMessages = messages.some((m) => m.direction === "inbound");
  if (!hasInboundMessages) {
    console.log("[PreClassify] Lead has never responded → New");
    return "New";
  }

  return null;
}

async function computeSentimentFromMessages(
  messages: { body: string; direction: string; channel?: string | null; subject?: string | null; sentAt: Date }[],
  opts: { clientId: string; leadId: string }
): Promise<SentimentTag> {
  const preClassified = preClassifySentiment(messages);
  if (preClassified !== null) {
    return preClassified;
  }

  if (detectBounce(messages)) {
    console.log("[Sentiment] Bounce detected via regex → Blacklist");
    return "Blacklist";
  }

  const transcript = buildSentimentTranscriptFromMessages(messages.slice(-80));
  if (transcript.trim().length === 0) {
    return "Neutral";
  }

  return classifySentiment(transcript, { clientId: opts.clientId, leadId: opts.leadId });
}

async function refreshLeadSentimentTagSystem(leadId: string, clientId: string): Promise<{
  sentimentTag: SentimentTag;
  status: string;
}> {
  const messages = await prisma.message.findMany({
    where: { leadId },
    select: { body: true, direction: true, channel: true, subject: true, sentAt: true },
    orderBy: { sentAt: "asc" },
  });

  const sentimentTag = await computeSentimentFromMessages(messages, { clientId, leadId });
  const status = SENTIMENT_TO_STATUS[sentimentTag] || "new";

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  let lastInboundAt: Date | null = null;
  let lastOutboundAt: Date | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!lastInboundAt && msg.direction === "inbound") lastInboundAt = msg.sentAt;
    if (!lastOutboundAt && msg.direction === "outbound") lastOutboundAt = msg.sentAt;
    if (lastInboundAt && lastOutboundAt) break;
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      sentimentTag,
      status,
      lastInboundAt,
      lastOutboundAt,
      lastMessageAt: lastMessage?.sentAt ?? null,
      lastMessageDirection: (lastMessage?.direction as string | undefined) ?? null,
    },
  });

  if (!isPositiveSentiment(sentimentTag)) {
    await prisma.lead.updateMany({
      where: { id: leadId, enrichmentStatus: "pending" },
      data: { enrichmentStatus: "not_needed" },
    });
  }

  if (!shouldGenerateDraft(sentimentTag)) {
    await prisma.aIDraft.updateMany({
      where: { leadId, status: "pending" },
      data: { status: "rejected" },
    });
  }

  return { sentimentTag, status };
}

export async function syncSmsConversationHistorySystem(
  leadId: string,
  options: SyncOptions = {}
): Promise<SyncHistoryResult> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        client: {
          select: {
            ghlPrivateKey: true,
            ghlLocationId: true,
          },
        },
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    const smsMessageCount = await prisma.message.count({
      where: {
        leadId,
        channel: "sms",
      },
    });

    if (!lead.ghlContactId) {
      const hasSmsMessages = smsMessageCount > 0;
      if (hasSmsMessages) {
        return {
          success: false,
          error: "Cannot sync SMS: Lead was created from email only (no GHL contact ID)",
        };
      }
      return { success: false, error: "Lead has no GHL contact ID" };
    }

    if (!isValidGhlContactId(lead.ghlContactId)) {
      console.warn(`[Sync] Skipping SMS history sync for invalid GHL contact ID on lead ${leadId}`);
      return {
        success: true,
        importedCount: 0,
        healedCount: 0,
        totalMessages: smsMessageCount,
        skippedDuplicates: 0,
        reclassifiedSentiment: false,
        leadUpdated: false,
      };
    }

    if (!lead.client.ghlPrivateKey || !lead.client.ghlLocationId) {
      return { success: false, error: "Workspace is missing GHL configuration" };
    }

    // Best-effort: hydrate missing lead fields from the GHL contact record.
    // This fixes cases where the SMS webhook payload omitted phone/email, which prevents the UI
    // from showing the SMS channel and blocks follow-up automation.
    let leadUpdated = false;
    if (!lead.phone || !lead.email || !lead.firstName || !lead.lastName || !lead.companyName) {
      try {
        const contactResult = await getGHLContact(lead.ghlContactId, lead.client.ghlPrivateKey, {
          locationId: lead.client.ghlLocationId,
        });
        const contact = contactResult.success ? contactResult.data?.contact : null;

        if (contact) {
          const updateData: Record<string, unknown> = {};

          if (!lead.phone && contact.phone) {
            updateData.phone = toStoredPhone(contact.phone) || contact.phone;
          }
          if (!lead.email && contact.email) {
            updateData.email = normalizeEmail(contact.email) || contact.email;
          }
          if (!lead.firstName && contact.firstName) {
            updateData.firstName = contact.firstName;
          }
          if (!lead.lastName && contact.lastName) {
            updateData.lastName = contact.lastName;
          }
          if (!lead.companyName && contact.companyName) {
            updateData.companyName = contact.companyName;
          }

          // If we found a phone, treat this as enrichment completion.
          if (updateData.phone && lead.enrichmentStatus !== "not_needed") {
            updateData.enrichmentStatus = "enriched";
            updateData.enrichmentSource = "ghl";
            updateData.enrichedAt = new Date();
          }

          if (Object.keys(updateData).length > 0) {
            await prisma.lead.update({
              where: { id: leadId },
              data: updateData,
            });
            leadUpdated = true;
          }
        }
      } catch (err) {
        console.warn("[Sync] Failed to hydrate lead from GHL contact:", err);
      }
    }

    console.log(`[Sync] Fetching SMS history for lead ${leadId} (contact: ${lead.ghlContactId})`);

    const startedAtMs = Date.now();
    const maxPages = Number(process.env.GHL_EXPORT_MAX_PAGES || "") || 5;
    const maxMessages = Number(process.env.GHL_EXPORT_MAX_MESSAGES || "") || 2000;

    type NormalizedGhlMessage = {
      id: string;
      direction: "inbound" | "outbound";
      body: string;
      dateAdded: string;
    };

    let ghlMessages: NormalizedGhlMessage[] = [];

    let exportError: string | null = null;

    const fetchViaExport = async (): Promise<NormalizedGhlMessage[]> => {
      try {
        const seenCursors = new Set<string>();
        let cursor: string | null = null;
        const collected: NormalizedGhlMessage[] = [];

        for (let page = 0; page < maxPages; page += 1) {
          const exportResult = await exportMessages(
            lead.client.ghlLocationId,
            lead.ghlContactId,
            lead.client.ghlPrivateKey,
            "SMS",
            { cursor }
          );

          if (!exportResult.success || !exportResult.data) {
            exportError = exportResult.error || "Failed to fetch messages from GHL";
            break;
          }

          const pageMessages = exportResult.data.messages || [];
          for (const msg of pageMessages) {
            collected.push({
              id: msg.id,
              direction: msg.direction,
              body: msg.body,
              dateAdded: msg.dateAdded,
            });
          }

          if (collected.length >= maxMessages) break;

          const nextCursor = exportResult.data.nextCursor;
          if (!nextCursor) break;
          if (seenCursors.has(nextCursor)) break;
          seenCursors.add(nextCursor);
          cursor = nextCursor;
        }

        return collected;
      } catch (err) {
        exportError = err instanceof Error ? err.message : "Failed to fetch messages from GHL";
        return [];
      }
    };

    const fetchViaConversation = async (): Promise<{
      conversationId: string | null;
      conversationLastMs: number | null;
      messages: NormalizedGhlMessage[];
    }> => {
      try {
        const conv = await getConversationByContact(lead.ghlContactId, lead.client.ghlPrivateKey, {
          locationId: lead.client.ghlLocationId,
        });
        const conversationId = conv.success ? conv.data?.id || null : null;
        const candidateLastMs =
          conv.success && conv.data?.lastMessageDate ? Date.parse(conv.data.lastMessageDate) : NaN;
        const conversationLastMs = Number.isNaN(candidateLastMs) ? null : candidateLastMs;

        if (!conversationId) {
          return { conversationId: null, conversationLastMs, messages: [] };
        }

        const messagesResult = await getConversationMessages(conversationId, lead.client.ghlPrivateKey);
        const messages = messagesResult.success ? messagesResult.data?.messages || [] : [];

        const mapped = messages
          .map((m: any) => {
            const messageType = typeof m.messageType === "string" ? m.messageType.toLowerCase() : "";
            const isSms = !messageType || messageType.includes("sms");
            if (!isSms) return null;

            return {
              id: String(m.id),
              direction: m.direction === "inbound" ? ("inbound" as const) : ("outbound" as const),
              body: String(m.body || ""),
              dateAdded: String(m.dateAdded || ""),
            };
          })
          .filter((m): m is NormalizedGhlMessage => Boolean(m))
          .filter((m) => Boolean(m.id) && Boolean(m.dateAdded));

        return { conversationId, conversationLastMs, messages: mapped };
      } catch {
        return { conversationId: null, conversationLastMs: null, messages: [] };
      }
    };

    const preferConversation = smsMessageCount > 0;

    if (preferConversation) {
      const conv = await fetchViaConversation();
      ghlMessages = conv.messages;

      if (ghlMessages.length === 0) {
        ghlMessages = await fetchViaExport();
      }
    } else {
      ghlMessages = await fetchViaExport();

      const conv = await fetchViaConversation();
      const convMessages = conv.messages;

      const newestExportMs =
        ghlMessages.length > 0 ? Math.max(...ghlMessages.map((m) => Date.parse(m.dateAdded))) : null;

      const exportLooksStale =
        newestExportMs != null &&
        Number.isFinite(newestExportMs) &&
        conv.conversationLastMs != null &&
        Number.isFinite(conv.conversationLastMs) &&
        conv.conversationLastMs > newestExportMs + 60_000;

      if (convMessages.length > 0 && (ghlMessages.length === 0 || exportLooksStale)) {
        const byId = new Map(ghlMessages.map((m) => [m.id, m]));
        for (const m of convMessages) byId.set(m.id, m);
        ghlMessages = Array.from(byId.values());
      }
    }

    const durationMs = Date.now() - startedAtMs;
    console.log(`[Sync] Fetched ${ghlMessages.length} SMS messages from GHL in ${durationMs}ms`);

    if (ghlMessages.length === 0 && exportError) {
      return { success: false, error: exportError };
    }

    let importedCount = 0;
    let healedCount = 0;
    let skippedDuplicates = 0;
    let touchedInbound = false;

    for (const msg of ghlMessages) {
      try {
        const msgTimestamp = new Date(msg.dateAdded);
        const ghlId = msg.id;

        const sentWindowStart = new Date(msgTimestamp.getTime() - 60_000);
        const sentWindowEnd = new Date(msgTimestamp.getTime() + 60_000);
        const createdWindowStart = new Date(msgTimestamp.getTime() - 10 * 60_000);
        const createdWindowEnd = new Date(msgTimestamp.getTime() + 10 * 60_000);
        const farSentWindowStart = new Date(msgTimestamp.getTime() - 30 * 60_000);
        const farSentWindowEnd = new Date(msgTimestamp.getTime() + 30 * 60_000);

        const existingByGhlId = await prisma.message.findUnique({
          where: { ghlId },
        });

        if (existingByGhlId) {
          if (existingByGhlId.sentAt.getTime() !== msgTimestamp.getTime()) {
            await prisma.message.update({
              where: { ghlId },
              data: { sentAt: msgTimestamp },
            });
            console.log(`[Sync] Fixed timestamp for ghlId ${ghlId}`);
            healedCount++;
          } else {
            skippedDuplicates++;
          }

          const removed = await prisma.message.deleteMany({
            where: {
              leadId,
              channel: "sms",
              body: msg.body,
              direction: msg.direction,
              ghlId: null,
              OR: [
                {
                  sentAt: {
                    gte: sentWindowStart,
                    lte: sentWindowEnd,
                  },
                },
                {
                  createdAt: {
                    gte: createdWindowStart,
                    lte: createdWindowEnd,
                  },
                  OR: [
                    { sentAt: { lt: farSentWindowStart } },
                    { sentAt: { gt: farSentWindowEnd } },
                  ],
                },
              ],
            },
          });

          if (removed.count > 0) {
            console.log(`[Sync] Removed ${removed.count} duplicate legacy message(s) for ghlId ${ghlId}`);
          }
          continue;
        }

        const existingByContent = await prisma.message.findFirst({
          where: {
            leadId,
            channel: "sms",
            body: msg.body,
            direction: msg.direction,
            ghlId: null,
            OR: [
              {
                sentAt: {
                  gte: sentWindowStart,
                  lte: sentWindowEnd,
                },
              },
              {
                createdAt: {
                  gte: createdWindowStart,
                  lte: createdWindowEnd,
                },
              },
            ],
          },
          orderBy: { createdAt: "desc" },
        });

        if (existingByContent) {
          await prisma.message.update({
            where: { id: existingByContent.id },
            data: {
              ghlId,
              sentAt: msgTimestamp,
            },
          });
          healedCount++;
          console.log(
            `[Sync] Healed: "${msg.body.substring(0, 30)}..." -> ghlId: ${ghlId}, sentAt: ${msgTimestamp.toISOString()}`
          );

          const removed = await prisma.message.deleteMany({
            where: {
              leadId,
              channel: "sms",
              body: msg.body,
              direction: msg.direction,
              ghlId: null,
              OR: [
                {
                  sentAt: {
                    gte: sentWindowStart,
                    lte: sentWindowEnd,
                  },
                },
                {
                  createdAt: {
                    gte: createdWindowStart,
                    lte: createdWindowEnd,
                  },
                  OR: [
                    { sentAt: { lt: farSentWindowStart } },
                    { sentAt: { gt: farSentWindowEnd } },
                  ],
                },
              ],
            },
          });

          if (removed.count > 0) {
            console.log(
              `[Sync] Removed ${removed.count} duplicate legacy message(s) after healing ghlId ${ghlId}`
            );
          }
          continue;
        }

        await prisma.message.create({
          data: {
            ghlId,
            body: msg.body,
            direction: msg.direction,
            channel: "sms",
            leadId,
            sentAt: msgTimestamp,
          },
        });
        importedCount++;
        if (msg.direction === "inbound") touchedInbound = true;
        console.log(
          `[Sync] Imported: "${msg.body.substring(0, 30)}..." (${msg.direction}) @ ${msgTimestamp.toISOString()}`
        );
      } catch (error) {
        console.error(`[Sync] Error processing message ${msg.id}: ${error}`);
      }
    }

    console.log(`[Sync] Complete: ${importedCount} imported, ${healedCount} healed, ${skippedDuplicates} unchanged`);

    await recomputeLeadMessageRollups(leadId);

    let reclassifiedSentiment = false;
    const shouldReclassify = Boolean(options.forceReclassify) || touchedInbound;

    if (shouldReclassify) {
      try {
        const { sentimentTag, status } = await refreshLeadSentimentTagSystem(leadId, lead.clientId);
        reclassifiedSentiment = true;
        console.log(
          `[Sync] Reclassified sentiment to ${sentimentTag} and status to ${status}${options.forceReclassify ? " (forced)" : ""}`
        );
      } catch (reclassError) {
        console.error("[Sync] Failed to refresh sentiment after sync:", reclassError);
      }
    } else {
      console.log("[Sync] Skipping sentiment reclassification - no inbound changes detected");
    }

    return {
      success: true,
      importedCount,
      healedCount,
      totalMessages: ghlMessages.length,
      skippedDuplicates,
      reclassifiedSentiment,
      leadUpdated,
    };
  } catch (error) {
    console.error("[Sync] Failed to sync conversation history:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function cleanEmailBody(htmlBody?: string | null, textBody?: string | null): string {
  const source = textBody || htmlBody || "";
  if (!source.trim()) return "";

  return source
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 500);
}

export async function syncEmailConversationHistorySystem(
  leadId: string,
  options: SyncOptions = {}
): Promise<SyncHistoryResult> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        client: {
          select: {
            emailBisonApiKey: true,
          },
        },
        _count: {
          select: {
            messages: {
              where: { channel: "email" },
            },
          },
        },
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    if (!lead.emailBisonLeadId) {
      const hasEmailMessages = lead._count.messages > 0;
      if (hasEmailMessages) {
        return {
          success: false,
          error:
            "Cannot sync: Lead emails came from a bounce notification or external source (no EmailBison lead ID)",
        };
      }
      return { success: false, error: "Lead has no EmailBison lead ID" };
    }

    if (!lead.client.emailBisonApiKey) {
      return { success: false, error: "Workspace is missing EmailBison API key" };
    }

    console.log(
      `[EmailSync] Fetching conversation history for lead ${leadId} (EmailBison ID: ${lead.emailBisonLeadId})`
    );

    const repliesResult = await fetchEmailBisonReplies(lead.client.emailBisonApiKey, lead.emailBisonLeadId);
    if (!repliesResult.success) {
      return { success: false, error: repliesResult.error || "Failed to fetch replies from EmailBison" };
    }

    const sentResult = await fetchEmailBisonSentEmails(lead.client.emailBisonApiKey, lead.emailBisonLeadId);
    if (!sentResult.success) {
      return { success: false, error: sentResult.error || "Failed to fetch sent emails from EmailBison" };
    }

    const replies = repliesResult.data || [];
    const sentEmails = sentResult.data || [];

    console.log(`[EmailSync] Found ${replies.length} replies and ${sentEmails.length} sent emails in EmailBison`);

    let importedCount = 0;
    let healedCount = 0;
    let skippedDuplicates = 0;
    let touchedInbound = false;

    for (const reply of replies) {
      try {
        const emailBisonReplyId = String(reply.id);
        const msgTimestamp = reply.date_received
          ? new Date(reply.date_received)
          : reply.created_at
            ? new Date(reply.created_at)
            : new Date();

        const subject = reply.subject || null;
        const body = cleanEmailBody(reply.html_body, reply.text_body);
        const folder = (reply.folder || "").toLowerCase();
        const type = (reply.type || "").toLowerCase();
        const isOutbound = folder === "sent" || type.includes("outgoing");
        const direction = isOutbound ? ("outbound" as const) : ("inbound" as const);

        if (!body) {
          console.log(`[EmailSync] Skipping reply ${emailBisonReplyId}: empty body`);
          continue;
        }

        const existingByReplyId = await prisma.message.findUnique({
          where: { emailBisonReplyId },
        });

        if (existingByReplyId) {
          const updateData: Record<string, unknown> = {};
          if (existingByReplyId.sentAt.getTime() !== msgTimestamp.getTime()) {
            updateData.sentAt = msgTimestamp;
          }
          if (existingByReplyId.direction !== direction) {
            updateData.direction = direction;
          }
          if (isOutbound && existingByReplyId.isRead !== true) {
            updateData.isRead = true;
          }

          if (Object.keys(updateData).length > 0) {
            await prisma.message.update({
              where: { emailBisonReplyId },
              data: updateData,
            });
            console.log(`[EmailSync] Healed replyId ${emailBisonReplyId} (${Object.keys(updateData).join(", ")})`);
            healedCount++;
            if (updateData.direction === "inbound") touchedInbound = true;
          } else {
            skippedDuplicates++;
          }
          continue;
        }

        const existingByContent = await prisma.message.findFirst({
          where: {
            leadId,
            channel: "email",
            emailBisonReplyId: null,
            OR: [
              { body: { contains: body.substring(0, 100) } },
              ...(subject ? [{ subject }] : []),
            ],
            ...(isOutbound ? {} : { direction: "inbound" }),
          },
        });

        if (existingByContent) {
          await prisma.message.update({
            where: { id: existingByContent.id },
            data: {
              emailBisonReplyId,
              sentAt: msgTimestamp,
              subject: subject || existingByContent.subject,
              direction,
              ...(isOutbound ? { isRead: true } : {}),
            },
          });
          healedCount++;
          if (direction === "inbound") touchedInbound = true;
          console.log(`[EmailSync] Healed reply: "${body.substring(0, 30)}..." -> replyId: ${emailBisonReplyId}`);
          continue;
        }

        await prisma.message.create({
          data: {
            emailBisonReplyId,
            channel: "email",
            source: "zrg",
            body,
            rawHtml: reply.html_body ?? null,
            rawText: reply.text_body ?? null,
            subject,
            direction,
            ...(isOutbound ? { isRead: true } : {}),
            leadId,
            sentAt: msgTimestamp,
          },
        });
        importedCount++;
        if (direction === "inbound") touchedInbound = true;
        console.log(`[EmailSync] Imported reply: "${body.substring(0, 30)}..." @ ${msgTimestamp.toISOString()}`);
      } catch (error) {
        console.error(`[EmailSync] Error processing reply ${reply.id}:`, error);
      }
    }

    for (const sentEmail of sentEmails) {
      try {
        const inboxxiaScheduledEmailId = String(sentEmail.id);
        const msgTimestamp = sentEmail.sent_at ? new Date(sentEmail.sent_at) : new Date();
        const body = sentEmail.email_body || "";
        const subject = sentEmail.email_subject || null;

        if (!body) {
          continue;
        }

        const existingByEmailId = await prisma.message.findUnique({
          where: { inboxxiaScheduledEmailId },
        });

        if (existingByEmailId) {
          skippedDuplicates++;
          continue;
        }

        const existingByContent = await prisma.message.findFirst({
          where: {
            leadId,
            direction: "outbound",
            channel: "email",
            inboxxiaScheduledEmailId: null,
            body: { contains: body.substring(0, 100) },
          },
        });

        if (existingByContent) {
          await prisma.message.update({
            where: { id: existingByContent.id },
            data: {
              inboxxiaScheduledEmailId,
              sentAt: msgTimestamp,
            },
          });
          healedCount++;
          continue;
        }

        await prisma.message.create({
          data: {
            inboxxiaScheduledEmailId,
            channel: "email",
            source: "inboxxia_campaign",
            body,
            rawHtml: body,
            subject,
            direction: "outbound",
            isRead: true,
            leadId,
            sentAt: msgTimestamp,
          },
        });
        importedCount++;
        console.log(`[EmailSync] Imported sent email: "${body.substring(0, 30)}..."`);
      } catch (error) {
        console.error(`[EmailSync] Error processing sent email ${sentEmail.id}:`, error);
      }
    }

    console.log(`[EmailSync] Complete: ${importedCount} imported, ${healedCount} healed, ${skippedDuplicates} unchanged`);

    await recomputeLeadMessageRollups(leadId);

    let reclassifiedSentiment = false;
    const shouldReclassify = Boolean(options.forceReclassify) || touchedInbound;

    if (shouldReclassify) {
      try {
        const { sentimentTag } = await refreshLeadSentimentTagSystem(leadId, lead.clientId);
        reclassifiedSentiment = true;
        console.log(`[EmailSync] Reclassified sentiment to ${sentimentTag}${options.forceReclassify ? " (forced)" : ""}`);
      } catch (reclassError) {
        console.error("[EmailSync] Failed to refresh sentiment after sync:", reclassError);
      }
    } else {
      console.log("[EmailSync] Skipping sentiment reclassification - no inbound changes detected");
    }

    return {
      success: true,
      importedCount,
      healedCount,
      totalMessages: replies.length + sentEmails.length,
      skippedDuplicates,
      reclassifiedSentiment,
    };
  } catch (error) {
    console.error("[EmailSync] Failed to sync email conversation history:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
