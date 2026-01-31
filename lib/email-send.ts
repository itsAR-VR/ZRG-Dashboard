/**
 * System-level email send logic (no Next.js request context required).
 *
 * This module contains the core email sending logic extracted from actions/email-actions.ts.
 * It does NOT call revalidatePath() so it can be safely used from CLI scripts and background jobs.
 *
 * For server actions that need cache invalidation, use the wrapper functions in actions/email-actions.ts.
 */

import { prisma } from "@/lib/prisma";
import { sendEmailBisonReply } from "@/lib/emailbison-api";
import { sendSmartLeadReplyToThread } from "@/lib/smartlead-api";
import { sendInstantlyReply } from "@/lib/instantly-api";
import { syncEmailConversationHistorySystem } from "@/lib/conversation-sync";
import {
  autoStartNoResponseSequenceOnOutbound,
  autoStartMeetingRequestedSequenceOnSetterEmailReply,
} from "@/lib/followup-automation";
import { isOptOutText } from "@/lib/sentiment";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { emailBisonHtmlFromPlainText } from "@/lib/email-format";
import type { OutboundSentBy } from "@/lib/system-sender";
import { refreshSenderEmailSnapshotsDue } from "@/lib/reactivation-engine";
import { EmailIntegrationProvider } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { decodeInstantlyReplyHandle, decodeSmartLeadReplyHandle } from "@/lib/email-reply-handle";
import { recordOutboundForBookingProgress } from "@/lib/booking-progress";
import {
  applyOutboundToOverride,
  computeLeadCurrentReplierUpdate,
  emailsMatch,
  normalizeOptionalEmail,
  sanitizeCcList,
  validateEmail,
} from "@/lib/email-participants";
import { resolveEmailIntegrationProvider } from "@/lib/email-integration";

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

function parseSenderEmailId(value: string | null | undefined): number | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isInvalidSenderEmailIdErrorText(errorText: string): boolean {
  const lower = (errorText || "").toLowerCase();
  return lower.includes("sender email id") && lower.includes("invalid");
}

function resolveOutboundCc(params: {
  leadId: string;
  ccOverride?: string[];
  inheritedCc?: string[] | null;
}): { cc: string[]; invalid: string[]; overrideProvided: boolean } {
  const overrideProvided = Array.isArray(params.ccOverride);
  const rawCc = overrideProvided ? (params.ccOverride ?? []) : (params.inheritedCc ?? []);
  const { valid, invalid } = sanitizeCcList(rawCc);

  if (!overrideProvided && invalid.length > 0) {
    console.warn("[Email] Dropping invalid CC addresses from inbound thread", {
      leadId: params.leadId,
      invalid: invalid.slice(0, 8),
      invalidCount: invalid.length,
    });
  }

  return { cc: valid, invalid, overrideProvided };
}

function resolveOutboundRecipients(params: {
  lead: {
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    currentReplierEmail?: string | null;
    currentReplierName?: string | null;
  };
  latestInboundEmail: { fromEmail: string | null; fromName: string | null; cc: string[] } | null;
  ccResolution: { cc: string[] };
}): { toEmail: string; toName: string | null; cc: string[] } {
  const leadPrimaryEmail = normalizeOptionalEmail(params.lead.email);
  if (!leadPrimaryEmail) {
    throw new Error("Lead has no email address");
  }

  const leadCurrentReplier = normalizeOptionalEmail(params.lead.currentReplierEmail);
  const inboundFromEmail = normalizeOptionalEmail(params.latestInboundEmail?.fromEmail);

  const replierEmail =
    leadCurrentReplier && !emailsMatch(leadCurrentReplier, leadPrimaryEmail)
      ? leadCurrentReplier
      : inboundFromEmail && !emailsMatch(inboundFromEmail, leadPrimaryEmail)
        ? inboundFromEmail
        : null;

  const toEmail = replierEmail || leadPrimaryEmail;
  const toName = replierEmail
    ? params.lead.currentReplierName || params.latestInboundEmail?.fromName || null
    : [params.lead.firstName, params.lead.lastName].filter(Boolean).join(" ") || null;

  let cc = (params.ccResolution.cc || []).filter((address) => !emailsMatch(address, toEmail));

  if (replierEmail && !emailsMatch(leadPrimaryEmail, toEmail)) {
    if (!cc.some((address) => emailsMatch(address, leadPrimaryEmail))) {
      cc = [leadPrimaryEmail, ...cc];
    }
  } else {
    cc = cc.filter((address) => !emailsMatch(address, leadPrimaryEmail));
  }

  return { toEmail, toName, cc };
}

