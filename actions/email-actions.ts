"use server";

import { prisma } from "@/lib/prisma";
import { sendEmailBisonReply } from "@/lib/emailbison-api";
import { revalidatePath } from "next/cache";
import { syncEmailConversationHistory } from "@/actions/message-actions";

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
    if (!client.emailBisonApiKey) {
      return { success: false, error: "Client missing EmailBison API key" };
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

    // Convert plain text newlines to HTML <br> tags for proper email formatting
    const htmlMessage = messageContent
      .replace(/\n\n/g, '</p><p>')  // Double newlines become paragraph breaks
      .replace(/\n/g, '<br>')       // Single newlines become line breaks
      .replace(/^/, '<p>')          // Wrap in paragraph tags
      .replace(/$/, '</p>');

    // Construct to_emails array (required by EmailBison API)
    const toEmails = lead.email
      ? [{ name: lead.firstName || null, email_address: lead.email }]
      : [];

    // Convert CC/BCC string arrays to EmailBisonRecipient format
    const ccEmails = latestInboundEmail?.cc?.map(address => ({ name: null, email_address: address })) || [];
    const bccEmails = latestInboundEmail?.bcc?.map(address => ({ name: null, email_address: address })) || [];

    // Call sendEmailBisonReply with correct 3 parameters: (apiKey, replyId, payload)
    const sendResult = await sendEmailBisonReply(
      client.emailBisonApiKey,
      replyId,
      {
        message: htmlMessage,
        sender_email_id: parseInt(lead.senderAccountId), // Must be number
        to_emails: toEmails, // Required field
        subject: subject || undefined,
        cc_emails: ccEmails, // Correct field name
        bcc_emails: bccEmails, // Correct field name
        inject_previous_email_body: true,
        content_type: "html", // Send as HTML to preserve formatting
      }
    );

    if (!sendResult.success) {
      return { success: false, error: sendResult.error || "Failed to send email reply" };
    }

    const message = await prisma.message.create({
      data: {
        body: messageContent,
        subject,
        channel: "email",
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

    // Trigger background sync to ensure thread consistency
    // This runs async and doesn't block the response
    syncEmailConversationHistory(lead.id).catch((err) => {
      console.error("[Email] Background sync failed:", err);
    });

    return { success: true, messageId: message.id };
  } catch (error) {
    console.error("[Email] Failed to send email reply:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
