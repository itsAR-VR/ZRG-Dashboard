import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { classifySentiment, SENTIMENT_TO_STATUS } from "@/lib/sentiment";
import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { approveAndSendDraft } from "@/actions/message-actions";

type EmailBisonWebhook = {
  data?: {
    campaign?: {
      id?: number | string;
      name?: string;
    };
    campaign_event?: {
      created_at?: string;
      type?: string;
    };
    lead?: {
      id?: number | string;
      email?: string;
      first_name?: string | null;
      last_name?: string | null;
      status?: string | null;
      company?: string | null;
    };
    reply?: {
      id?: number | string;
      uuid?: string | null;
      email_subject?: string | null;
      from_email_address?: string | null;
      from_name?: string | null;
      to?: { address: string; name: string | null }[];
      cc?: { address: string; name: string | null }[] | null;
      bcc?: { address: string; name: string | null }[] | null;
      html_body?: string | null;
      text_body?: string | null;
      date_received?: string | null;
      created_at?: string | null;
      automated_reply?: boolean | null;
    };
    sender_email?: {
      id?: number | string;
      email?: string;
      name?: string | null;
    };
  };
  event?: {
    instance_url?: string;
    workspace_id?: number | string;
    workspace_name?: string;
  };
};

function stripQuotedSections(text: string): string {
  // Remove common reply headers and quoted lines
  let result = text.split("\n").filter((line) => !line.trim().startsWith(">")).join("\n");

  const replyHeaderIndex = result.search(/On .*wrote:/i);
  if (replyHeaderIndex !== -1) {
    result = result.slice(0, replyHeaderIndex);
  }

  // Remove simple signatures starting with "--"
  const signatureIndex = result.search(/^\s*--/m);
  if (signatureIndex !== -1) {
    result = result.slice(0, signatureIndex);
  }

  return result.trim();
}

function htmlToPlain(html: string): string {
  return stripQuotedSections(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  );
}

function cleanEmailBody(htmlBody?: string | null, textBody?: string | null): { cleaned: string; rawText?: string; rawHtml?: string } {
  const rawText = textBody ?? undefined;
  const rawHtml = htmlBody ?? undefined;

  const source = textBody || htmlBody || "";
  if (!source.trim()) {
    return { cleaned: "", rawText, rawHtml };
  }

  const cleaned = textBody
    ? stripQuotedSections(textBody)
    : htmlToPlain(htmlBody || "");

  return {
    cleaned: cleaned.trim(),
    rawText,
    rawHtml,
  };
}

async function findClient(request: NextRequest, payload: EmailBisonWebhook) {
  const url = new URL(request.url);
  const clientIdParam = url.searchParams.get("clientId");

  if (clientIdParam) {
    const client = await prisma.client.findUnique({ where: { id: clientIdParam } });
    if (client) return client;
  }

  const instanceUrl = payload.event?.instance_url;
  if (instanceUrl) {
    const client = await prisma.client.findFirst({
      where: { emailBisonInstanceUrl: instanceUrl },
    });
    if (client) return client;
  }

  return null;
}

