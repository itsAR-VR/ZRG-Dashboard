"use server";

import { prisma } from "@/lib/prisma";
import { sendSMS, exportMessages, type GHLExportedMessage } from "@/lib/ghl-api";
import { fetchEmailBisonReplies, fetchEmailBisonSentEmails } from "@/lib/emailbison-api";
import { revalidatePath } from "next/cache";
import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { classifySentiment, SENTIMENT_TO_STATUS } from "@/lib/sentiment";
import { sendEmailReply } from "@/actions/email-actions";

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
  error?: string;
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
 */
export async function smartSyncConversation(leadId: string): Promise<SyncHistoryResult> {
  // First get the lead's sync capabilities
  const syncInfo = await getLeadSyncInfo(leadId);
  
  if (!syncInfo.success || !syncInfo.data) {
    return { success: false, error: syncInfo.error || "Failed to get lead sync info" };
  }

  const { canSyncSms, canSyncEmail, hasEmailMessages, hasSmsMessages, emailBisonLeadId, ghlContactId } = syncInfo.data;

  // If neither sync is available, return appropriate error
  if (!canSyncSms && !canSyncEmail) {
    if (hasEmailMessages && !emailBisonLeadId) {
      return { 
        success: false, 
        error: "This lead's emails cannot be synced (no EmailBison lead ID - may be from a bounce notification)" 
      };
    }
    if (hasSmsMessages && !ghlContactId) {
      return { 
        success: false, 
        error: "This lead's SMS messages cannot be synced (no GHL contact ID)" 
      };
    }
    return { 
      success: false, 
      error: "No sync method available for this lead (missing external IDs or credentials)" 
    };
  }

  let totalImported = 0;
  let totalHealed = 0;
  let totalMessages = 0;
  let totalSkipped = 0;
  const errors: string[] = [];

  // Sync SMS if available
  if (canSyncSms) {
    const smsResult = await syncConversationHistory(leadId);
    if (smsResult.success) {
      totalImported += smsResult.importedCount || 0;
      totalHealed += smsResult.healedCount || 0;
      totalMessages += smsResult.totalMessages || 0;
      totalSkipped += smsResult.skippedDuplicates || 0;
    } else if (smsResult.error) {
      errors.push(`SMS: ${smsResult.error}`);
    }
  }

  // Sync Email if available
  if (canSyncEmail) {
    const emailResult = await syncEmailConversationHistory(leadId);
    if (emailResult.success) {
      totalImported += emailResult.importedCount || 0;
      totalHealed += emailResult.healedCount || 0;
      totalMessages += emailResult.totalMessages || 0;
      totalSkipped += emailResult.skippedDuplicates || 0;
    } else if (emailResult.error) {
      errors.push(`Email: ${emailResult.error}`);
    }
  }

  // If all attempted syncs failed, return error
  if (errors.length > 0 && totalImported === 0 && totalHealed === 0) {
    return { success: false, error: errors.join("; ") };
  }

  return {
    success: true,
    importedCount: totalImported,
    healedCount: totalHealed,
    totalMessages,
    skippedDuplicates: totalSkipped,
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
 */
export async function syncConversationHistory(leadId: string): Promise<SyncHistoryResult> {
  try {
    // Get the lead with their client info and SMS message count
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        client: {
          select: {
            ghlPrivateKey: true,
            ghlLocationId: true,
          },
        },
        _count: {
          select: {
            messages: {
              where: { 
                OR: [
                  { channel: "sms" },
                  { channel: null },
                ],
              },
            },
          },
        },
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    if (!lead.ghlContactId) {
      // Provide more helpful error message based on context
      const hasSmsMessages = lead._count.messages > 0;
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

    // Re-run sentiment analysis using the refreshed conversation transcript
    try {
      const messages = await prisma.message.findMany({
        where: { leadId },
        orderBy: { sentAt: "asc" },
      });

      const transcript = messages
        .map((m) => `${m.direction === "inbound" ? "Lead" : "Agent"}: ${m.body}`)
        .join("\n");

      if (transcript.trim().length > 0) {
        const refreshedSentiment = await classifySentiment(transcript);
        const refreshedStatus = SENTIMENT_TO_STATUS[refreshedSentiment] || "new";

        await prisma.lead.update({
          where: { id: leadId },
          data: {
            sentimentTag: refreshedSentiment,
            status: refreshedStatus,
          },
        });

        console.log(`[Sync] Reclassified sentiment to ${refreshedSentiment} and status to ${refreshedStatus}`);
      }
    } catch (reclassError) {
      console.error("[Sync] Failed to refresh sentiment after sync:", reclassError);
    }

    revalidatePath("/");

    return {
      success: true,
      importedCount,
      healedCount,
      totalMessages: ghlMessages.length,
      skippedDuplicates,
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
  errors: number;
  error?: string;
}

/**
 * Sync all SMS conversations for a workspace (client)
 * Iterates through all leads with GHL contact IDs and syncs their history
 * Also regenerates AI drafts for eligible leads (non-blacklisted)
 * 
 * @param clientId - The workspace/client ID to sync
 */
export async function syncAllConversations(clientId: string): Promise<SyncAllResult> {
  try {
    // Get all leads for this client that have GHL contact IDs (SMS capable)
    const leads = await prisma.lead.findMany({
      where: {
        clientId,
        ghlContactId: {
          not: null,
        },
        // Exclude email-only leads (those created from EmailBison)
        NOT: {
          ghlContactId: { startsWith: "emailbison-" },
        },
      },
      select: {
        id: true,
        ghlContactId: true,
      },
    });

    console.log(`[SyncAll] Starting sync for ${leads.length} SMS leads in client ${clientId}`);

    let totalImported = 0;
    let totalHealed = 0;
    let totalDraftsGenerated = 0;
    let errors = 0;

    // Process leads in parallel with a concurrency limit
    const BATCH_SIZE = 5; // Process 5 at a time to avoid overwhelming GHL API

    for (let i = 0; i < leads.length; i += BATCH_SIZE) {
      const batch = leads.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(lead => syncConversationHistory(lead.id))
      );

      // Process sync results and generate drafts for eligible leads
      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const leadId = batch[j].id;

        if (result.status === "fulfilled" && result.value.success) {
          totalImported += result.value.importedCount || 0;
          totalHealed += result.value.healedCount || 0;

          // After successful sync, regenerate AI draft if eligible
          try {
            // Fetch the lead's current sentiment after sync (sentiment was reclassified during sync)
            const lead = await prisma.lead.findUnique({
              where: { id: leadId },
              select: { sentimentTag: true, status: true },
            });

            // Only generate draft if not blacklisted
            if (lead && shouldGenerateDraft(lead.sentimentTag || "Neutral")) {
              const draftResult = await regenerateDraft(leadId, "sms");
              if (draftResult.success) {
                totalDraftsGenerated++;
                console.log(`[SyncAll] Generated draft for lead ${leadId}`);
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

    console.log(`[SyncAll] Complete: ${totalImported} imported, ${totalHealed} healed, ${totalDraftsGenerated} drafts, ${errors} errors`);

    revalidatePath("/");

    return {
      success: true,
      totalLeads: leads.length,
      totalImported,
      totalHealed,
      totalDraftsGenerated,
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
 */
export async function syncEmailConversationHistory(leadId: string): Promise<SyncHistoryResult> {
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

    // Re-run sentiment analysis using the refreshed conversation transcript
    try {
      const messages = await prisma.message.findMany({
        where: { leadId, channel: "email" },
        orderBy: { sentAt: "asc" },
      });

      const transcript = messages
        .map((m) => `${m.direction === "inbound" ? "Lead" : "Agent"}: ${m.body}`)
        .join("\n");

      if (transcript.trim().length > 0) {
        const refreshedSentiment = await classifySentiment(transcript);
        const refreshedStatus = SENTIMENT_TO_STATUS[refreshedSentiment] || "new";

        await prisma.lead.update({
          where: { id: leadId },
          data: {
            sentimentTag: refreshedSentiment,
            status: refreshedStatus,
          },
        });

        console.log(`[EmailSync] Reclassified sentiment to ${refreshedSentiment}`);
      }
    } catch (reclassError) {
      console.error("[EmailSync] Failed to refresh sentiment after sync:", reclassError);
    }

    revalidatePath("/");

    return {
      success: true,
      importedCount,
      healedCount,
      totalMessages: replies.length + sentEmails.length,
      skippedDuplicates,
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

    const messageContent = editedContent || draft.content;

    // Send the message
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

