"use server";

import { prisma } from "@/lib/prisma";
import { sendSMS, exportMessages, updateGHLContact, type GHLExportedMessage } from "@/lib/ghl-api";
import { revalidatePath } from "next/cache";
import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { buildSentimentTranscriptFromMessages, classifySentiment, detectBounce, isPositiveSentiment, SENTIMENT_TO_STATUS, type SentimentTag } from "@/lib/sentiment";
import { sendEmailReply, sendEmailReplyForLead } from "@/actions/email-actions";
import { ensureGhlContactIdForLead, resolveGhlContactIdForLead } from "@/lib/ghl-contacts";
import { autoStartNoResponseSequenceOnOutbound } from "@/lib/followup-automation";
import { bumpLeadMessageRollup, recomputeLeadMessageRollups } from "@/lib/lead-message-rollups";
import { sendSmsSystem } from "@/lib/system-sender";
import { toGhlPhoneBestEffort } from "@/lib/phone-utils";
import { enrichPhoneThenSyncToGhl } from "@/lib/phone-enrichment";
import { syncEmailConversationHistorySystem, syncSmsConversationHistorySystem } from "@/lib/conversation-sync";
import { getAccessibleClientIdsForUser, requireAuthUser, requireClientAdminAccess } from "@/lib/workspace-access";
import { withAiTelemetrySourceIfUnset } from "@/lib/ai/telemetry-context";
import {
  sendLinkedInMessageWithWaterfall,
  checkLinkedInConnection,
  checkInMailBalance,
  type SendResult as UnipileSendResult,
  type LinkedInConnectionStatus,
  type InMailBalanceResult,
} from "@/lib/unipile-api";
import { updateUnipileConnectionHealth } from "@/lib/workspace-integration-health";
import { recordOutboundForBookingProgress } from "@/lib/booking-progress";
import { coerceSmsDraftPartsOrThrow } from "@/lib/sms-multipart";
import { BackgroundJobType } from "@prisma/client";
import { enqueueBackgroundJob } from "@/lib/background-jobs/enqueue";

/**
 * Pre-classification check for sentiment analysis.
 * Returns a sentiment tag directly if we can determine it without AI,
 * or null if AI classification is needed.
 * 
 * Rules:
 * - If no messages at all → "Neutral"
 * - If lead has never responded (no inbound messages) → "Neutral"
 * - Otherwise → null (always use AI classification when lead has responded)
 * 
 * NOTE: We intentionally DO NOT have a time-based threshold here.
 * If a lead responded at any point, we always want AI to analyze what they said,
 * regardless of how long ago it was or who sent the last message.
 */
function preClassifySentiment(
  messages: { direction: string }[]
): SentimentTag | null {
  if (messages.length === 0) {
    return "New";
  }

  // Only auto-classify if lead has NEVER responded
  const hasInboundMessages = messages.some(m => m.direction === "inbound");
  if (!hasInboundMessages) {
    console.log("[PreClassify] Lead has never responded → New");
    return "New";
  }

  // Lead has responded at some point - always use AI to analyze what they said
  return null;
}

async function requireLeadAccess(leadId: string): Promise<{ id: string; clientId: string }> {
  const user = await requireAuthUser();
  const [lead, accessible] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, clientId: true },
    }),
    getAccessibleClientIdsForUser(user.id),
  ]);

  if (!lead) throw new Error("Lead not found");
  if (!accessible.includes(lead.clientId)) throw new Error("Unauthorized");
  return lead;
}

async function computeSentimentFromMessages(
  messages: { body: string; direction: string; channel?: string | null; subject?: string | null; sentAt: Date }[],
  opts: { clientId: string; leadId: string }
): Promise<SentimentTag> {
  // First, check if we can determine sentiment without AI (pre-classification)
  const preClassified = preClassifySentiment(messages);

  if (preClassified !== null) {
    return preClassified;
  }

  if (detectBounce(messages)) {
    // Detect bounces using regex (faster and more reliable than AI for system messages)
    console.log("[Sentiment] Bounce detected via regex → Blacklist");
    return "Blacklist";
  }

  // Full turn-by-turn context (with timestamps) helps disambiguate ultra-short replies.
  const transcript = buildSentimentTranscriptFromMessages(messages.slice(-80));

  if (transcript.trim().length === 0) {
    return "Neutral";
  }

  return classifySentiment(transcript, { clientId: opts.clientId, leadId: opts.leadId });
}

async function refreshLeadSentimentTag(leadId: string): Promise<{
  sentimentTag: SentimentTag;
  status: string;
}> {
  const lead = await requireLeadAccess(leadId);

  // IMPORTANT: Get ALL messages across all channels (SMS, email, LinkedIn)
  // to ensure sentiment classification considers the full conversation history
  const messages = await prisma.message.findMany({
    where: { leadId },
    select: { body: true, direction: true, channel: true, subject: true, sentAt: true },
    orderBy: { sentAt: "asc" },
  });

  const sentimentTag = await computeSentimentFromMessages(messages, {
    clientId: lead.clientId,
    leadId: lead.id,
  });
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

  // If sentiment is no longer positive, don't leave enrichment stuck in "pending".
  if (!isPositiveSentiment(sentimentTag)) {
    await prisma.lead.updateMany({
      where: { id: leadId, enrichmentStatus: "pending" },
      data: { enrichmentStatus: "not_needed" },
    });
  }

  // Policy/backstop: drafts only exist for positive intents (plus Follow Up deferrals).
  const leadEmail = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { email: true },
  });

  if (!shouldGenerateDraft(sentimentTag, leadEmail?.email ?? null)) {
    await prisma.aIDraft.updateMany({
      where: {
        leadId,
        status: "pending",
      },
      data: { status: "rejected" },
    });
  }

  return { sentimentTag, status };
}

