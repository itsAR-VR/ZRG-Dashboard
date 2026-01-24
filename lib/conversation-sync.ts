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

  const leadEmail = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { email: true },
  });

  if (!shouldGenerateDraft(sentimentTag, leadEmail?.email ?? null)) {
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

      // Common/expected for email-only leads. Treat as a no-op instead of a failure
      // to avoid noisy warnings and pointless retries.
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

    // TypeScript narrowing: after the null/validity checks above, we know ghlContactId is a valid string
    const ghlContactId = lead.ghlContactId;

    const ghlPrivateKey = lead.client.ghlPrivateKey;
    const ghlLocationId = lead.client.ghlLocationId;
    if (!ghlPrivateKey || !ghlLocationId) {
      return { success: false, error: "Workspace is missing GHL configuration" };
    }
    const requiredGhlPrivateKey = ghlPrivateKey;
    const requiredGhlLocationId = ghlLocationId;

    // Best-effort: hydrate missing lead fields from the GHL contact record.
    // This fixes cases where the SMS webhook payload omitted phone/email, which prevents the UI
    // from showing the SMS channel and blocks follow-up automation.
    let leadUpdated = false;
    if (!lead.phone || !lead.email || !lead.firstName || !lead.lastName || !lead.companyName) {
      try {
        const contactResult = await getGHLContact(ghlContactId, requiredGhlPrivateKey, {
          locationId: requiredGhlLocationId,
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
            requiredGhlLocationId,
            ghlContactId,
            requiredGhlPrivateKey,
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
        const conv = await getConversationByContact(ghlContactId, requiredGhlPrivateKey, {
          locationId: requiredGhlLocationId,
        });
        const conversationId = conv.success ? conv.data?.id || null : null;
        const candidateLastMs =
          conv.success && conv.data?.lastMessageDate ? Date.parse(conv.data.lastMessageDate) : NaN;
        const conversationLastMs = Number.isNaN(candidateLastMs) ? null : candidateLastMs;

        if (!conversationId) {
          return { conversationId: null, conversationLastMs, messages: [] };
        }

        const messagesResult = await getConversationMessages(conversationId, requiredGhlPrivateKey);
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
            if (msg.direction === "inbound") touchedInbound = true;
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
          if (msg.direction === "inbound") touchedInbound = true;
          console.log(
            `[Sync] Healed SMS message -> ghlId: ${ghlId}, dir: ${msg.direction}, bodyLen: ${msg.body.length}, sentAt: ${msgTimestamp.toISOString()}`
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
          `[Sync] Imported SMS message -> ghlId: ${ghlId}, dir: ${msg.direction}, bodyLen: ${msg.body.length}, sentAt: ${msgTimestamp.toISOString()}`
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

const EMAILBISON_OUTBOUND_HEAL_WINDOW_MS = 2 * 60 * 1000;
const EMAILBISON_OUTBOUND_HEAL_AMBIGUOUS_MS = 15 * 1000;

function normalizeForMatch(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function scoreBodyMatch(candidateBody: string, importedBody: string): number {
  const normalizedCandidate = normalizeForMatch(candidateBody);
  const normalizedImported = normalizeForMatch(importedBody);

  if (!normalizedCandidate || !normalizedImported) return 0;

  const prefix = normalizedImported.slice(0, 160);
  if (!prefix) return 0;

  if (normalizedCandidate.includes(prefix)) return prefix.length;
  return 0;
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
            emailBisonBaseHost: { select: { host: true } },
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

    const repliesResult = await fetchEmailBisonReplies(lead.client.emailBisonApiKey, lead.emailBisonLeadId, {
      baseHost: lead.client.emailBisonBaseHost?.host ?? null,
    });
    if (!repliesResult.success) {
      return { success: false, error: repliesResult.error || "Failed to fetch replies from EmailBison" };
    }

    const sentResult = await fetchEmailBisonSentEmails(lead.client.emailBisonApiKey, lead.emailBisonLeadId, {
      baseHost: lead.client.emailBisonBaseHost?.host ?? null,
    });
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
    let healedOutboundReplies = 0;
    let importedOutboundReplies = 0;
    let healedInboundReplies = 0;
    let importedInboundReplies = 0;
    let ambiguousOutboundReplies = 0;

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
            if (direction === "inbound") {
              touchedInbound = true;
              healedInboundReplies++;
            } else {
              healedOutboundReplies++;
            }
          } else {
            skippedDuplicates++;
          }
          continue;
        }

        if (isOutbound) {
          const start = new Date(msgTimestamp.getTime() - EMAILBISON_OUTBOUND_HEAL_WINDOW_MS);
          const end = new Date(msgTimestamp.getTime() + EMAILBISON_OUTBOUND_HEAL_WINDOW_MS);

          const findCandidates = async (filterSubject: boolean) =>
            prisma.message.findMany({
              where: {
                leadId,
                channel: "email",
                direction: "outbound",
                source: "zrg",
                emailBisonReplyId: null,
                sentAt: { gte: start, lte: end },
                ...(filterSubject && subject ? { subject } : {}),
              },
              select: {
                id: true,
                body: true,
                subject: true,
                sentAt: true,
                createdAt: true,
                sentBy: true,
                aiDraftId: true,
                rawHtml: true,
                rawText: true,
              },
              take: 5,
            });

          const candidates = await findCandidates(true);
          const fallbackCandidates = candidates.length > 0 ? candidates : await findCandidates(false);

          const scored = fallbackCandidates
            .map((candidate) => ({
              candidate,
              timeDiffMs: Math.abs(candidate.sentAt.getTime() - msgTimestamp.getTime()),
              bodyScore: scoreBodyMatch(candidate.body, body),
              hasDraft: candidate.aiDraftId ? 1 : 0,
              hasSentBy: candidate.sentBy ? 1 : 0,
            }))
            .sort((a, b) => {
              if (a.timeDiffMs !== b.timeDiffMs) return a.timeDiffMs - b.timeDiffMs;
              if (a.bodyScore !== b.bodyScore) return b.bodyScore - a.bodyScore;
              if (a.hasDraft !== b.hasDraft) return b.hasDraft - a.hasDraft;
              if (a.hasSentBy !== b.hasSentBy) return b.hasSentBy - a.hasSentBy;
              return b.candidate.createdAt.getTime() - a.candidate.createdAt.getTime();
            });

          const best = scored[0];
          const second = scored[1];

          const isAmbiguous =
            Boolean(best && second) &&
            best.timeDiffMs <= EMAILBISON_OUTBOUND_HEAL_AMBIGUOUS_MS &&
            second.timeDiffMs <= EMAILBISON_OUTBOUND_HEAL_AMBIGUOUS_MS &&
            second.timeDiffMs - best.timeDiffMs < 5_000 &&
            best.bodyScore === second.bodyScore &&
            best.hasDraft === second.hasDraft;

          if (best && !isAmbiguous) {
            await prisma.message.update({
              where: { id: best.candidate.id },
              data: {
                emailBisonReplyId,
                sentAt: msgTimestamp,
                subject: subject || best.candidate.subject,
                rawHtml: best.candidate.rawHtml ?? (reply.html_body ?? null),
                rawText: best.candidate.rawText ?? (reply.text_body ?? null),
                isRead: true,
              },
            });

            healedCount++;
            healedOutboundReplies++;
            console.log(
              `[EmailSync] Healed outbound replyId ${emailBisonReplyId} -> message ${best.candidate.id} (Δ${best.timeDiffMs}ms)`
            );
            continue;
          }

          if (isAmbiguous) {
            ambiguousOutboundReplies++;
          }
        } else {
          const existingByContent = await prisma.message.findFirst({
            where: {
              leadId,
              channel: "email",
              direction: "inbound",
              emailBisonReplyId: null,
              OR: [
                { body: { contains: body.substring(0, 100) } },
                ...(subject ? [{ subject }] : []),
              ],
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
              },
            });
            healedCount++;
            touchedInbound = true;
            healedInboundReplies++;
            console.log(`[EmailSync] Healed inbound reply -> replyId: ${emailBisonReplyId}, bodyLen: ${body.length}`);
            continue;
          }
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
        if (direction === "inbound") {
          touchedInbound = true;
          importedInboundReplies++;
        } else {
          importedOutboundReplies++;
        }
        console.log(
          `[EmailSync] Imported reply -> replyId: ${emailBisonReplyId}, dir: ${direction}, bodyLen: ${body.length}, sentAt: ${msgTimestamp.toISOString()}`
        );
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
        console.log(
          `[EmailSync] Imported sent email -> inboxxiaScheduledEmailId: ${inboxxiaScheduledEmailId}, subjectLen: ${(subject || "").length}, bodyLen: ${body.length}`
        );
      } catch (error) {
        console.error(`[EmailSync] Error processing sent email ${sentEmail.id}:`, error);
      }
    }

    console.log(`[EmailSync] Complete: ${importedCount} imported, ${healedCount} healed, ${skippedDuplicates} unchanged`);
    console.log("[EmailSync] Reply stats", {
      healedOutboundReplies,
      importedOutboundReplies,
      healedInboundReplies,
      importedInboundReplies,
      ambiguousOutboundReplies,
    });

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
