"use server";

import { prisma } from "@/lib/prisma";
import { sendSMS, exportMessages, type GHLExportedMessage } from "@/lib/ghl-api";
import { fetchEmailBisonReplies, fetchEmailBisonSentEmails } from "@/lib/emailbison-api";
import { revalidatePath } from "next/cache";
import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { buildSentimentTranscriptFromMessages, classifySentiment, detectBounce, SENTIMENT_TO_STATUS, type SentimentTag } from "@/lib/sentiment";
import { sendEmailReply } from "@/actions/email-actions";
import {
  sendLinkedInMessageWithWaterfall,
  checkLinkedInConnection,
  checkInMailBalance,
  type SendResult as UnipileSendResult,
  type LinkedInConnectionStatus,
  type InMailBalanceResult,
} from "@/lib/unipile-api";

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
    return "Neutral";
  }

  // Only auto-classify if lead has NEVER responded
  const hasInboundMessages = messages.some(m => m.direction === "inbound");
  if (!hasInboundMessages) {
    console.log("[PreClassify] Lead has never responded → Neutral");
    return "Neutral";
  }

  // Lead has responded at some point - always use AI to analyze what they said
  return null;
}

async function computeSentimentFromMessages(
  messages: { body: string; direction: string; channel?: string | null; subject?: string | null; sentAt: Date }[]
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

  return classifySentiment(transcript);
}

async function refreshLeadSentimentTag(leadId: string): Promise<{
  sentimentTag: SentimentTag;
  status: string;
}> {
  // IMPORTANT: Get ALL messages across all channels (SMS, email, LinkedIn)
  // to ensure sentiment classification considers the full conversation history
  const messages = await prisma.message.findMany({
    where: { leadId },
    select: { body: true, direction: true, channel: true, subject: true, sentAt: true },
    orderBy: { sentAt: "asc" },
  });

  const sentimentTag = await computeSentimentFromMessages(messages);
  const status = SENTIMENT_TO_STATUS[sentimentTag] || "new";

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      sentimentTag,
      status,
    },
  });

  return { sentimentTag, status };
}

export async function reanalyzeLeadSentiment(leadId: string): Promise<{
  success: boolean;
  sentimentTag?: SentimentTag;
  status?: string;
  error?: string;
}> {
  try {
    const leadExists = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true },
    });

    if (!leadExists) {
      return { success: false, error: "Lead not found" };
    }

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
}

interface SendMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface SyncHistoryResult {
  success: boolean;
  importedCount?: number;
  healedCount?: number;  // Messages with corrected ghlId/timestamp
  totalMessages?: number;
  skippedDuplicates?: number;
  reclassifiedSentiment?: boolean;  // Whether sentiment was re-analyzed
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
  // First get the lead's sync capabilities
  const syncInfo = await getLeadSyncInfo(leadId);

  if (!syncInfo.success || !syncInfo.data) {
    return { success: false, error: syncInfo.error || "Failed to get lead sync info", reclassifiedSentiment: false };
  }