export async function reanalyzeLeadSentiment(leadId: string): Promise<{
  success: boolean;
  sentimentTag?: SentimentTag;
  status?: string;
  error?: string;
}> {
  return withAiTelemetrySourceIfUnset("action:message.reanalyze_lead_sentiment", async () => {
    try {
      await requireLeadAccess(leadId);

      const { sentimentTag, status } = await refreshLeadSentimentTag(leadId);

      revalidatePath("/");

      return { success: true, sentimentTag, status };
    } catch (error) {
      console.error("[reanalyzeLeadSentiment] Failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
}

interface SendMessageResult {
  success: boolean;
  messageId?: string;
  errorCode?: "sms_dnd";
  error?: string;
}

interface SyncHistoryResult {
  success: boolean;
  importedCount?: number;
  healedCount?: number;  // Messages with corrected ghlId/timestamp
  totalMessages?: number;
  skippedDuplicates?: number;
  reclassifiedSentiment?: boolean;  // Whether sentiment was re-analyzed
  leadUpdated?: boolean; // Non-message updates (e.g., hydrate phone from GHL)
  error?: string;
}

// Options for sync operations
interface SyncOptions {
  forceReclassify?: boolean;  // Force sentiment re-analysis even if no new messages
}

// Extended result that tracks which channels were synced (for draft generation)
interface SmartSyncResult extends SyncHistoryResult {
  syncedSms?: boolean;
  syncedEmail?: boolean;
}


export interface LeadSyncInfo {
  leadId: string;
  canSyncSms: boolean;
  canSyncEmail: boolean;
  ghlContactId: string | null;
  emailBisonLeadId: string | null;
  hasEmailMessages: boolean;
  hasSmsMessages: boolean;
}

/**
 * Get sync capabilities for a lead
 * Returns which sync methods are available based on external IDs
 */
export async function getLeadSyncInfo(leadId: string): Promise<{
  success: boolean;
  data?: LeadSyncInfo;
  error?: string;
}> {
  try {
    await requireLeadAccess(leadId);
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        ghlContactId: true,
        emailBisonLeadId: true,
        messages: {
          select: {
            channel: true,
          },
        },
        client: {
          select: {
            ghlPrivateKey: true,
            emailBisonApiKey: true,
          },
        },
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    // Check what types of messages exist
    const hasEmailMessages = lead.messages.some(m => m.channel === "email");
    const hasSmsMessages = lead.messages.some(m => m.channel === "sms" || !m.channel);

    // Determine sync capabilities
    const canSyncSms = !!(lead.ghlContactId && lead.client.ghlPrivateKey);
    const canSyncEmail = !!(lead.emailBisonLeadId && lead.client.emailBisonApiKey);

    return {
      success: true,
      data: {
        leadId: lead.id,
        canSyncSms,
        canSyncEmail,
        ghlContactId: lead.ghlContactId,
        emailBisonLeadId: lead.emailBisonLeadId,
        hasEmailMessages,
        hasSmsMessages,
      },
    };
  } catch (error) {
    console.error("[getLeadSyncInfo] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Smart sync that automatically determines which sync method to use
 * Based on lead's external IDs
 * 
 * @param leadId - The lead ID to sync
 * @param options - Sync options including forceReclassify to re-analyze sentiment
 */
export async function smartSyncConversation(leadId: string, options: SyncOptions = {}): Promise<SmartSyncResult> {
  return withAiTelemetrySourceIfUnset("action:message.smart_sync_conversation", async () => {
    // First get the lead's sync capabilities
    const syncInfo = await getLeadSyncInfo(leadId);

    if (!syncInfo.success || !syncInfo.data) {
      return { success: false, error: syncInfo.error || "Failed to get lead sync info", reclassifiedSentiment: false };
    }

    let { canSyncSms, canSyncEmail, hasEmailMessages, hasSmsMessages, emailBisonLeadId, ghlContactId } = syncInfo.data;

    // Always-on: try to resolve missing GHL contact IDs for email-first leads (search/link only; no create).
    if (!canSyncSms && !ghlContactId) {
      const resolveResult = await resolveGhlContactIdForLead(leadId);
      if (resolveResult.success && resolveResult.ghlContactId) {
        ghlContactId = resolveResult.ghlContactId;
        canSyncSms = true;
      }
    }

    // If neither sync is available, return appropriate error
    if (!canSyncSms && !canSyncEmail) {
      if (hasEmailMessages && !emailBisonLeadId) {
        return {
          success: false,
          error: "This lead's emails cannot be synced (no EmailBison lead ID - may be from a bounce notification)",
          reclassifiedSentiment: false,
        };
      }
      if (hasSmsMessages && !ghlContactId) {
        return {
          success: false,
          error: "This lead's SMS messages cannot be synced (no GHL contact ID)",
          reclassifiedSentiment: false,
        };
      }
      return {
        success: false,
        error: "No sync method available for this lead (missing external IDs or credentials)",
        reclassifiedSentiment: false,
      };
    }

    let totalImported = 0;
    let totalHealed = 0;
    let totalMessages = 0;
    let totalSkipped = 0;
    let reclassifiedSentiment = false;
    let leadUpdated = false;
    const errors: string[] = [];

    let syncedSms = false;
    let syncedEmail = false;
    // Sync SMS if available
    if (canSyncSms) {
      const smsResult = await syncConversationHistory(leadId, options);
      if (smsResult.success) {
        totalImported += smsResult.importedCount || 0;
        totalHealed += smsResult.healedCount || 0;
        totalMessages += smsResult.totalMessages || 0;
        totalSkipped += smsResult.skippedDuplicates || 0;
        reclassifiedSentiment = reclassifiedSentiment || smsResult.reclassifiedSentiment || false;
        leadUpdated = leadUpdated || smsResult.leadUpdated || false;
        syncedSms = true;
      } else if (smsResult.error) {
        errors.push(`SMS: ${smsResult.error}`);
      }
    }

    // Sync Email if available
    if (canSyncEmail) {
      const emailResult = await syncEmailConversationHistory(leadId, options);
      if (emailResult.success) {
        totalImported += emailResult.importedCount || 0;
        totalHealed += emailResult.healedCount || 0;
        totalMessages += emailResult.totalMessages || 0;
        totalSkipped += emailResult.skippedDuplicates || 0;
        reclassifiedSentiment = reclassifiedSentiment || emailResult.reclassifiedSentiment || false;
        leadUpdated = leadUpdated || emailResult.leadUpdated || false;
        syncedEmail = true;
      } else if (emailResult.error) {
        errors.push(`Email: ${emailResult.error}`);
      }
    }

    // If all attempted syncs failed and no messages were processed at all, return error
    // Include totalSkipped check - if we skipped duplicates, that means sync worked but messages already existed
    // Also check reclassifiedSentiment - if we reclassified, the sync was at least partially successful
    if (
      errors.length > 0 &&
      totalImported === 0 &&
      totalHealed === 0 &&
      totalSkipped === 0 &&
      !reclassifiedSentiment &&
      !leadUpdated
    ) {
      return { success: false, error: errors.join("; "), reclassifiedSentiment: false };
    }

    return {
      success: true,
      importedCount: totalImported,
      healedCount: totalHealed,
      totalMessages,
      skippedDuplicates: totalSkipped,
      reclassifiedSentiment,
      leadUpdated,
      syncedSms,
      syncedEmail,
    };
  });
}

function getConversationSyncDedupeWindowMs(): number {
  const parsed = Number.parseInt(process.env.CONVERSATION_SYNC_DEDUPE_WINDOW_MS || "", 10);
  if (!Number.isFinite(parsed)) return 5 * 60_000;
  return Math.max(30_000, Math.min(30 * 60_000, parsed));
}

export async function enqueueConversationSync(leadId: string): Promise<{
  success: boolean;
  queued?: boolean;
  alreadyQueued?: boolean;
  error?: string;
}> {
  return withAiTelemetrySourceIfUnset("action:message.enqueue_conversation_sync", async () => {
    try {
      const lead = await requireLeadAccess(leadId);

      const existing = await prisma.backgroundJob.findFirst({
        where: {
          leadId,
          type: BackgroundJobType.CONVERSATION_SYNC,
          status: { in: ["PENDING", "RUNNING"] },
        },
        select: { id: true },
      });

      if (existing) {
        return { success: true, queued: false, alreadyQueued: true };
      }

      const anchorMessage = await prisma.message.findFirst({
        where: { leadId },
        orderBy: { sentAt: "desc" },
        select: { id: true },
      });

      if (!anchorMessage) {
        return { success: false, error: "No messages found for this lead" };
      }

      const dedupeWindowMs = getConversationSyncDedupeWindowMs();
      const bucket = Math.floor(Date.now() / dedupeWindowMs) * dedupeWindowMs;
      const dedupeKey = `conversation_sync:${leadId}:${bucket}`;

      const queued = await enqueueBackgroundJob({
        type: BackgroundJobType.CONVERSATION_SYNC,
        clientId: lead.clientId,
        leadId,
        messageId: anchorMessage.id,
        dedupeKey,
        maxAttempts: 3,
      });

      return { success: true, queued, alreadyQueued: !queued };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Failed to enqueue sync" };
    }
  });
}

/**
 * Check if a message with similar content already exists
 * Uses fuzzy timestamp matching (within 60 seconds) to handle timing differences
 * between our database and GHL's timestamps
 */
async function messageExists(
  leadId: string,
  body: string,
  direction: string,
  timestamp?: Date
): Promise<boolean> {
  // If no timestamp provided, just check by body and direction
  if (!timestamp) {
    const existing = await prisma.message.findFirst({
      where: {
        leadId,
        body,
        direction,
      },
    });
    return !!existing;
  }

  // Check with fuzzy timestamp (within 60 seconds) on sentAt (actual message time)
  const windowStart = new Date(timestamp.getTime() - 60000); // 60 seconds before
  const windowEnd = new Date(timestamp.getTime() + 60000); // 60 seconds after

  const existing = await prisma.message.findFirst({
    where: {
      leadId,
      body,
      direction,
      sentAt: {
        gte: windowStart,
        lte: windowEnd,
      },
    },
  });

  return !!existing;
}

/**
 * Sync conversation history from GHL for a lead
 * Uses GHL Message ID (ghlId) as the source of truth for deduplication
 * Heals existing messages that were created without ghlId by matching body+direction
 * 
 * @param leadId - The internal lead ID
 * @param options - Sync options including forceReclassify to re-analyze sentiment
 */
export async function syncConversationHistory(leadId: string, options: SyncOptions = {}): Promise<SyncHistoryResult> {
  return withAiTelemetrySourceIfUnset("action:message.sync_sms_conversation_history", async () => {
    try {
      await requireLeadAccess(leadId);
      return await syncSmsConversationHistorySystem(leadId, options);
    } catch (error) {
      console.error("[Sync] Failed to sync conversation history:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
}

interface SyncAllResult {
  success: boolean;
  totalLeads: number;
  processedLeads?: number;
  nextCursor?: number | null;
  hasMore?: boolean;
  durationMs?: number;
  totalImported: number;
  totalHealed: number;
  totalDraftsGenerated: number;
  totalReclassified: number;
  totalLeadUpdated: number;
  errors: number;
  error?: string;
}

type SyncAllOptions = SyncOptions & {
  cursor?: number | null;
  maxSeconds?: number;
  runBounceCleanup?: boolean;
};

/**
 * Sync all SMS conversations for a workspace (client)
 * Iterates through all leads with GHL contact IDs and syncs their history
 * Also regenerates AI drafts for eligible leads (non-blacklisted)
 * 
 * @param clientId - The workspace/client ID to sync
 * @param options - Sync options including forceReclassify to re-analyze sentiment for all leads
 */
export async function syncAllConversations(clientId: string, options: SyncAllOptions = {}): Promise<SyncAllResult> {
  return withAiTelemetrySourceIfUnset("action:message.sync_all_conversations", async () => {
    try {
      await requireClientAdminAccess(clientId);
    // Get ALL leads for this client (both SMS and Email capable)
    const leads = await prisma.lead.findMany({
      where: {
        clientId,
        // Must have at least one external ID to be syncable
        OR: [
          { ghlContactId: { not: null } },
          { emailBisonLeadId: { not: null } },
        ],
      },
      select: {
        id: true,
        ghlContactId: true,
        emailBisonLeadId: true,
      },
      orderBy: { id: "asc" },
    });

    const startedAtMs = Date.now();
    const maxSeconds = Number.isFinite(options.maxSeconds) && (options.maxSeconds || 0) > 0 ? options.maxSeconds! : 90;
    const deadlineMs = startedAtMs + maxSeconds * 1000;

    const startIndex = options.cursor && options.cursor > 0 ? Math.floor(options.cursor) : 0;

    console.log(
      `[SyncAll] Starting sync for ${leads.length} leads in client ${clientId} starting at ${startIndex}${options.forceReclassify ? " (with sentiment re-analysis)" : ""}`
    );

    let totalImported = 0;
    let totalHealed = 0;
    let totalDraftsGenerated = 0;
    let totalReclassified = 0;
    let totalLeadUpdated = 0;
    let errors = 0;
    let processedLeads = 0;

    // Process leads in parallel with a concurrency limit.
    // Throughput is also governed by the centralized GHL rate limiter in `lib/ghl-api.ts`.
    const configuredBatchSize = Number(process.env.SYNC_ALL_CONCURRENCY || "");
    const BATCH_SIZE =
      Number.isFinite(configuredBatchSize) && configuredBatchSize > 0 ? Math.floor(configuredBatchSize) : 1;

    let nextIndex: number | null = null;

    for (let i = startIndex; i < leads.length; i += BATCH_SIZE) {
      if (Date.now() >= deadlineMs) {
        nextIndex = i;
        break;
      }

      const batch = leads.slice(i, i + BATCH_SIZE);
      processedLeads += batch.length;

      // Use smartSyncConversation which handles both SMS and Email
      const results = await Promise.allSettled(batch.map((lead) => smartSyncConversation(lead.id, { ...options })));

      // Process sync results and generate drafts for eligible leads
      for (let j = 0; j < results.length; j++) {
        const result = results[j];

        if (result.status === "fulfilled" && result.value.success) {
          totalImported += result.value.importedCount || 0;
          totalHealed += result.value.healedCount || 0;
          if (result.value.reclassifiedSentiment) {
            totalReclassified++;
          }
          if (result.value.leadUpdated) {
            totalLeadUpdated++;
          }
        } else {
          errors++;
          if (result.status === "rejected") {
            console.error(`[SyncAll] Lead sync failed:`, result.reason);
          } else if (!result.value.success) {
            console.error(`[SyncAll] Lead sync error:`, result.value.error);
          }
        }
      }
    }

    if (nextIndex == null && startIndex + processedLeads < leads.length) {
      nextIndex = startIndex + processedLeads;
    }

    const hasMore = nextIndex != null && nextIndex < leads.length;
    const durationMs = Date.now() - startedAtMs;

    console.log(
      `[SyncAll] Complete: ${totalImported} imported, ${totalHealed} healed, ${totalReclassified} reclassified, ${totalDraftsGenerated} drafts, ${totalLeadUpdated} contacts updated, ${errors} errors`
    );

    // Optional: bounce cleanup is expensive; only run when explicitly enabled (and ideally only on a full run).
    if (options.runBounceCleanup === true && !hasMore) {
      console.log(`[SyncAll] Running bounce cleanup for client ${clientId}...`);
      try {
        const cleanupResult = await cleanupBounceLeads(clientId);
        if (cleanupResult.fakeLeadsFound > 0) {
          console.log(
            `[SyncAll] Bounce cleanup: ${cleanupResult.fakeLeadsFound} fake leads found, ${cleanupResult.leadsDeleted} deleted, ${cleanupResult.leadsBlacklisted} blacklisted`
          );
        }
      } catch (cleanupError) {
        console.error("[SyncAll] Bounce cleanup failed:", cleanupError);
      }
    }

      return {
        success: true,
        totalLeads: leads.length,
        processedLeads,
        nextCursor: hasMore ? nextIndex : null,
        hasMore,
        durationMs,
        totalImported,
        totalHealed,
        totalDraftsGenerated,
        totalReclassified,
        totalLeadUpdated,
        errors,
      };
    } catch (error) {
      console.error("[SyncAll] Failed to sync all conversations:", error);
      return {
        success: false,
        totalLeads: 0,
        processedLeads: 0,
        nextCursor: null,
        hasMore: false,
        totalImported: 0,
        totalHealed: 0,
        totalDraftsGenerated: 0,
        totalReclassified: 0,
        totalLeadUpdated: 0,
        errors: 1,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
}

// =============================================================================
// Email Sync Functions
// =============================================================================

/**
 * Helper to clean email body for comparison
 */
function cleanEmailBody(htmlBody?: string | null, textBody?: string | null): string {
  const source = textBody || htmlBody || "";
  if (!source.trim()) return "";

  // Strip HTML tags and normalize whitespace
  return source
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 500); // Use first 500 chars for comparison
}

/**
 * Sync email conversation history from EmailBison for a lead
 * Uses emailBisonReplyId as the source of truth for deduplication
 * Heals existing messages that were created without the reply ID
 *
 * @param leadId - The internal lead ID
 * @param options - Sync options including forceReclassify to re-analyze sentiment
 */
export async function syncEmailConversationHistory(leadId: string, options: SyncOptions = {}): Promise<SyncHistoryResult> {
  return withAiTelemetrySourceIfUnset("action:message.sync_email_conversation_history", async () => {
    try {
      await requireLeadAccess(leadId);
      return await syncEmailConversationHistorySystem(leadId, options);
    } catch (error) {
      console.error("[EmailSync] Failed to sync email conversation history:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
}

/**
 * Sync all email conversations for a workspace (client)
 * Iterates through all leads with EmailBison lead IDs and syncs their history
 * Also regenerates AI drafts for eligible leads
 * 
 * @param clientId - The workspace/client ID to sync
 */
export async function syncAllEmailConversations(clientId: string): Promise<SyncAllResult> {
  return withAiTelemetrySourceIfUnset("action:message.sync_all_email_conversations", async () => {
    try {
      await requireClientAdminAccess(clientId);
    // Get all leads for this client that have EmailBison lead IDs
    const leads = await prisma.lead.findMany({
      where: {
        clientId,
        emailBisonLeadId: {
          not: null,
        },
      },
      select: {
        id: true,
        emailBisonLeadId: true,
      },
    });

    console.log(`[EmailSyncAll] Starting sync for ${leads.length} email leads in client ${clientId}`);

    let totalImported = 0;
    let totalHealed = 0;
    let totalDraftsGenerated = 0;
    let errors = 0;

    // Process leads in batches to avoid overwhelming the API
    const BATCH_SIZE = 5;

    for (let i = 0; i < leads.length; i += BATCH_SIZE) {
      const batch = leads.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(lead => syncEmailConversationHistory(lead.id))
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const leadId = batch[j].id;

        if (result.status === "fulfilled" && result.value.success) {
          totalImported += result.value.importedCount || 0;
          totalHealed += result.value.healedCount || 0;

          // After successful sync, regenerate AI draft if eligible
          try {
            const lead = await prisma.lead.findUnique({
              where: { id: leadId },
              select: { sentimentTag: true, status: true, email: true },
            });

            if (lead && shouldGenerateDraft(lead.sentimentTag || "Neutral", lead.email)) {
              const draftResult = await regenerateDraft(leadId, "email");
              if (draftResult.success) {
                totalDraftsGenerated++;
                console.log(`[EmailSyncAll] Generated draft for lead ${leadId}`);
              }
            }
          } catch (draftError) {
            console.error(`[EmailSyncAll] Failed to generate draft for lead ${leadId}:`, draftError);
          }
        } else {
          errors++;
          if (result.status === "rejected") {
            console.error(`[EmailSyncAll] Lead sync failed:`, result.reason);
          } else if (!result.value.success) {
            console.error(`[EmailSyncAll] Lead sync error:`, result.value.error);
          }
        }
      }
    }

    console.log(`[EmailSyncAll] Complete: ${totalImported} imported, ${totalHealed} healed, ${totalDraftsGenerated} drafts, ${errors} errors`);

	      return {
	        success: true,
	        totalLeads: leads.length,
	        totalImported,
	        totalHealed,
	        totalDraftsGenerated,
	        totalReclassified: 0,
	        totalLeadUpdated: 0,
	        errors,
	      };
	    } catch (error) {
	      console.error("[EmailSyncAll] Failed to sync all email conversations:", error);
	      return {
	        success: false,
	        totalLeads: 0,
	        totalImported: 0,
	        totalHealed: 0,
	        totalDraftsGenerated: 0,
	        totalReclassified: 0,
	        totalLeadUpdated: 0,
	        errors: 1,
	        error: error instanceof Error ? error.message : "Unknown error",
	      };
	    }
	  });
}

/**
 * Send an SMS message to a lead via GHL and save to database
 * 
 * @param leadId - The internal lead ID
 * @param message - The message content
 */
export async function sendMessage(
  leadId: string,
  message: string
): Promise<SendMessageResult> {
  return withAiTelemetrySourceIfUnset("action:message.send_sms", async () => {
    try {
      const user = await requireAuthUser();
      await requireLeadAccess(leadId);
      const result = await sendSmsSystem(leadId, message, { sentBy: "setter", sentByUserId: user.id });
      if (result.success) revalidatePath("/");
      return result;
    } catch (error) {
      console.error("Failed to send message:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
}

/**
 * Send an email reply for a lead (no AI draft required).
 * This is the UI-safe wrapper that enforces lead access.
 * Phase 50: Added optional CC parameter for custom CC recipients.
 */
export async function sendEmailMessage(
  leadId: string,
  message: string,
  options?: { cc?: string[] }
): Promise<SendMessageResult> {
  return withAiTelemetrySourceIfUnset("action:message.send_email", async () => {
    try {
      const user = await requireAuthUser();
      await requireLeadAccess(leadId);
      const result = await sendEmailReplyForLead(leadId, message, {
        sentBy: "setter",
        sentByUserId: user.id,
        cc: options?.cc,
      });
      if (!result.success) {
        return { success: false, error: result.error || "Failed to send email reply" };
      }
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error("[Email] Failed to send email message:", error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  });
}

/**
 * Send a LinkedIn message to a lead via Unipile with waterfall logic
 * Waterfall: Try DM (if connected) -> InMail (if Open Profile) -> Connection Request
 * 
 * @param leadId - The internal lead ID
 * @param message - The message content
 * @param connectionNote - Optional personalized note for connection request
 * @param inMailSubject - Optional subject for InMail
 */
export async function sendLinkedInMessage(
  leadId: string,
  message: string,
  connectionNote?: string,
  inMailSubject?: string,
  meta?: { sentBy?: "ai" | "setter" | null; sentByUserId?: string | null; aiDraftId?: string | null }
): Promise<SendMessageResult & { messageType?: "dm" | "inmail" | "connection_request"; attemptedMethods?: string[] }> {
  return withAiTelemetrySourceIfUnset("action:message.send_linkedin", async () => {
    try {
      await requireLeadAccess(leadId);

    if (meta?.aiDraftId) {
      const existing = await prisma.message.findFirst({
        where: { aiDraftId: meta.aiDraftId },
        select: { id: true },
      });
      if (existing) return { success: true, messageId: existing.id };
    }

    // Get the lead with their client (for Unipile account)
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        client: {
          select: {
            id: true,
            unipileAccountId: true,
          },
        },
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    if (lead.status === "blacklisted") {
      return { success: false, error: "Lead is blacklisted" };
    }

    if (!lead.linkedinUrl && !lead.linkedinId) {
      return { success: false, error: "Lead has no LinkedIn profile linked" };
    }

    // Require linkedinUrl for Unipile API - linkedinId alone is not sufficient
    if (!lead.linkedinUrl) {
      return { success: false, error: "Lead has linkedinId but no LinkedIn URL - cannot send message" };
    }

    if (!lead.client.unipileAccountId) {
      return { success: false, error: "Workspace has no LinkedIn account configured" };
    }

    const linkedinUrl = lead.linkedinUrl;

    console.log(`[sendLinkedInMessage] Sending to lead ${leadId} via LinkedIn (${linkedinUrl})`);

    // Use waterfall send logic
    const result = await sendLinkedInMessageWithWaterfall(
      lead.client.unipileAccountId,
      linkedinUrl,
      message,
      connectionNote,
      inMailSubject
    );

    if (!result.success) {
      if (result.isDisconnectedAccount) {
        await updateUnipileConnectionHealth({
          clientId: lead.client.id,
          isDisconnected: true,
          errorDetail: result.error,
        }).catch((err) => console.error("[sendLinkedInMessage] Failed to update Unipile health:", err));
      }

      if (result.isUnreachableRecipient && process.env.UNIPILE_HEALTH_GATE === "1") {
        await prisma.lead
          .update({
            where: { id: lead.id },
            data: {
              linkedinUnreachableAt: new Date(),
              linkedinUnreachableReason: result.error || "Recipient cannot be reached",
            },
          })
          .catch(() => undefined);
      }

      return {
        success: false,
        error: result.error,
        attemptedMethods: result.attemptedMethods,
      };
    }

    await updateUnipileConnectionHealth({
      clientId: lead.client.id,
      isDisconnected: false,
    }).catch(() => undefined);

    // Save the outbound message to our database
    const savedMessage = await prisma.message.create({
      data: {
        body: message,
        direction: "outbound",
        channel: "linkedin",
        source: "zrg",
        leadId: lead.id,
        sentAt: new Date(),
        sentBy: meta?.sentBy ?? "setter",
        sentByUserId: meta?.sentByUserId || undefined,
        aiDraftId: meta?.aiDraftId || undefined,
      },
    });

    await bumpLeadMessageRollup({ leadId: lead.id, direction: "outbound", source: "zrg", sentAt: savedMessage.sentAt });

    // Update the lead's updatedAt timestamp
    await prisma.lead.update({
      where: { id: leadId },
      data: { updatedAt: new Date() },
    });

    // Kick off no-response follow-ups starting from this outbound touch (if enabled)
    autoStartNoResponseSequenceOnOutbound({ leadId, outboundAt: savedMessage.sentAt }).catch((err) => {
      console.error("[sendLinkedInMessage] Failed to auto-start no-response sequence:", err);
    });

    // Record booking progress for wave tracking (Phase 36)
    recordOutboundForBookingProgress({ leadId, channel: "linkedin" }).catch((err) => {
      console.error("[sendLinkedInMessage] Failed to record booking progress:", err);
    });

    revalidatePath("/");

    console.log(`[sendLinkedInMessage] Sent via ${result.messageType} - message ID: ${savedMessage.id}`);

    return {
      success: true,
      messageId: savedMessage.id,
      messageType: result.messageType,
      attemptedMethods: result.attemptedMethods,
    };
    } catch (error) {
      console.error("Failed to send LinkedIn message:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
}

/**
 * Get pending AI drafts for a lead
 * 
 * @param leadId - The internal lead ID
 */
export async function getPendingDrafts(leadId: string, channel?: "sms" | "email" | "linkedin") {
  try {
    await requireLeadAccess(leadId);

    const drafts = await prisma.aIDraft.findMany({
      where: {
        leadId,
        status: "pending",
        channel: channel || undefined,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return { success: true, data: drafts };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Not authenticated" || message === "Unauthorized") {
      return { success: false, error: "Unauthorized" };
    }

    console.error("[getPendingDrafts] Failed to get drafts:", error);
    return { success: false, error: "Failed to get drafts" };
  }
}

/**
 * Approve and send an AI draft
 * 
 * @param draftId - The draft ID
 * @param editedContent - Optional edited content (uses original if not provided)
 */
/**
 * System-level draft approval and send.
 * Phase 50: Added optional CC parameter for email drafts.
 */
export async function approveAndSendDraftSystem(
  draftId: string,
  opts: { sentBy: "ai" | "setter"; sentByUserId?: string | null; editedContent?: string; cc?: string[] } = { sentBy: "setter" }
): Promise<SendMessageResult> {
  try {
    const draft = await prisma.aIDraft.findUnique({
      where: { id: draftId },
      select: {
        id: true,
        leadId: true,
        content: true,
        channel: true,
        status: true,
      },
    });

    if (!draft) {
      return { success: false, error: "Draft not found" };
    }

    if (draft.status !== "pending") {
      return { success: false, error: "Draft is not pending" };
    }

    // Email drafts: use dedicated sender (keeps existing behavior)
    // Phase 50: Pass CC to sendEmailReply
    if (draft.channel === "email") {
      const result = await sendEmailReply(draftId, opts.editedContent, {
        sentBy: opts.sentBy,
        sentByUserId: opts.sentByUserId,
        cc: opts.cc,
      });
      if (!result.success) return { success: false, error: result.error || "Failed to send email reply" };
      return { success: true, messageId: result.messageId };
    }

    // LinkedIn drafts: system-send isn't supported today (manual send via approveAndSendDraft)
    if (draft.channel === "linkedin") {
      return { success: false, error: "System send for LinkedIn drafts is not supported" };
    }

    // SMS drafts: support multipart (<=3 parts, <=160 chars each)
    const messageContent = opts.editedContent || draft.content;
    const { parts } = coerceSmsDraftPartsOrThrow(messageContent, { allowFallbackSplit: true });

    // Determine which parts have already been sent (idempotent retries).
    const existing = await prisma.message.findMany({
      where: { aiDraftId: draftId },
      select: { id: true, aiDraftPartIndex: true },
    });

    const sentPartIndexes = new Set<number>();
    for (const m of existing) {
      sentPartIndexes.add(m.aiDraftPartIndex ?? 0);
    }

    const pendingPartIndexes: number[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (!sentPartIndexes.has(i)) pendingPartIndexes.push(i);
    }

    // Send missing parts sequentially.
    let firstMessageId: string | undefined = existing[0]?.id;
    for (const partIndex of pendingPartIndexes) {
      const sendResult = await sendSmsSystem(draft.leadId, parts[partIndex]!, {
        sentBy: opts.sentBy,
        sentByUserId: opts.sentByUserId || undefined,
        aiDraftId: draftId,
        aiDraftPartIndex: partIndex,
        skipBookingProgress: true,
      });

      if (!sendResult.success) {
        return sendResult;
      }

      if (!firstMessageId) firstMessageId = sendResult.messageId;
    }

    // Only mark wave progress once the full SMS "send" completes (all parts present).
    // If no parts were pending, avoid double-counting.
    if (pendingPartIndexes.length > 0) {
      await recordOutboundForBookingProgress({ leadId: draft.leadId, channel: "sms", smsPartCount: parts.length });
    }

    await prisma.aIDraft.update({
      where: { id: draftId },
      data: { status: "approved" },
    });

    return { success: true, messageId: firstMessageId };
  } catch (error) {
    console.error("[approveAndSendDraftSystem] Failed:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Approve and send an AI draft from the UI.
 * Phase 50: Added optional CC parameter for email drafts.
 */
export async function approveAndSendDraft(
  draftId: string,
  editedContent?: string,
  options?: { cc?: string[] }
): Promise<SendMessageResult> {
  try {
    const user = await requireAuthUser();
    const accessible = await getAccessibleClientIdsForUser(user.id);

    // Get the draft
    const draft = await prisma.aIDraft.findUnique({
      where: { id: draftId },
      include: {
        lead: {
          include: {
            client: {
              select: {
                ghlPrivateKey: true,
              },
            },
          },
        },
      },
    });

    if (!draft) {
      return { success: false, error: "Draft not found" };
    }
    if (!accessible.includes(draft.lead.clientId)) {
      return { success: false, error: "Unauthorized" };
    }

    if (draft.status !== "pending") {
      return { success: false, error: "Draft is not pending" };
    }

    if (draft.channel === "email") {
      return await approveAndSendDraftSystem(draftId, {
        sentBy: "setter",
        sentByUserId: user.id,
        editedContent,
        cc: options?.cc,
      });
    }

    if (draft.channel === "linkedin") {
      // Send LinkedIn message via Unipile
      const messageContent = editedContent || draft.content;
      const linkedInResult = await sendLinkedInMessage(draft.leadId, messageContent, undefined, undefined, {
        sentBy: "setter",
        sentByUserId: user.id,
        aiDraftId: draftId,
      });

      if (!linkedInResult.success) {
        return linkedInResult;
      }

      // Mark draft as approved
      await prisma.aIDraft.update({
        where: { id: draftId },
        data: { status: "approved" },
      });

      revalidatePath("/");

      return { success: true, messageId: linkedInResult.messageId };
    }

    // Send the message (SMS)
    const sendResult = await approveAndSendDraftSystem(draftId, { sentBy: "setter", sentByUserId: user.id, editedContent });

    if (!sendResult.success) {
      return sendResult;
    }

    revalidatePath("/");

    return { success: true, messageId: sendResult.messageId };
  } catch (error) {
    console.error("Failed to approve draft:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Reject an AI draft
 * 
 * @param draftId - The draft ID
 */
export async function rejectDraft(draftId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuthUser();
    const accessible = await getAccessibleClientIdsForUser(user.id);
    const draft = await prisma.aIDraft.findUnique({
      where: { id: draftId },
      select: { id: true, leadId: true, lead: { select: { clientId: true } } },
    });
    if (!draft) return { success: false, error: "Draft not found" };
    if (!accessible.includes(draft.lead.clientId)) return { success: false, error: "Unauthorized" };

    await prisma.aIDraft.update({
      where: { id: draftId },
      data: { status: "rejected" },
    });

    revalidatePath("/");

    return { success: true };
  } catch (error) {
    console.error("Failed to reject draft:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Regenerate an AI draft for a lead
 * This rejects any existing pending drafts and creates a new one
 * 
 * @param leadId - The lead ID
 */
export async function regenerateDraft(
  leadId: string,
  channel: "sms" | "email" | "linkedin" = "sms"
): Promise<{
  success: boolean;
  data?: { id: string; content: string };
  error?: string
}> {
  return withAiTelemetrySourceIfUnset("action:message.regenerate_draft", async () => {
    try {
      await requireLeadAccess(leadId);

      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: {
          id: true,
          sentimentTag: true,
          email: true,
        },
      });

      if (!lead) {
        return { success: false, error: "Lead not found" };
      }

      // Reject any existing pending drafts for this channel
      await prisma.aIDraft.updateMany({
        where: {
          leadId,
          status: "pending",
          channel,
        },
        data: { status: "rejected" },
      });

      // Build conversation transcript from recent messages (chronological)
      const recentMessages = await prisma.message.findMany({
        where: { leadId },
        orderBy: { sentAt: "desc" },
        take: 80,
        select: {
          sentAt: true,
          channel: true,
          direction: true,
          body: true,
          subject: true,
        },
      });

      const transcript = buildSentimentTranscriptFromMessages(recentMessages.reverse());
      const sentimentTag = lead.sentimentTag || "Neutral";
      const email = channel === "email" ? lead.email : null;

      if (!shouldGenerateDraft(sentimentTag, email)) {
        return { success: false, error: "Cannot generate draft for this sentiment" };
      }

      const draftResult = await generateResponseDraft(leadId, transcript, sentimentTag, channel);

      if (!draftResult.success || !draftResult.draftId || !draftResult.content) {
        return { success: false, error: draftResult.error || "Failed to generate draft" };
      }

      revalidatePath("/");

      return {
        success: true,
        data: {
          id: draftResult.draftId,
          content: draftResult.content,
        },
      };
    } catch (error) {
      console.error("Failed to regenerate draft:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
}

// =============================================================================
// Bulk Draft Regeneration (Phase 45)
// =============================================================================

type DraftChannel = "sms" | "email" | "linkedin";

export type RegenerateAllDraftsMode = "pending_only" | "all_eligible";

export type RegenerateAllDraftsResult = {
  success: boolean;
  totalEligible: number;
  processedLeads: number;
  nextCursor: number | null;
  hasMore: boolean;
  regenerated: number;
  skipped: number;
  errors: number;
  error?: string;
};

type RegenerateAllDraftsOptions = {
  cursor?: number | null;
  maxSeconds?: number;
  mode?: RegenerateAllDraftsMode;
};

async function regenerateDraftSystem(leadId: string, channel: DraftChannel): Promise<{ success: boolean; error?: string }> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      sentimentTag: true,
      email: true,
    },
  });

  if (!lead) return { success: false, error: "Lead not found" };

  // Reject any existing pending drafts for this channel
  await prisma.aIDraft.updateMany({
    where: {
      leadId,
      status: "pending",
      channel,
    },
    data: { status: "rejected" },
  });

  const recentMessages = await prisma.message.findMany({
    where: { leadId },
    orderBy: { sentAt: "desc" },
    take: 80,
    select: {
      sentAt: true,
      channel: true,
      direction: true,
      body: true,
      subject: true,
    },
  });

  const transcript = buildSentimentTranscriptFromMessages(recentMessages.reverse());

  const sentimentTag = lead.sentimentTag || "Neutral";
  const email = channel === "email" ? lead.email : null;

  if (!shouldGenerateDraft(sentimentTag, email)) {
    return { success: false, error: "Cannot generate draft for this sentiment" };
  }

  const draftResult = await generateResponseDraft(leadId, transcript, sentimentTag, channel);
  if (!draftResult.success || !draftResult.draftId || !draftResult.content) {
    return { success: false, error: draftResult.error || "Failed to generate draft" };
  }

  return { success: true };
}

export async function regenerateAllDrafts(
  clientId: string,
  channel: DraftChannel,
  options: RegenerateAllDraftsOptions = {}
): Promise<RegenerateAllDraftsResult> {
  return withAiTelemetrySourceIfUnset("action:message.regenerate_all_drafts", async () => {
    try {
      await requireClientAdminAccess(clientId);

      const startedAtMs = Date.now();
      const maxSeconds = Number.isFinite(options.maxSeconds) && (options.maxSeconds || 0) > 0 ? options.maxSeconds! : 55;
      const deadlineMs = startedAtMs + maxSeconds * 1000;

      const configuredConcurrency = Number(process.env.REGENERATE_ALL_DRAFTS_CONCURRENCY || "");
      const CONCURRENCY =
        Number.isFinite(configuredConcurrency) && configuredConcurrency > 0 ? Math.floor(configuredConcurrency) : 1;

      const mode: RegenerateAllDraftsMode = options.mode ?? "pending_only";
      const startIndex = options.cursor && options.cursor > 0 ? Math.floor(options.cursor) : 0;

      const eligibleSentiments = [
        "Meeting Requested",
        "Call Requested",
        "Information Requested",
        "Interested",
        "Follow Up",
        "Positive", // legacy
      ];

      const leads = await prisma.lead.findMany({
        where: {
          clientId,
          ...(mode === "pending_only"
            ? { aiDrafts: { some: { status: "pending", channel } } }
            : { sentimentTag: { in: eligibleSentiments } }),
        },
        select: {
          id: true,
          sentimentTag: true,
          email: true,
        },
        orderBy: { id: "asc" },
      });

      let processedLeads = 0;
      let regenerated = 0;
      let skipped = 0;
      let errors = 0;
      let nextIndex: number | null = null;

      for (let i = startIndex; i < leads.length; i += CONCURRENCY) {
        if (Date.now() >= deadlineMs) {
          nextIndex = i;
          break;
        }

        const batch = leads.slice(i, i + CONCURRENCY);
        processedLeads += batch.length;

        const results = await Promise.allSettled(
          batch.map(async (lead) => {
            const sentimentTag = lead.sentimentTag || "Neutral";
            const email = channel === "email" ? lead.email : null;

            if (!shouldGenerateDraft(sentimentTag, email)) {
              return { status: "skipped" as const };
            }

            const draftResult = await regenerateDraftSystem(lead.id, channel);
            if (!draftResult.success) {
              return {
                status:
                  draftResult.error === "Cannot generate draft for this sentiment"
                    ? ("skipped" as const)
                    : ("error" as const),
              };
            }

            return { status: "regenerated" as const };
          })
        );

        for (const result of results) {
          if (result.status === "fulfilled") {
            if (result.value.status === "regenerated") regenerated++;
            else if (result.value.status === "skipped") skipped++;
            else errors++;
          } else {
            errors++;
          }
        }
      }

      const hasMore = nextIndex != null && nextIndex < leads.length;

      if (regenerated > 0) {
        revalidatePath("/");
      }

      return {
        success: true,
        totalEligible: leads.length,
        processedLeads,
        nextCursor: hasMore ? nextIndex : null,
        hasMore,
        regenerated,
        skipped,
        errors,
      };
    } catch (error) {
      console.error("[RegenerateAllDrafts] Failed:", error);
      return {
        success: false,
        totalEligible: 0,
        processedLeads: 0,
        nextCursor: null,
        hasMore: false,
        regenerated: 0,
        skipped: 0,
        errors: 1,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
}

// =============================================================================
// Bounce Cleanup Functions
// =============================================================================

/**
 * Detect if an email address is a bounce notification sender
 */
function isBounceEmailAddress(email: string | null | undefined): boolean {
  if (!email) return false;
  const lowerEmail = email.toLowerCase();
  return (
    lowerEmail.includes("mailer-daemon") ||
    lowerEmail.includes("postmaster") ||
    lowerEmail.includes("mail-delivery") ||
    lowerEmail.includes("maildelivery") ||
    (lowerEmail.includes("noreply") && lowerEmail.includes("google")) ||
    lowerEmail.startsWith("bounce")
  );
}

/**
 * Parse bounce email body to extract the original recipient
 */
function parseBounceRecipientFromBody(body: string | null | undefined): string | null {
  if (!body) return null;

  const patterns = [
    /wasn't delivered to\s+([^\s<]+@[^\s>]+)/i,
    /delivery to\s+([^\s<]+@[^\s>]+)\s+failed/i,
    /couldn't be delivered to\s+([^\s<]+@[^\s>]+)/i,
    /message wasn't delivered to\s+([^\s<]+@[^\s>]+)/i,
    /550[- ]\d+\.\d+\.\d+\s+<?([^\s<>]+@[^\s<>]+)>?/i,
    /recipient[:\s]+<?([^\s<>]+@[^\s<>]+)>?/i,
    /failed recipient[:\s]+<?([^\s<>]+@[^\s<>]+)>?/i,
    /Delivery has failed to these recipients[^<]*<?([^\s<>]+@[^\s<>]+)>?/i,
    /couldn't reach\s+<?([^\s<>]+@[^\s<>]+)>?/i,
    /failed:?\s+<?([^\s<>]+@[^\s<>]+)>?/i,
    /(?:undeliverable|bounced|failed|rejected)[^<]*<([^\s<>]+@[^\s<>]+)>/i,
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match && match[1]) {
      const email = match[1].trim().toLowerCase();
      if (email.includes("@") && !isBounceEmailAddress(email)) {
        return email;
      }
    }
  }
  return null;
}

interface CleanupBounceResult {
  success: boolean;
  fakeLeadsFound: number;
  messagesMigrated: number;
  leadsDeleted: number;
  leadsBlacklisted: number;
  leadsMarkedForReview: number;
  errors: string[];
}

/**
 * Clean up fake bounce leads (like "Mail Delivery Subsystem")
 * Migrates their messages to the correct original leads and deletes the fake leads.
 * If original recipient can't be determined, marks the bounce lead for manual review.
 */
export async function cleanupBounceLeads(clientId: string): Promise<CleanupBounceResult> {
  const result: CleanupBounceResult = {
    success: true,
    fakeLeadsFound: 0,
    messagesMigrated: 0,
    leadsDeleted: 0,
    leadsBlacklisted: 0,
    leadsMarkedForReview: 0,
    errors: [],
  };


  // BUG FIX: Track unique leads that have been blacklisted to avoid double-counting
  const blacklistedLeadIds = new Set<string>();
  try {
    await requireClientAdminAccess(clientId);
    // Find fake bounce leads (mailer-daemon, Mail Delivery Subsystem, etc.)
    const fakeLeads = await prisma.lead.findMany({
      where: {
        clientId,
        OR: [
          { email: { contains: "mailer-daemon", mode: "insensitive" } },
          { email: { contains: "postmaster", mode: "insensitive" } },
          { firstName: { contains: "Mail Delivery", mode: "insensitive" } },
          { firstName: { contains: "Mailer-Daemon", mode: "insensitive" } },
        ],
      },
      include: {
        messages: true,
      },
    });

    result.fakeLeadsFound = fakeLeads.length;
    console.log(`[CleanupBounce] Found ${fakeLeads.length} fake bounce leads`);

    for (const fakeLead of fakeLeads) {
      try {
        let messagesProcessed = 0;
        let couldNotMatch = false;

        for (const message of fakeLead.messages) {
          // Try to find original recipient from message body
          const originalRecipient = parseBounceRecipientFromBody(message.body) ||
            parseBounceRecipientFromBody(message.rawText) ||
            parseBounceRecipientFromBody(message.rawHtml);

          if (originalRecipient) {
            // Find the original lead
            const originalLead = await prisma.lead.findFirst({
              where: {
                clientId,
                email: { equals: originalRecipient, mode: "insensitive" },
                id: { not: fakeLead.id }, // Not the fake lead itself
              },
            });

            if (originalLead) {
              // Migrate the message to the original lead
              await prisma.message.update({
                where: { id: message.id },
                data: {
                  leadId: originalLead.id,
                  source: "bounce",
                },
              });
              result.messagesMigrated++;
              messagesProcessed++;

              // BUG FIX: Only blacklist and count if not already blacklisted
              if (!blacklistedLeadIds.has(originalLead.id)) {
                // Blacklist the lead
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

                blacklistedLeadIds.add(originalLead.id);
                result.leadsBlacklisted++;
                console.log(`[CleanupBounce] Blacklisted lead ${originalLead.id} (${originalRecipient}) and rejected pending drafts`);
              }
              console.log(`[CleanupBounce] Migrated message to lead ${originalLead.id} (${originalRecipient})`);
            } else {
              // Could not find original lead - mark for review
              console.log(`[CleanupBounce] Could not find original lead for: ${originalRecipient}`);
              couldNotMatch = true;
            }
          } else {
            // Can't determine original recipient - mark for review
            console.log(`[CleanupBounce] Could not parse recipient from message ${message.id}`);
            couldNotMatch = true;
          }
        }

        // If all messages were successfully migrated, delete the fake lead
        // Otherwise, mark the lead for manual review
        if (messagesProcessed > 0 && !couldNotMatch) {
          await prisma.lead.delete({ where: { id: fakeLead.id } });
          result.leadsDeleted++;
          console.log(`[CleanupBounce] Deleted fake lead: ${fakeLead.email}`);
        } else if (couldNotMatch) {
          // Mark for manual review - update status to needs_review
          await prisma.lead.update({
            where: { id: fakeLead.id },
            data: {
              status: "needs_review",
              sentimentTag: "Blacklist", // Still mark as blacklist sentiment
            },
          });
          result.leadsMarkedForReview++;
          console.log(`[CleanupBounce] Marked for review: ${fakeLead.email} (could not match all messages)`);
        }

      } catch (leadError) {
        const errorMsg = `Failed to process fake lead ${fakeLead.id}: ${leadError}`;
        result.errors.push(errorMsg);
        console.error(`[CleanupBounce] ${errorMsg}`);
      }
    }

    revalidatePath("/");

    console.log(`[CleanupBounce] Complete: ${result.messagesMigrated} messages migrated, ${result.leadsDeleted} fake leads deleted, ${result.leadsBlacklisted} unique leads blacklisted, ${result.leadsMarkedForReview} marked for review`);

    return result;
  } catch (error) {
    console.error("[CleanupBounce] Failed:", error);
    return {
      ...result,
      success: false,
      errors: [...result.errors, error instanceof Error ? error.message : "Unknown error"],
    };
  }
}

/**
 * Check LinkedIn connection status and InMail balance for a lead
 * Used to show connection status UI and determine messaging options
 */
export interface LinkedInStatusResult {
  success: boolean;
  error?: string;
  connectionStatus: LinkedInConnectionStatus;
  canSendDM: boolean;
  canSendInMail: boolean;
  hasOpenProfile: boolean;
  inMailBalance: InMailBalanceResult | null;
}

export async function checkLinkedInStatus(leadId: string): Promise<LinkedInStatusResult> {
  const defaultResult: LinkedInStatusResult = {
    success: false,
    connectionStatus: "NOT_CONNECTED",
    canSendDM: false,
    canSendInMail: false,
    hasOpenProfile: false,
    inMailBalance: null,
  };

  try {
    await requireLeadAccess(leadId);
    // Get the lead with their client (for Unipile account)
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        client: {
          select: {
            id: true,
            unipileAccountId: true,
          },
        },
      },
    });

    if (!lead) {
      return { ...defaultResult, error: "Lead not found" };
    }

    if (!lead.linkedinUrl && !lead.linkedinId) {
      return { ...defaultResult, error: "Lead has no LinkedIn profile linked" };
    }

    // Require linkedinUrl for Unipile API - linkedinId alone is not sufficient
    if (!lead.linkedinUrl) {
      return { ...defaultResult, error: "Lead has linkedinId but no LinkedIn URL - cannot check status" };
    }

    if (!lead.client.unipileAccountId) {
      return { ...defaultResult, error: "Workspace has no LinkedIn account configured" };
    }

    const linkedinUrl = lead.linkedinUrl;
    const accountId = lead.client.unipileAccountId;

    // Check connection status and InMail balance in parallel
    const [connectionResult, inMailBalance] = await Promise.all([
      checkLinkedInConnection(accountId, linkedinUrl),
      checkInMailBalance(accountId),
    ]);

    if (connectionResult.isDisconnectedAccount) {
      await updateUnipileConnectionHealth({
        clientId: lead.client.id,
        isDisconnected: true,
        errorDetail: connectionResult.error,
      }).catch((err) => console.error("[checkLinkedInStatus] Failed to update Unipile health:", err));
    } else if (!connectionResult.error) {
      await updateUnipileConnectionHealth({
        clientId: lead.client.id,
        isDisconnected: false,
      }).catch(() => undefined);
    }

    return {
      success: true,
      connectionStatus: connectionResult.status,
      canSendDM: connectionResult.canSendDM,
      canSendInMail: connectionResult.canSendInMail,
      hasOpenProfile: connectionResult.hasOpenProfile,
      inMailBalance,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Not authenticated" || message === "Unauthorized") {
      return { ...defaultResult, error: "Unauthorized" };
    }

    console.error("[checkLinkedInStatus] Failed:", error);
    return {
      ...defaultResult,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
