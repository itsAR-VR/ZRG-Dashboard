"use server";

import { prisma } from "@/lib/prisma";
import { sendEmailBisonReply } from "@/lib/emailbison-api";
import { revalidatePath } from "next/cache";

interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

async function validateWithEmailGuard(email: string) {
  const url = "https://app.emailguard.io/api/v1/email-host-lookup";
  const apiKey = process.env.EMAIL_GUARD_API_KEY;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      return { valid: false, reason: `EmailGuard failed (${response.status})` };
    }

    const body = (await response.json()) as any;
    const host = body?.data?.email_host || body?.email_host;

    if (!host) {
      return { valid: false, reason: "EmailGuard returned no host" };
    }

    return { valid: true, host };
  } catch (error) {
    console.error("[EmailGuard] Validation error:", error);
    return { valid: false, reason: "EmailGuard request error" };
  }
}

export async function sendEmailReply(
  draftId: string,
  editedContent?: string
): Promise<SendEmailResult> {
  try {
    const draft = await prisma.aIDraft.findUnique({
      where: { id: draftId },
      include: {
        lead: {
          include: {
            client: true,
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

    if (draft.channel !== "email") {
      return { success: false, error: "Draft is not an email draft" };
    }

    const lead = draft.lead;

    if (!lead.email) {
      return { success: false, error: "Lead has no email" };
    }

    if (!lead.senderAccountId) {
      return { success: false, error: "Lead is missing sender account for EmailBison" };
    }

    const client = lead.client;
    if (!client.emailBisonApiKey || !client.emailBisonInstanceUrl) {
      return { success: false, error: "Client missing EmailBison credentials" };
    }

    // Validate recipient via EmailGuard
    const guardResult = await validateWithEmailGuard(lead.email);
    if (!guardResult.valid) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: "blacklisted",
          sentimentTag: "Blacklist",
        },
      });

      return { success: false, error: `Email validation failed: ${guardResult.reason}` };
    }

    // Find the latest inbound email to reply to (thread)
    const latestInboundEmail = await prisma.message.findFirst({
      where: {
        leadId: lead.id,
        direction: "inbound",
        emailBisonReplyId: { not: null },
      },
      orderBy: { sentAt: "desc" },
    });

    const replyId = latestInboundEmail?.emailBisonReplyId;
    if (!replyId) {
      return { success: false, error: "No inbound email thread to reply to" };
    }

    const messageContent = editedContent || draft.content;
    const subject = latestInboundEmail?.subject || null;

    const sendResult = await sendEmailBisonReply(
      client.emailBisonInstanceUrl,
      client.emailBisonApiKey,
      replyId,
      {
        message: messageContent,
        sender_email_id: lead.senderAccountId,
        subject: subject || undefined,
        cc: latestInboundEmail?.cc || [],
        bcc: latestInboundEmail?.bcc || [],
      }
    );

    if (!sendResult.success) {
      return { success: false, error: sendResult.error || "Failed to send email reply" };
    }

    const message = await prisma.message.create({
      data: {
        body: messageContent,
        subject,
        cc: latestInboundEmail?.cc || [],
        bcc: latestInboundEmail?.bcc || [],
        direction: "outbound",
        leadId: lead.id,
        sentAt: new Date(),
      },
    });

    await prisma.aIDraft.update({
      where: { id: draftId },
      data: { status: "approved" },
    });

    // Note: Lead status is determined by sentiment classification, not by sending a reply
    // This matches the SMS flow behavior in approveAndSendDraft

    revalidatePath("/");

    return { success: true, messageId: message.id };
  } catch (error) {
    console.error("[Email] Failed to send email reply:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