  const { canSyncSms, canSyncEmail, hasEmailMessages, hasSmsMessages, emailBisonLeadId, ghlContactId } = syncInfo.data;

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
      syncedEmail = true;
    } else if (emailResult.error) {
      errors.push(`Email: ${emailResult.error}`);
    }
  }

  // If all attempted syncs failed and no messages were processed at all, return error
  // Include totalSkipped check - if we skipped duplicates, that means sync worked but messages already existed
  // Also check reclassifiedSentiment - if we reclassified, the sync was at least partially successful
  if (errors.length > 0 && totalImported === 0 && totalHealed === 0 && totalSkipped === 0 && !reclassifiedSentiment) {
    return { success: false, error: errors.join("; "), reclassifiedSentiment: false };
  }

  return {
    success: true,
    importedCount: totalImported,
    healedCount: totalHealed,
    totalMessages,
    skippedDuplicates: totalSkipped,
    reclassifiedSentiment,
    syncedSms,
    syncedEmail,
  };
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
  try {
    // Get the lead with their client info
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

    // Count SMS messages for this lead
    const smsMessageCount = await prisma.message.count({
      where: {
        leadId,
        channel: "sms",
      },
    });

    if (!lead.ghlContactId) {
      // Provide more helpful error message based on context
      const hasSmsMessages = smsMessageCount > 0;
      if (hasSmsMessages) {
        return {
          success: false,
          error: "Cannot sync SMS: Lead was created from email only (no GHL contact ID)"
        };
      }
      return { success: false, error: "Lead has no GHL contact ID" };
    }

    if (!lead.client.ghlPrivateKey || !lead.client.ghlLocationId) {
      return { success: false, error: "Workspace is missing GHL configuration" };
    }

    console.log(`[Sync] Fetching conversation history for lead ${leadId} (contact: ${lead.ghlContactId})`);

    // Fetch messages from GHL
    const exportResult = await exportMessages(
      lead.client.ghlLocationId,
      lead.ghlContactId,
      lead.client.ghlPrivateKey,
      "SMS"
    );

    if (!exportResult.success || !exportResult.data) {
      return { success: false, error: exportResult.error || "Failed to fetch messages from GHL" };
    }

    const ghlMessages = exportResult.data.messages || [];
    console.log(`[Sync] Found ${ghlMessages.length} messages in GHL`);

    // Intelligent sync using ghlId as source of truth
    let importedCount = 0;
    let healedCount = 0;
    let skippedDuplicates = 0;

    for (const msg of ghlMessages) {
      try {
        const msgTimestamp = new Date(msg.dateAdded); // Actual time from GHL
        const ghlId = msg.id;

        // Step 1: Check if message exists by ghlId (definitive match)
        const existingByGhlId = await prisma.message.findUnique({
          where: { ghlId },
        });

        if (existingByGhlId) {
          // Message already exists with ghlId - just ensure timestamp is correct
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
          continue;
        }

        // Step 2: Check if message exists by body + direction (legacy match without ghlId)
        const existingByContent = await prisma.message.findFirst({
          where: {
            leadId,
            body: msg.body,
            direction: msg.direction,
            ghlId: null, // Only match messages without ghlId
          },
        });

        if (existingByContent) {
          // "Heal" the legacy message: add ghlId and correct timestamp
          await prisma.message.update({
            where: { id: existingByContent.id },
            data: {
              ghlId,
              sentAt: msgTimestamp, // Fix the timestamp to GHL's actual time
            },
          });
          healedCount++;
          console.log(`[Sync] Healed: "${msg.body.substring(0, 30)}..." -> ghlId: ${ghlId}, sentAt: ${msgTimestamp.toISOString()}`);
          continue;
        }

        // Step 3: No match found - create new message with ghlId
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
        console.log(`[Sync] Imported: "${msg.body.substring(0, 30)}..." (${msg.direction}) @ ${msgTimestamp.toISOString()}`);
      } catch (error) {
        // Log but continue with other messages
        console.error(`[Sync] Error processing message ${msg.id}: ${error}`);
      }
    }

    console.log(`[Sync] Complete: ${importedCount} imported, ${healedCount} healed, ${skippedDuplicates} unchanged`);

    // Re-run sentiment analysis if:
    // 1. Messages were actually imported or healed, OR
    // 2. forceReclassify option is enabled (user explicitly requested re-analysis)
    let reclassifiedSentiment = false;
    const shouldReclassify = importedCount > 0 || healedCount > 0 || options.forceReclassify;

    if (shouldReclassify) {
      try {
        const { sentimentTag, status } = await refreshLeadSentimentTag(leadId);
        reclassifiedSentiment = true;
        console.log(`[Sync] Reclassified sentiment to ${sentimentTag} and status to ${status}${options.forceReclassify ? " (forced)" : ""}`);
      } catch (reclassError) {
        console.error("[Sync] Failed to refresh sentiment after sync:", reclassError);
      }
    } else {
      console.log(`[Sync] Skipping sentiment reclassification - no new or healed messages`);
    }

    revalidatePath("/");

    return {
      success: true,
      importedCount,
      healedCount,
      totalMessages: ghlMessages.length,
      skippedDuplicates,
      reclassifiedSentiment,
    };
  } catch (error) {
    console.error("[Sync] Failed to sync conversation history:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

interface SyncAllResult {
  success: boolean;
  totalLeads: number;
  totalImported: number;
  totalHealed: number;
  totalDraftsGenerated: number;
  totalReclassified: number;
  errors: number;
  error?: string;
}

/**
 * Sync all SMS conversations for a workspace (client)
 * Iterates through all leads with GHL contact IDs and syncs their history
 * Also regenerates AI drafts for eligible leads (non-blacklisted)
 * 
 * @param clientId - The workspace/client ID to sync
 * @param options - Sync options including forceReclassify to re-analyze sentiment for all leads
 */
export async function syncAllConversations(clientId: string, options: SyncOptions = {}): Promise<SyncAllResult> {
  try {
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
    });

    console.log(`[SyncAll] Starting sync for ${leads.length} leads in client ${clientId}${options.forceReclassify ? " (with sentiment re-analysis)" : ""}`);

    let totalImported = 0;
    let totalHealed = 0;
    let totalDraftsGenerated = 0;
    let totalReclassified = 0;
    let errors = 0;

    // Process leads in parallel with a concurrency limit (5 at a time to avoid overwhelming APIs)
    const BATCH_SIZE = 5;

    for (let i = 0; i < leads.length; i += BATCH_SIZE) {
      const batch = leads.slice(i, i + BATCH_SIZE);

      // Use smartSyncConversation which handles both SMS and Email
      const results = await Promise.allSettled(
        batch.map(lead => smartSyncConversation(lead.id, options))
      );

      // Process sync results and generate drafts for eligible leads
      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const leadId = batch[j].id;

        if (result.status === "fulfilled" && result.value.success) {
          totalImported += result.value.importedCount || 0;
          totalHealed += result.value.healedCount || 0;
          if (result.value.reclassifiedSentiment) {
            totalReclassified++;
          }

          // After successful sync, regenerate AI draft if eligible
          try {
            const lead = await prisma.lead.findUnique({
              where: { id: leadId },
              select: { sentimentTag: true, status: true },
            });

            // Only generate draft if not blacklisted
            if (lead && shouldGenerateDraft(lead.sentimentTag || "Neutral")) {
              const syncResult = result.value as SmartSyncResult;

              // BUG FIX: Generate drafts for BOTH channels that were synced
              if (syncResult.syncedSms) {
                const smsDraftResult = await regenerateDraft(leadId, "sms");
                if (smsDraftResult.success) {
                  totalDraftsGenerated++;
                  console.log(`[SyncAll] Generated SMS draft for lead ${leadId}`);
                }
              }
              if (syncResult.syncedEmail) {
                const emailDraftResult = await regenerateDraft(leadId, "email");
                if (emailDraftResult.success) {
                  totalDraftsGenerated++;
                  console.log(`[SyncAll] Generated Email draft for lead ${leadId}`);
                }
              }
            }
          } catch (draftError) {
            console.error(`[SyncAll] Failed to generate draft for lead ${leadId}:`, draftError);
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

    console.log(`[SyncAll] Complete: ${totalImported} imported, ${totalHealed} healed, ${totalReclassified} reclassified, ${totalDraftsGenerated} drafts, ${errors} errors`);

    // Auto-run bounce cleanup after syncing
    console.log(`[SyncAll] Running bounce cleanup for client ${clientId}...`);
    try {
      const cleanupResult = await cleanupBounceLeads(clientId);
      if (cleanupResult.fakeLeadsFound > 0) {
        console.log(`[SyncAll] Bounce cleanup: ${cleanupResult.fakeLeadsFound} fake leads found, ${cleanupResult.leadsDeleted} deleted, ${cleanupResult.leadsBlacklisted} blacklisted`);
      }
    } catch (cleanupError) {
      console.error("[SyncAll] Bounce cleanup failed:", cleanupError);
    }

    revalidatePath("/");

    return {
      success: true,
      totalLeads: leads.length,
      totalImported,
      totalHealed,
      totalDraftsGenerated,
      totalReclassified,
      errors,
    };
  } catch (error) {
    console.error("[SyncAll] Failed to sync all conversations:", error);
    return {
      success: false,
      totalLeads: 0,
      totalImported: 0,
      totalHealed: 0,
      totalDraftsGenerated: 0,
      totalReclassified: 0,
      errors: 1,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
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
  try {
    // Get the lead with their client info and message count
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
      // Provide more helpful error message based on context
      const hasEmailMessages = lead._count.messages > 0;
      if (hasEmailMessages) {
        return {
          success: false,
          error: "Cannot sync: Lead emails came from a bounce notification or external source (no EmailBison lead ID)"
        };
      }
      return { success: false, error: "Lead has no EmailBison lead ID" };
    }

    if (!lead.client.emailBisonApiKey) {
      return { success: false, error: "Workspace is missing EmailBison API key" };
    }

    console.log(`[EmailSync] Fetching conversation history for lead ${leadId} (EmailBison ID: ${lead.emailBisonLeadId})`);

    // Fetch replies (inbound messages) from EmailBison
    const repliesResult = await fetchEmailBisonReplies(
      lead.client.emailBisonApiKey,
      lead.emailBisonLeadId
    );

    if (!repliesResult.success) {
      return { success: false, error: repliesResult.error || "Failed to fetch replies from EmailBison" };
    }

    // Fetch sent emails (outbound campaign messages) from EmailBison
    const sentResult = await fetchEmailBisonSentEmails(
      lead.client.emailBisonApiKey,
      lead.emailBisonLeadId
    );

    if (!sentResult.success) {
      return { success: false, error: sentResult.error || "Failed to fetch sent emails from EmailBison" };
    }

    const replies = repliesResult.data || [];
    const sentEmails = sentResult.data || [];

    console.log(`[EmailSync] Found ${replies.length} replies and ${sentEmails.length} sent emails in EmailBison`);

    let importedCount = 0;
    let healedCount = 0;
    let skippedDuplicates = 0;

    // Process inbound replies
    for (const reply of replies) {
      try {
        const emailBisonReplyId = String(reply.id);
        const msgTimestamp = reply.date_received
          ? new Date(reply.date_received)
          : reply.created_at
            ? new Date(reply.created_at)
            : new Date();
        const body = cleanEmailBody(reply.html_body, reply.text_body);
        const subject = reply.email_subject || null;

        // Skip if no body
        if (!body) {
          console.log(`[EmailSync] Skipping reply ${emailBisonReplyId}: empty body`);
          continue;
        }

        // Step 1: Check if message exists by emailBisonReplyId (definitive match)
        const existingByReplyId = await prisma.message.findUnique({
          where: { emailBisonReplyId },
        });

        if (existingByReplyId) {
          // Message already exists - just ensure timestamp is correct
          if (existingByReplyId.sentAt.getTime() !== msgTimestamp.getTime()) {
            await prisma.message.update({
              where: { emailBisonReplyId },
              data: { sentAt: msgTimestamp },
            });
            console.log(`[EmailSync] Fixed timestamp for replyId ${emailBisonReplyId}`);
            healedCount++;
          } else {
            skippedDuplicates++;
          }
          continue;
        }

        // Step 2: Check for legacy message without emailBisonReplyId (match by body/subject)
        const existingByContent = await prisma.message.findFirst({
          where: {
            leadId,
            direction: "inbound",
            channel: "email",
            emailBisonReplyId: null,
            OR: [
              { body: { contains: body.substring(0, 100) } },
              { subject: subject },
            ],
          },
        });

        if (existingByContent) {
          // Heal the legacy message
          await prisma.message.update({
            where: { id: existingByContent.id },
            data: {
              emailBisonReplyId,
              sentAt: msgTimestamp,
              subject: subject || existingByContent.subject,
            },
          });
          healedCount++;
          console.log(`[EmailSync] Healed reply: "${body.substring(0, 30)}..." -> replyId: ${emailBisonReplyId}`);
          continue;
        }

        // Step 3: Create new message
        await prisma.message.create({
          data: {
            emailBisonReplyId,
            channel: "email",
            source: "zrg",
            body,
            rawHtml: reply.html_body ?? null,
            rawText: reply.text_body ?? null,
            subject,
            direction: "inbound",
            leadId,
            sentAt: msgTimestamp,
          },
        });
        importedCount++;
        console.log(`[EmailSync] Imported reply: "${body.substring(0, 30)}..." @ ${msgTimestamp.toISOString()}`);
      } catch (error) {
        console.error(`[EmailSync] Error processing reply ${reply.id}:`, error);
      }
    }

    // Process outbound sent emails
    for (const sentEmail of sentEmails) {
      try {
        const inboxxiaScheduledEmailId = String(sentEmail.id);
        const msgTimestamp = sentEmail.sent_at
          ? new Date(sentEmail.sent_at)
          : new Date();
        const body = sentEmail.email_body || "";
        const subject = sentEmail.email_subject || null;

        // Skip if no body
        if (!body) {
          continue;
        }

        // Check if already exists by scheduled email ID
        const existingByEmailId = await prisma.message.findUnique({
          where: { inboxxiaScheduledEmailId },
        });

        if (existingByEmailId) {
          skippedDuplicates++;
          continue;
        }

        // Check for legacy message
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

        // Create new message
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

    // Re-run sentiment analysis if:
    // 1. Messages were actually imported or healed, OR
    // 2. forceReclassify option is enabled (user explicitly requested re-analysis)
    let reclassifiedSentiment = false;
    const shouldReclassify = importedCount > 0 || healedCount > 0 || options.forceReclassify;

    if (shouldReclassify) {
      try {
        const { sentimentTag } = await refreshLeadSentimentTag(leadId);
        reclassifiedSentiment = true;
        console.log(`[EmailSync] Reclassified sentiment to ${sentimentTag}${options.forceReclassify ? " (forced)" : ""}`);
      } catch (reclassError) {
        console.error("[EmailSync] Failed to refresh sentiment after sync:", reclassError);
      }
    } else {
      console.log(`[EmailSync] Skipping sentiment reclassification - no new or healed messages`);
    }

    revalidatePath("/");

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

/**
 * Sync all email conversations for a workspace (client)
 * Iterates through all leads with EmailBison lead IDs and syncs their history
 * Also regenerates AI drafts for eligible leads
 * 
 * @param clientId - The workspace/client ID to sync
 */
export async function syncAllEmailConversations(clientId: string): Promise<SyncAllResult> {
  try {
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
              select: { sentimentTag: true, status: true },
            });

            if (lead && shouldGenerateDraft(lead.sentimentTag || "Neutral")) {
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

    revalidatePath("/");

    return {
      success: true,
      totalLeads: leads.length,
      totalImported,
      totalHealed,
      totalDraftsGenerated,
      totalReclassified: 0,
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
      errors: 1,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
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
  try {
    // Get the lead with their client (for API key)
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        client: {
          select: {
            ghlPrivateKey: true,
          },
        },
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    if (!lead.ghlContactId) {
      return { success: false, error: "Lead has no GHL contact ID" };
    }

    if (!lead.client.ghlPrivateKey) {
      return { success: false, error: "Workspace has no GHL API key configured" };
    }

    // Send SMS via GHL API
    const result = await sendSMS(
      lead.ghlContactId,
      message,
      lead.client.ghlPrivateKey
    );

    if (!result.success) {
      return { success: false, error: result.error || "Failed to send message via GHL" };
    }

    // Extract GHL message ID and timestamp from response
    const ghlMessageId = result.data?.messageId || null;
    const ghlDateAdded = result.data?.dateAdded ? new Date(result.data.dateAdded) : new Date();

    console.log(`[sendMessage] GHL messageId: ${ghlMessageId}, dateAdded: ${ghlDateAdded.toISOString()}`);

    // Save the outbound message to our database with GHL ID
    const savedMessage = await prisma.message.create({
      data: {
        ghlId: ghlMessageId, // Store GHL message ID for deduplication
        body: message,
        direction: "outbound",
        channel: "sms",
        leadId: lead.id,
        sentAt: ghlDateAdded, // Use GHL timestamp for accuracy
      },
    });

    // Update the lead's updatedAt timestamp
    await prisma.lead.update({
      where: { id: leadId },
      data: { updatedAt: new Date() },
    });

    revalidatePath("/");

    return {
      success: true,
      messageId: savedMessage.id,
    };
  } catch (error) {
    console.error("Failed to send message:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
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
  inMailSubject?: string
): Promise<SendMessageResult & { messageType?: "dm" | "inmail" | "connection_request"; attemptedMethods?: string[] }> {
  try {
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
      return {
        success: false,
        error: result.error,
        attemptedMethods: result.attemptedMethods,
      };
    }

    // Save the outbound message to our database
    const savedMessage = await prisma.message.create({
      data: {
        body: message,
        direction: "outbound",
        channel: "linkedin",
        source: "zrg",
        leadId: lead.id,
        sentAt: new Date(),
      },
    });

    // Update the lead's updatedAt timestamp
    await prisma.lead.update({
      where: { id: leadId },
      data: { updatedAt: new Date() },
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
}

/**
 * Get pending AI drafts for a lead
 * 
 * @param leadId - The internal lead ID
 */
export async function getPendingDrafts(leadId: string, channel?: "sms" | "email" | "linkedin") {
  try {
    console.log("[getPendingDrafts] Fetching drafts for leadId:", leadId);

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

    console.log("[getPendingDrafts] Found drafts:", drafts.length, drafts.map(d => ({ id: d.id, status: d.status })));

    return { success: true, data: drafts };
  } catch (error) {
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
export async function approveAndSendDraft(
  draftId: string,
  editedContent?: string
): Promise<SendMessageResult> {
  try {
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

    if (draft.status !== "pending") {
      return { success: false, error: "Draft is not pending" };
    }

    if (draft.channel === "email") {
      return await sendEmailReply(draftId, editedContent);
    }

    if (draft.channel === "linkedin") {
      // Send LinkedIn message via Unipile
      const messageContent = editedContent || draft.content;
      const linkedInResult = await sendLinkedInMessage(draft.leadId, messageContent);

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

    const messageContent = editedContent || draft.content;

    // Send the message (SMS)
    const sendResult = await sendMessage(draft.leadId, messageContent);

    if (!sendResult.success) {
      return sendResult;
    }

    // Mark draft as approved
    await prisma.aIDraft.update({
      where: { id: draftId },
      data: { status: "approved" },
    });

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
  try {
    // Get the lead with messages for context
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        messages: {
          orderBy: { sentAt: "asc" }, // Order by actual message time
          take: 10, // Last 10 messages for context
        },
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    // Reject any existing pending drafts
    await prisma.aIDraft.updateMany({
      where: {
        leadId,
        status: "pending",
        channel,
      },
      data: { status: "rejected" },
    });

    // Build conversation transcript from messages
    const transcript = lead.messages
      .map((msg) => `${msg.direction === "inbound" ? "Lead" : "Agent"}: ${msg.body}`)
      .join("\n");

    // Determine sentiment - use existing or default to "Neutral"
    const sentimentTag = lead.sentimentTag || "Neutral";

    // Check if we should generate a draft for this sentiment
    if (!shouldGenerateDraft(sentimentTag)) {
      return { success: false, error: "Cannot generate draft for this sentiment (Blacklisted)" };
    }

    // Generate new draft
    const draftResult = await generateResponseDraft(leadId, transcript, sentimentTag, channel);

    if (!draftResult.success || !draftResult.draftId || !draftResult.content) {
      return { success: false, error: draftResult.error || "Failed to generate draft" };
    }

    revalidatePath("/");

    return {
      success: true,
      data: {
        id: draftResult.draftId,
        content: draftResult.content
      }
    };
  } catch (error) {
    console.error("Failed to regenerate draft:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
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
    // Get the lead with their client (for Unipile account)
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        client: {
          select: {
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

    return {
      success: true,
      connectionStatus: connectionResult.status,
      canSendDM: connectionResult.canSendDM,
      canSendInMail: connectionResult.canSendInMail,
      hasOpenProfile: connectionResult.hasOpenProfile,
      inMailBalance,
    };
  } catch (error) {
    console.error("[checkLinkedInStatus] Failed:", error);
    return {
      ...defaultResult,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
