"use server";

import { prisma } from "@/lib/prisma";
import { sendSMS, exportMessages, type GHLExportedMessage } from "@/lib/ghl-api";
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

    if (!lead.ghlContactId) {
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