async function triggerSlackNotification(message: string) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
  } catch (error) {
    console.error("[Slack] Failed to send notification:", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload: EmailBisonWebhook = await request.json();
    const data = payload.data;

    if (!data) {
      return NextResponse.json({ error: "Missing data" }, { status: 400 });
    }

    const reply = data.reply;
    if (!reply?.id) {
      return NextResponse.json({ error: "Missing reply.id" }, { status: 400 });
    }

    const client = await findClient(request, payload);
    if (!client) {
      return NextResponse.json({ error: "Client not found for webhook" }, { status: 404 });
    }

    const emailBisonReplyId = String(reply.id);
    const existingMessage = await prisma.message.findUnique({
      where: { emailBisonReplyId },
    });

    if (existingMessage) {
      return NextResponse.json({ success: true, deduped: true });
    }

    // Upsert campaign
    let emailCampaign = null;
    if (data.campaign?.id) {
      const bisonCampaignId = String(data.campaign.id);
      emailCampaign = await prisma.emailCampaign.upsert({
        where: {
          clientId_bisonCampaignId: {
            clientId: client.id,
            bisonCampaignId,
          },
        },
        update: {
          name: data.campaign.name || "EmailBison Campaign",
        },
        create: {
          clientId: client.id,
          bisonCampaignId,
          name: data.campaign.name || "EmailBison Campaign",
        },
      });
    }

    const fromEmail = reply.from_email_address || data.lead?.email;
    if (!fromEmail) {
      return NextResponse.json({ error: "Missing from email" }, { status: 400 });
    }

    const emailBisonLeadId = data.lead?.id ? String(data.lead.id) : undefined;
    const senderAccountId = data.sender_email?.id ? String(data.sender_email.id) : undefined;

    const existingLead = await prisma.lead.findFirst({
      where: {
        clientId: client.id,
        OR: [
          emailBisonLeadId ? { emailBisonLeadId } : undefined,
          { email: fromEmail },
        ].filter(Boolean) as any,
      },
    });

    const placeholderContactId = emailBisonLeadId
      ? `emailbison-${emailBisonLeadId}`
      : `emailbison-${fromEmail.toLowerCase()}`;

    const lead = existingLead
      ? await prisma.lead.update({
        where: { id: existingLead.id },
        data: {
          firstName: data.lead?.first_name ?? existingLead.firstName ?? undefined,
          lastName: data.lead?.last_name ?? existingLead.lastName ?? undefined,
          email: fromEmail,
          status: existingLead.status,
          emailBisonLeadId,
          emailCampaignId: emailCampaign?.id ?? existingLead.emailCampaignId ?? undefined,
          senderAccountId: senderAccountId ?? existingLead.senderAccountId ?? undefined,
        },
      })
      : await prisma.lead.create({
        data: {
          ghlContactId: placeholderContactId,
          firstName: data.lead?.first_name || null,
          lastName: data.lead?.last_name || null,
          email: fromEmail,
          status: data.lead?.status || "new",
          clientId: client.id,
          emailBisonLeadId,
          emailCampaignId: emailCampaign?.id ?? null,
          senderAccountId: senderAccountId ?? null,
        },
      });

    const cleaned = cleanEmailBody(reply.html_body, reply.text_body);
    const contentForClassification = cleaned.cleaned || cleaned.rawText || cleaned.rawHtml || "";
    const sentimentTag = await classifySentiment(
      `Subject: ${reply.email_subject ?? ""}\n${contentForClassification}`
    );
    const leadStatus = SENTIMENT_TO_STATUS[sentimentTag] || lead.status || "new";

    const sentAt =
      (reply.date_received && !Number.isNaN(new Date(reply.date_received).getTime())
        ? new Date(reply.date_received)
        : reply.created_at && !Number.isNaN(new Date(reply.created_at).getTime())
          ? new Date(reply.created_at)
          : new Date());

    const ccAddresses =
      reply.cc?.map((entry) => entry.address).filter(Boolean) ?? [];
    const bccAddresses =
      reply.bcc?.map((entry) => entry.address).filter(Boolean) ?? [];

    await prisma.message.create({
      data: {
        emailBisonReplyId,
        body: cleaned.cleaned || contentForClassification,
        rawText: cleaned.rawText ?? null,
        rawHtml: cleaned.rawHtml ?? null,
        subject: reply.email_subject ?? null,
        cc: ccAddresses,
        bcc: bccAddresses,
        isRead: false,
        direction: "inbound",
        leadId: lead.id,
        sentAt,
      },
    });

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        sentimentTag,
        status: leadStatus,
      },
    });

    if (leadStatus === "meeting-booked") {
      await triggerSlackNotification(
        `Meeting booked via EmailBison for lead ${lead.email || lead.id} (client ${client.name})`
      );
    }

    // Generate AI draft if appropriate for this sentiment
    let draftId: string | undefined;
    let autoReplySent = false;
    if (shouldGenerateDraft(sentimentTag)) {
      const draftResult = await generateResponseDraft(
        lead.id,
        `Subject: ${reply.email_subject ?? ""}\n\n${contentForClassification}`,
        sentimentTag,
        "email"
      );
      if (draftResult.success) {
        draftId = draftResult.draftId;
        console.log(`[EmailBison Webhook] Generated AI draft: ${draftId}`);

        // Auto-Reply Logic: Check if enabled for this lead
        if (lead.autoReplyEnabled && draftId) {
          console.log(`[Auto-Reply Email] Auto-approving draft ${draftId} for lead ${lead.id}`);
          const sendResult = await approveAndSendDraft(draftId);
          if (sendResult.success) {
            console.log(`[Auto-Reply Email] Sent message: ${sendResult.messageId}`);
            autoReplySent = true;
          } else {
            console.error(`[Auto-Reply Email] Failed to send draft: ${sendResult.error}`);
          }
        }
      } else {
        console.error("[EmailBison Webhook] Failed to generate draft:", draftResult.error);
      }
    } else {
      console.log(`[EmailBison Webhook] Skipping AI draft for sentiment: ${sentimentTag}`);
    }

    // TODO: Auto-FollowUp feature - if lead.autoFollowUpEnabled is true, schedule follow-up tasks

    console.log("=== EmailBison Webhook Processing Complete ===");
    console.log(`Lead ID: ${lead.id}`);
    console.log(`Sentiment: ${sentimentTag}`);
    console.log(`Status: ${leadStatus}`);
    console.log(`Draft ID: ${draftId || "none"}`);
    console.log(`Auto-Reply Sent: ${autoReplySent}`);

    return NextResponse.json({
      success: true,
      leadId: lead.id,
      sentimentTag,
      status: leadStatus,
      draftId,
      autoReplySent,
    });
  } catch (error) {
    console.error("[EmailBison Webhook] Error processing payload:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "EmailBison webhook endpoint is active",
    timestamp: new Date().toISOString(),
  });
}
