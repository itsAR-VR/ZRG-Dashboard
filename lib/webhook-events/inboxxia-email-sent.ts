import "server-only";

import { prisma, isPrismaUniqueConstraintError } from "@/lib/prisma";
import { autoStartNoResponseSequenceOnOutbound } from "@/lib/followup-automation";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { findOrCreateLead } from "@/lib/lead-matching";

export type InboxxiaEmailSentWebhookEvent = {
  id: string;
  workspaceId: string | null;
  campaignId: string | null;
  campaignName: string | null;
  emailBisonLeadId: string | null;
  leadEmail: string | null;
  leadFirstName: string | null;
  leadLastName: string | null;
  senderEmailId: string | null;
  senderEmail: string | null;
  senderName: string | null;
  scheduledEmailId: string | null;
  emailSubject: string | null;
  emailBodyHtml: string | null;
  emailSentAt: Date | null;
};

/**
 * Process an Inboxxia EMAIL_SENT webhook event from the durable `WebhookEvent` queue.
 *
 * Idempotency:
 * - If the outbound Message already exists, we still (re)apply rollups and (re)start follow-ups
 *   because those side effects are idempotent and may have failed on a prior attempt.
 */
export async function processInboxxiaEmailSentWebhookEvent(
  event: InboxxiaEmailSentWebhookEvent
): Promise<void> {
  const scheduledEmailId = (event.scheduledEmailId || "").trim();
  if (!scheduledEmailId) throw new Error("missing_scheduled_email_id");

  // If the message already exists, ensure the remaining side effects are applied.
  const existingMessage = await prisma.message.findUnique({
    where: { inboxxiaScheduledEmailId: scheduledEmailId },
    select: { id: true, leadId: true, sentAt: true },
  });

  if (existingMessage) {
    await bumpLeadMessageRollup({
      leadId: existingMessage.leadId,
      direction: "outbound",
      sentAt: existingMessage.sentAt,
    });
    await autoStartNoResponseSequenceOnOutbound({
      leadId: existingMessage.leadId,
      outboundAt: existingMessage.sentAt,
    });
    return;
  }

  const workspaceId = (event.workspaceId || "").trim();
  if (!workspaceId) throw new Error("missing_workspace_id");

  const leadEmail = (event.leadEmail || "").trim();
  if (!leadEmail) throw new Error("missing_lead_email");

  const client = await prisma.client.findUnique({
    where: { emailBisonWorkspaceId: workspaceId },
    select: { id: true },
  });
  if (!client) throw new Error(`client_not_found workspace_id=${workspaceId}`);

  const bisonCampaignId = (event.campaignId || "").trim();
  const emailCampaign = bisonCampaignId
    ? await prisma.emailCampaign.upsert({
        where: { clientId_bisonCampaignId: { clientId: client.id, bisonCampaignId } },
        update: { name: event.campaignName || "Inboxxia Campaign" },
        create: { clientId: client.id, bisonCampaignId, name: event.campaignName || "Inboxxia Campaign" },
      })
    : null;

  const emailBisonLeadId = (event.emailBisonLeadId || "").trim();
  const senderAccountId = (event.senderEmailId || "").trim() || null;

  const leadResult = await findOrCreateLead(
    client.id,
    {
      email: leadEmail,
      firstName: event.leadFirstName || null,
      lastName: event.leadLastName || null,
    },
    emailBisonLeadId ? { emailBisonLeadId } : undefined,
    { emailCampaignId: emailCampaign?.id ?? null, senderAccountId }
  );

  const lead = leadResult.lead;

  const sentAt = event.emailSentAt ?? new Date();

  try {
    await prisma.message.create({
      data: {
        inboxxiaScheduledEmailId: scheduledEmailId,
        channel: "email",
        source: "inboxxia_campaign",
        body: event.emailBodyHtml || "",
        rawHtml: event.emailBodyHtml ?? null,
        subject: event.emailSubject ?? null,
        fromEmail: event.senderEmail ?? null,
        fromName: event.senderName ?? null,
        toEmail: lead.email ?? leadEmail,
        toName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || null,
        isRead: true,
        direction: "outbound",
        leadId: lead.id,
        sentAt,
      },
    });
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) throw error;

    const existing = await prisma.message.findUnique({
      where: { inboxxiaScheduledEmailId: scheduledEmailId },
      select: { leadId: true, sentAt: true },
    });
    if (!existing) throw error;

    await bumpLeadMessageRollup({ leadId: existing.leadId, direction: "outbound", sentAt: existing.sentAt });
    await autoStartNoResponseSequenceOnOutbound({ leadId: existing.leadId, outboundAt: existing.sentAt });
    return;
  }

  await bumpLeadMessageRollup({ leadId: lead.id, direction: "outbound", sentAt });
  await autoStartNoResponseSequenceOnOutbound({ leadId: lead.id, outboundAt: sentAt });
}
