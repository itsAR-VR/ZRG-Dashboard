"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import type { OutboundSentBy } from "@/lib/system-sender";
import { EmailIntegrationProvider } from "@prisma/client";
import { resolveEmailIntegrationProvider } from "@/lib/email-integration";
import { sendEmailReplySystem, type LeadForEmailSend, type SendEmailResult } from "@/lib/email-send";

/**
 * Internal wrapper for sendEmailReplySystem that adds Next.js cache invalidation.
 * Use this for server actions; use sendEmailReplySystem directly for CLI scripts.
 */
async function sendEmailReplyInternal(params: {
  lead: LeadForEmailSend;
  provider: EmailIntegrationProvider;
  messageContent: string;
  aiDraftId?: string;
  sentBy?: OutboundSentBy | null;
  sentByUserId?: string | null;
  ccOverride?: string[];
  toEmailOverride?: string;
  toNameOverride?: string | null;
}): Promise<SendEmailResult> {
  const result = await sendEmailReplySystem(params);

  // Add Next.js cache invalidation for server actions
  if (result.success) {
    revalidatePath("/");
  }

  return result;
}

/**
 * Send an email reply for an AI draft.
 * Phase 50: Added optional CC parameter for custom CC recipients.
 */
export async function sendEmailReply(
  draftId: string,
  editedContent?: string,
  opts: {
    sentBy?: OutboundSentBy | null;
    sentByUserId?: string | null;
    cc?: string[];
    toEmail?: string;
    toName?: string | null;
  } = {}
): Promise<SendEmailResult> {
  try {
    const draft = await prisma.aIDraft.findUnique({
      where: { id: draftId },
      include: {
        lead: {
          include: {
            client: {
              include: {
                emailBisonBaseHost: { select: { host: true } },
              },
            },
          },
        },
      },
    });

    if (!draft) {
      return { success: false, error: "Draft not found" };
    }

    const existingMessage = await prisma.message.findFirst({
      where: { aiDraftId: draftId },
      select: { id: true },
    });
    if (existingMessage) {
      await prisma.aIDraft
        .updateMany({ where: { id: draftId, status: "pending" }, data: { status: "approved" } })
        .catch(() => undefined);
      return { success: true, messageId: existingMessage.id };
    }

    if (draft.status !== "pending") {
      return { success: false, error: "Draft is not pending" };
    }

    if (draft.channel !== "email") {
      return { success: false, error: "Draft is not an email draft" };
    }

    const lead = draft.lead;

    if (!lead.email) {
      return { success: false, error: "Lead has no email" };
    }

    // Compliance/backstop: never send to blacklisted/opted-out leads.
    if (lead.status === "blacklisted" || lead.sentimentTag === "Blacklist") {
      await prisma.aIDraft.update({
        where: { id: draftId },
        data: { status: "rejected" },
      });
      return { success: false, error: "Lead is blacklisted (opted out)" };
    }

    const client = lead.client;
    let provider: EmailIntegrationProvider | null;
    try {
      provider = resolveEmailIntegrationProvider(client);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Invalid email integration configuration" };
    }

    if (!provider) {
      return { success: false, error: "No email provider is configured for this workspace" };
    }

    const messageContent = editedContent || draft.content;

    const sendResult = await sendEmailReplyInternal({
      lead,
      provider,
      messageContent,
      aiDraftId: draftId,
      sentBy: opts.sentBy,
      sentByUserId: opts.sentByUserId,
      ccOverride: opts.cc,
      toEmailOverride: opts.toEmail,
      toNameOverride: opts.toName ?? null,
    });

    if (!sendResult.success) {
      return sendResult;
    }

    await prisma.aIDraft.update({ where: { id: draftId }, data: { status: "approved" } });
    return sendResult;
  } catch (error) {
    console.error("[Email] Failed to send email reply:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Send a manual email reply for a lead (no AI draft required).
 *
 * Security note: this function does NOT enforce workspace/user access checks.
 * Callers invoked from the client/UI must verify lead access before calling.
 */
export async function sendEmailReplyForLead(
  leadId: string,
  messageContent: string,
  opts: {
    sentBy?: OutboundSentBy | null;
    sentByUserId?: string | null;
    cc?: string[];
    toEmail?: string;
    toName?: string | null;
  } = {}
): Promise<SendEmailResult> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        client: {
          include: {
            emailBisonBaseHost: { select: { host: true } },
          },
        },
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    if (!lead.email) {
      return { success: false, error: "Lead has no email" };
    }

    // Compliance/backstop: never send to blacklisted/opted-out leads.
    if (lead.status === "blacklisted" || lead.sentimentTag === "Blacklist") {
      return { success: false, error: "Lead is blacklisted (opted out)" };
    }

    const client = lead.client;
    let provider: EmailIntegrationProvider | null;
    try {
      provider = resolveEmailIntegrationProvider(client);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Invalid email integration configuration" };
    }

    if (!provider) {
      return { success: false, error: "No email provider is configured for this workspace" };
    }
    return await sendEmailReplyInternal({
      lead,
      provider,
      messageContent,
      sentBy: opts.sentBy,
      sentByUserId: opts.sentByUserId,
      ccOverride: opts.cc,
      toEmailOverride: opts.toEmail,
      toNameOverride: opts.toName ?? null,
    });
  } catch (error) {
    console.error("[Email] Failed to send manual email reply:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