async function pickSendableSenderEmailId(opts: {
  clientId: string;
  preferredSenderEmailId: string | null;
  refreshIfStale: boolean;
}): Promise<{ senderEmailId: string | null; reason?: string }> {
  if (opts.refreshIfStale) {
    await refreshSenderEmailSnapshotsDue({ clientId: opts.clientId, ttlMinutes: 0, limitClients: 1 }).catch(() => undefined);
  }

  if (opts.preferredSenderEmailId) {
    const preferred = await prisma.emailBisonSenderEmailSnapshot.findUnique({
      where: {
        clientId_senderEmailId: { clientId: opts.clientId, senderEmailId: opts.preferredSenderEmailId },
      },
      select: { senderEmailId: true, isSendable: true },
    });
    if (preferred?.isSendable) return { senderEmailId: preferred.senderEmailId };
  }

  const fallback = await prisma.emailBisonSenderEmailSnapshot.findFirst({
    where: { clientId: opts.clientId, isSendable: true },
    select: { senderEmailId: true },
    orderBy: { senderEmailId: "asc" },
  });

  if (!fallback?.senderEmailId) return { senderEmailId: null, reason: "no_sendable_senders" };
  return { senderEmailId: fallback.senderEmailId, reason: "fallback_sender" };
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

export type LeadForEmailSend = Prisma.LeadGetPayload<{
  include: {
    client: {
      include: {
        emailBisonBaseHost: { select: { host: true } };
      };
    };
  };
}>;

/**
 * System-level email reply sender.
 *
 * This function contains the core email sending logic without any Next.js-specific
 * calls like revalidatePath(). Safe to use from CLI scripts and background jobs.
 *
 * For server actions, use sendEmailReplyInternal in actions/email-actions.ts which
 * wraps this function and adds cache invalidation.
 */
export async function sendEmailReplySystem(params: {
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
  const lead = params.lead;
  const client = lead.client;
  const provider = params.provider;

  if (!lead.email) {
    return { success: false, error: "Lead has no email" };
  }

  const latestInboundEmail = await prisma.message.findFirst({
    where: {
      leadId: lead.id,
      direction: "inbound",
      ...(provider === EmailIntegrationProvider.SMARTLEAD
        ? { emailBisonReplyId: { startsWith: "smartlead:" } }
        : provider === EmailIntegrationProvider.INSTANTLY
          ? { emailBisonReplyId: { startsWith: "instantly:" } }
          : {
              emailBisonReplyId: { not: null },
              NOT: [
                { emailBisonReplyId: { startsWith: "smartlead:" } },
                { emailBisonReplyId: { startsWith: "instantly:" } },
              ],
            }),
    },
    orderBy: { sentAt: "desc" },
  });

  const replyKey = latestInboundEmail?.emailBisonReplyId;
  if (!replyKey) {
    return { success: false, error: "No inbound email thread to reply to" };
  }

  const ccResolution = resolveOutboundCc({
    leadId: lead.id,
    ccOverride: params.ccOverride,
    inheritedCc: latestInboundEmail?.cc,
  });

  if (ccResolution.overrideProvided && ccResolution.invalid.length > 0) {
    return {
      success: false,
      error: `Invalid CC email(s): ${ccResolution.invalid.slice(0, 4).join(", ")}${ccResolution.invalid.length > 4 ? "…" : ""}`,
    };
  }

  // Compliance/backstop: refuse to reply if the latest inbound email contains an opt-out request.
  const latestInboundText = `Subject: ${latestInboundEmail.subject || ""} | ${latestInboundEmail.body || ""}`;
  if (isOptOutText(latestInboundText)) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        status: "blacklisted",
        sentimentTag: "Blacklist",
      },
    });
    await prisma.lead.updateMany({
      where: { id: lead.id, enrichmentStatus: "pending" },
      data: { enrichmentStatus: "not_needed" },
    });

    await prisma.aIDraft.updateMany({
      where: {
        leadId: lead.id,
        status: "pending",
      },
      data: { status: "rejected" },
    });

    return { success: false, error: "Lead requested unsubscribe (opt-out)" };
  }

  const recipients = resolveOutboundRecipients({
    lead,
    latestInboundEmail: latestInboundEmail
      ? {
          fromEmail: latestInboundEmail.fromEmail ?? null,
          fromName: latestInboundEmail.fromName ?? null,
          cc: latestInboundEmail.cc ?? [],
        }
      : null,
    ccResolution,
  });

  const rawToOverride = typeof params.toEmailOverride === "string" ? params.toEmailOverride.trim() : "";
  if (rawToOverride && !validateEmail(rawToOverride)) {
    return { success: false, error: `Invalid To email: ${rawToOverride}` };
  }

  // Instantly reply API does not support overriding the To recipient.
  const allowToOverride = provider !== EmailIntegrationProvider.INSTANTLY;

  const recipientsWithOverride = applyOutboundToOverride({
    primaryEmail: lead.email,
    baseToEmail: recipients.toEmail,
    baseToName: recipients.toName,
    baseCc: recipients.cc,
    overrideToEmail: allowToOverride ? rawToOverride || undefined : undefined,
    overrideToName: allowToOverride ? (params.toNameOverride ?? null) : null,
  });

  let emailGuardTarget = recipientsWithOverride.toEmail;
  let smartLeadHandle: ReturnType<typeof decodeSmartLeadReplyHandle> = null;
  if (provider === EmailIntegrationProvider.SMARTLEAD) {
    smartLeadHandle = decodeSmartLeadReplyHandle(replyKey);
    if (!smartLeadHandle) {
      return { success: false, error: "SmartLead thread handle is invalid or missing" };
    }
    emailGuardTarget = recipientsWithOverride.overrideApplied
      ? recipientsWithOverride.toEmail
      : smartLeadHandle.toEmail || recipientsWithOverride.toEmail;
  }

  let instantlyHandle: ReturnType<typeof decodeInstantlyReplyHandle> = null;
  if (provider === EmailIntegrationProvider.INSTANTLY) {
    instantlyHandle = decodeInstantlyReplyHandle(replyKey);
    if (!instantlyHandle) {
      return { success: false, error: "Instantly thread handle is invalid or missing" };
    }
  }

  const guardResult = await validateWithEmailGuard(emailGuardTarget);
  if (!guardResult.valid) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        status: "blacklisted",
        sentimentTag: "Blacklist",
      },
    });
    await prisma.lead.updateMany({
      where: { id: lead.id, enrichmentStatus: "pending" },
      data: { enrichmentStatus: "not_needed" },
    });

    return { success: false, error: `Email validation failed: ${guardResult.reason}` };
  }

  const subject = latestInboundEmail?.subject || null;

  if (provider === EmailIntegrationProvider.EMAILBISON) {
    if (!lead.senderAccountId) {
      return { success: false, error: "Lead is missing sender account for EmailBison" };
    }
    if (!client.emailBisonApiKey) {
      return { success: false, error: "Client missing EmailBison API key" };
    }

    const htmlMessage = emailBisonHtmlFromPlainText(params.messageContent);

    const toEmails = [{ name: recipientsWithOverride.toName, email_address: recipientsWithOverride.toEmail }];

    const ccEmails = recipientsWithOverride.cc.map((address) => ({ name: null, email_address: address }));
    const bccEmails = latestInboundEmail?.bcc?.map((address) => ({ name: null, email_address: address })) || [];

    let senderEmailId = lead.senderAccountId;

    const senderEmailIdNum = parseSenderEmailId(senderEmailId);
    if (!senderEmailIdNum) {
      const picked = await pickSendableSenderEmailId({
        clientId: client.id,
        preferredSenderEmailId: senderEmailId,
        refreshIfStale: true,
      });
      const pickedSenderEmailId = picked.senderEmailId;
      if (!pickedSenderEmailId) {
        return { success: false, error: "No sendable EmailBison sender account is configured for this workspace" };
      }
      senderEmailId = pickedSenderEmailId;
      await prisma.lead.update({ where: { id: lead.id }, data: { senderAccountId: senderEmailId } }).catch(() => undefined);
    } else {
      const preferred = await prisma.emailBisonSenderEmailSnapshot
        .findUnique({
          where: { clientId_senderEmailId: { clientId: client.id, senderEmailId } },
          select: { isSendable: true },
        })
        .catch(() => null);

      if (preferred && preferred.isSendable === false) {
        const picked = await pickSendableSenderEmailId({
          clientId: client.id,
          preferredSenderEmailId: null,
          refreshIfStale: false,
        });
        if (picked.senderEmailId) {
          senderEmailId = picked.senderEmailId;
          await prisma.lead.update({ where: { id: lead.id }, data: { senderAccountId: senderEmailId } }).catch(() => undefined);
        }
      }
    }

    const buildPayload = (sender: string) => ({
      message: htmlMessage,
      sender_email_id: parseSenderEmailId(sender)!, // validated above
      to_emails: toEmails,
      subject: subject || undefined,
      cc_emails: ccEmails,
      bcc_emails: bccEmails,
      inject_previous_email_body: true,
      content_type: "html" as const,
    });

    let sendResult = await sendEmailBisonReply(
      client.emailBisonApiKey,
      replyKey,
      buildPayload(senderEmailId),
      { baseHost: client.emailBisonBaseHost?.host ?? null }
    );

    if (!sendResult.success && isInvalidSenderEmailIdErrorText(sendResult.error || "")) {
      await prisma.emailBisonSenderEmailSnapshot
        .updateMany({
          where: { clientId: client.id, senderEmailId },
          data: { isSendable: false, status: "invalid_sender_email_id", fetchedAt: new Date() },
        })
        .catch(() => undefined);

      const picked = await pickSendableSenderEmailId({
        clientId: client.id,
        preferredSenderEmailId: null,
        refreshIfStale: true,
      });
      if (picked.senderEmailId && picked.senderEmailId !== senderEmailId) {
        senderEmailId = picked.senderEmailId;
        await prisma.lead.update({ where: { id: lead.id }, data: { senderAccountId: senderEmailId } }).catch(() => undefined);
        sendResult = await sendEmailBisonReply(
          client.emailBisonApiKey,
          replyKey,
          buildPayload(senderEmailId),
          { baseHost: client.emailBisonBaseHost?.host ?? null }
        );
      }
    }

    if (!sendResult.success) {
      return { success: false, error: sendResult.error || "Failed to send email reply" };
    }
  } else if (provider === EmailIntegrationProvider.SMARTLEAD) {
    if (!client.smartLeadApiKey) {
      return { success: false, error: "Client missing SmartLead API key" };
    }
    if (!smartLeadHandle) {
      return { success: false, error: "SmartLead thread handle is invalid or missing" };
    }

    const cc = recipientsWithOverride.cc;
    const bcc = (latestInboundEmail?.bcc || []).filter(Boolean);
    const smartLeadToEmail = recipientsWithOverride.overrideApplied
      ? recipientsWithOverride.toEmail
      : smartLeadHandle.toEmail || recipientsWithOverride.toEmail;

    const sendResult = await sendSmartLeadReplyToThread(client.smartLeadApiKey, {
      campaignId: smartLeadHandle.campaignId,
      statsId: smartLeadHandle.statsId,
      messageId: smartLeadHandle.messageId,
      subject,
      body: params.messageContent,
      cc,
      bcc,
      toEmail: smartLeadToEmail,
    });

    if (!sendResult.success) {
      return { success: false, error: sendResult.error || "Failed to send SmartLead email reply" };
    }
  } else if (provider === EmailIntegrationProvider.INSTANTLY) {
    if (!client.instantlyApiKey) {
      return { success: false, error: "Client missing Instantly API key" };
    }
    if (!instantlyHandle) {
      return { success: false, error: "Instantly thread handle is invalid or missing" };
    }

    const instantlyCc = recipientsWithOverride.cc;
    const instantlyBcc = latestInboundEmail?.bcc || [];

    const sendResult = await sendInstantlyReply(client.instantlyApiKey, {
      replyToUuid: instantlyHandle.replyToUuid,
      eaccount: instantlyHandle.eaccount,
      subject,
      body: { text: params.messageContent },
      cc: instantlyCc.length > 0 ? instantlyCc : undefined,
      bcc: instantlyBcc.length > 0 ? instantlyBcc : undefined,
    });

    if (!sendResult.success) {
      return { success: false, error: sendResult.error || "Failed to send Instantly email reply" };
    }
  } else {
    return { success: false, error: "No supported email provider is configured for this workspace" };
  }

  const messageToEmail =
    provider === EmailIntegrationProvider.SMARTLEAD
      ? recipientsWithOverride.overrideApplied
        ? recipientsWithOverride.toEmail
        : smartLeadHandle?.toEmail || recipientsWithOverride.toEmail
      : recipientsWithOverride.toEmail;

  const message = await prisma.message.create({
    data: {
      body: params.messageContent,
      subject,
      channel: "email",
      cc: recipientsWithOverride.cc,
      bcc: latestInboundEmail?.bcc || [],
      direction: "outbound",
      leadId: lead.id,
      sentAt: new Date(),
      sentBy: params.sentBy || undefined,
      sentByUserId: params.sentByUserId || undefined,
      ...(params.aiDraftId ? { aiDraftId: params.aiDraftId } : {}),
      toEmail: messageToEmail || undefined,
      toName: recipientsWithOverride.toName || undefined,
    },
  });

  // If the user explicitly selected a To: recipient, persist it as the lead's active replier so
  // future drafts/follow-ups target the right person (Phase 74).
  if (rawToOverride && allowToOverride) {
    const update = computeLeadCurrentReplierUpdate({
      primaryEmail: lead.email,
      selectedToEmail: messageToEmail,
      selectedToName: params.toNameOverride ?? recipientsWithOverride.toName,
      existingAlternateEmails: lead.alternateEmails ?? [],
      existingCurrentReplierEmail: lead.currentReplierEmail ?? null,
      existingCurrentReplierName: lead.currentReplierName ?? null,
      existingCurrentReplierSince: lead.currentReplierSince ?? null,
      now: message.sentAt,
    });

    if (update.changed) {
      await prisma.lead
        .update({
          where: { id: lead.id },
          data: {
            alternateEmails: update.alternateEmails,
            currentReplierEmail: update.currentReplierEmail,
            currentReplierName: update.currentReplierName,
            currentReplierSince: update.currentReplierSince,
          },
        })
        .catch((error) => {
          console.warn("[Email] Failed to persist current replier override:", error);
        });
    }
  }

  await bumpLeadMessageRollup({ leadId: lead.id, direction: "outbound", source: "zrg", sentAt: message.sentAt });

  // NOTE: revalidatePath("/") is NOT called here - this is intentional.
  // Use sendEmailReplyInternal in actions/email-actions.ts for server actions that need cache invalidation.

  autoStartNoResponseSequenceOnOutbound({ leadId: lead.id, outboundAt: message.sentAt }).catch((err) => {
    console.error("[Email] Failed to auto-start no-response sequence:", err);
  });

  // Phase 66: Trigger Meeting Requested sequence when setter sends their first email reply
  autoStartMeetingRequestedSequenceOnSetterEmailReply({
    leadId: lead.id,
    messageId: message.id,
    outboundAt: message.sentAt,
    sentByUserId: message.sentByUserId ?? null,
  }).catch((err) => {
    console.error("[Email] Failed to auto-start meeting-requested sequence on setter email reply:", err);
  });

  recordOutboundForBookingProgress({ leadId: lead.id, channel: "email" }).catch((err) => {
    console.error("[Email] Failed to record booking progress:", err);
  });

  if (provider === EmailIntegrationProvider.EMAILBISON) {
    syncEmailConversationHistorySystem(lead.id).catch((err) => {
      console.error("[Email] Background sync failed:", err);
    });
  }

  return { success: true, messageId: message.id };
}

/**
 * System-level email reply sender for AI drafts.
 *
 * This is a CLI-safe version of sendEmailReply from actions/email-actions.ts.
 * It does NOT call revalidatePath() so it can be safely used from CLI scripts.
 */
export async function sendEmailReplyForDraftSystem(
  draftId: string,
  editedContent?: string,
  opts: { sentBy?: OutboundSentBy | null; sentByUserId?: string | null; cc?: string[] } = {}
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

    const sendResult = await sendEmailReplySystem({
      lead,
      provider,
      messageContent,
      aiDraftId: draftId,
      sentBy: opts.sentBy,
      sentByUserId: opts.sentByUserId,
      ccOverride: opts.cc,
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
