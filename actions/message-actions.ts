"use server";

import { prisma } from "@/lib/prisma";
import { sendSMS, exportMessages, type GHLExportedMessage } from "@/lib/ghl-api";
import { revalidatePath } from "next/cache";
import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";

interface SendMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface SyncHistoryResult {
  success: boolean;
  importedCount?: number;
  totalMessages?: number;
  error?: string;
}

/**
 * Sync conversation history from GHL for a lead
 * Fetches all messages from GHL and imports any that are missing
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

    // Import messages that don't exist yet
    let importedCount = 0;
    for (const msg of ghlMessages) {
      try {
        // Check if message already exists
        const existingMessage = await prisma.message.findFirst({
          where: {
            leadId,
            body: msg.body,
            createdAt: new Date(msg.dateAdded),
          },
        });

        if (!existingMessage) {
          await prisma.message.create({
            data: {
              body: msg.body,
              direction: msg.direction,
              leadId,
              createdAt: new Date(msg.dateAdded),
            },
          });
          importedCount++;
        }
      } catch (error) {
        // Ignore duplicate errors
        if (!(error instanceof Error && error.message.includes("Unique"))) {
          console.error(`[Sync] Error importing message: ${error}`);
        }
      }
    }

    console.log(`[Sync] Imported ${importedCount} new messages`);

    revalidatePath("/");

    return {
      success: true,
      importedCount,
      totalMessages: ghlMessages.length,
    };
  } catch (error) {
    console.error("[Sync] Failed to sync conversation history:", error);
    return {
      success: false,
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

    // Save the outbound message to our database
    const savedMessage = await prisma.message.create({
      data: {
        body: message,
        direction: "outbound",
        leadId: lead.id,
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
export async function getPendingDrafts(leadId: string) {
  try {
    console.log("[getPendingDrafts] Fetching drafts for leadId:", leadId);
    
    const drafts = await prisma.aIDraft.findMany({
      where: {
        leadId,
        status: "pending",
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
export async function regenerateDraft(leadId: string): Promise<{ 
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
          orderBy: { createdAt: "asc" },
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
    const draftResult = await generateResponseDraft(leadId, transcript, sentimentTag);

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

