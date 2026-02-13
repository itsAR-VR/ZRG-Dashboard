import { prisma, isPrismaUniqueConstraintError } from "@/lib/prisma";
import { sendSMS, updateGHLContact } from "@/lib/ghl-api";
import { ensureGhlContactIdForLead } from "@/lib/ghl-contacts";
import { autoStartNoResponseSequenceOnOutbound } from "@/lib/followup-automation";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { resolvePhoneE164ForSmsSendAiOnly } from "@/lib/phone-normalization";
import { recordOutboundForBookingProgress, handleSmsDndForBookingProgress } from "@/lib/booking-progress";
import { sendLinkedInMessageWithWaterfall } from "@/lib/unipile-api";
import { updateUnipileConnectionHealth } from "@/lib/workspace-integration-health";
import { mergeLinkedInFields, normalizeLinkedInUrl } from "@/lib/linkedin-utils";

export type OutboundSentBy = "ai" | "setter";

export type SystemSendMeta = {
  sentBy?: OutboundSentBy | null;
  sentByUserId?: string | null;
  aiDraftId?: string | null;
  aiDraftPartIndex?: number | null;
  skipBookingProgress?: boolean;
};

export type SystemSendResult = {
  success: boolean;
  messageId?: string;
  errorCode?:
    | "sms_dnd"
    | "invalid_country_code"
    | "phone_normalization_failed"
    | "missing_phone"
    | "ghl_not_configured";
  error?: string;
};

export type LinkedInSystemSendResult = {
  success: boolean;
  messageId?: string;
  error?: string;
  messageType?: "dm" | "inmail" | "connection_request";
  attemptedMethods?: string[];
  isInvalidProfileUrl?: boolean;
};

function isGhlSmsDndErrorText(errorText: string): boolean {
  const lower = (errorText || "").toLowerCase();
  return (
    lower.includes("dnd is active") ||
    (lower.includes("dnd") && lower.includes("sms") && lower.includes("cannot send"))
  );
}

async function recordSmsBlockedSendAttempt(leadId: string, reason: string): Promise<void> {
  await prisma.lead
    .update({
      where: { id: leadId },
      data: {
        smsLastBlockedAt: new Date(),
        smsLastBlockedReason: reason,
        smsConsecutiveBlockedCount: {
          increment: 1,
        },
      },
    })
    .catch(() => undefined);
}

async function recordSmsSendSuccess(leadId: string, opts: { clearDnd: boolean; sentAt: Date }): Promise<void> {
  await prisma.lead
    .update({
      where: { id: leadId },
      data: {
        updatedAt: new Date(),
        smsLastSuccessAt: opts.sentAt,
        smsConsecutiveBlockedCount: 0,
        smsLastBlockedReason: null,
        ...(opts.clearDnd ? { smsDndActive: false, smsDndUpdatedAt: new Date() } : {}),
      },
    })
    .catch(() => undefined);
}

export async function sendSmsSystem(
  leadId: string,
  body: string,
  meta: SystemSendMeta = {}
): Promise<SystemSendResult> {
  try {
    const aiDraftPartIndex = meta.aiDraftId
      ? (typeof meta.aiDraftPartIndex === "number" ? meta.aiDraftPartIndex : 0)
      : null;

    if (meta.aiDraftId) {
      const existing = await prisma.message.findFirst({
        where: {
          aiDraftId: meta.aiDraftId,
          ...(aiDraftPartIndex === 0
            ? { OR: [{ aiDraftPartIndex: null }, { aiDraftPartIndex: 0 }] }
            : { aiDraftPartIndex }),
        },
        select: { id: true },
      });
      if (existing) return { success: true, messageId: existing.id };
    }

    let lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        client: {
          select: {
            ghlPrivateKey: true,
            ghlLocationId: true,
            settings: { select: { timezone: true } },
          },
        },
      },
    });

    if (!lead) return { success: false, error: "Lead not found" };
    if (lead.status === "blacklisted") return { success: false, error: "Lead is blacklisted" };

    if (!lead.client.ghlPrivateKey) {
      const error = "Workspace has no GHL API key configured";
      await recordSmsBlockedSendAttempt(leadId, error);
      return { success: false, errorCode: "ghl_not_configured", error };
    }
    const ghlPrivateKey = lead.client.ghlPrivateKey;

    const phoneResolution = await resolvePhoneE164ForSmsSendAiOnly({
      clientId: lead.clientId,
      leadId,
      phone: lead.phone,
      leadTimezone: lead.timezone,
      workspaceTimezone: lead.client.settings?.timezone ?? null,
      companyState: lead.companyState,
      email: lead.email,
      companyWebsite: lead.companyWebsite,
      defaultCountryCallingCode: (process.env.GHL_DEFAULT_COUNTRY_CALLING_CODE || "1").trim(),
    });

    if (!phoneResolution.ok) {
      const isMissingPhone = phoneResolution.reason === "missing_phone" || phoneResolution.reason === "no_digits";
      const error = isMissingPhone
        ? "Cannot send SMS: no usable phone is available for this lead."
        : `Cannot send SMS: AI phone normalization failed (${phoneResolution.reason}).`;
      await recordSmsBlockedSendAttempt(leadId, error);
      return {
        success: false,
        errorCode: isMissingPhone ? "missing_phone" : "phone_normalization_failed",
        error,
      };
    }

    const normalizedPhone = phoneResolution.e164;
    if ((lead.phone || null) !== normalizedPhone) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { phone: normalizedPhone },
      });
    }

    let ghlContactId = lead.ghlContactId;
    if (!ghlContactId) {
      const ensureResult = await ensureGhlContactIdForLead(leadId, { requirePhone: true });
      if (!ensureResult.success || !ensureResult.ghlContactId) {
        const ensureError = ensureResult.error || "Lead has no GHL contact ID";
        await recordSmsBlockedSendAttempt(leadId, ensureError);
        return {
          success: false,
          errorCode: ensureError.toLowerCase().includes("ghl") ? "ghl_not_configured" : undefined,
          error: ensureError,
        };
      }
      ghlContactId = ensureResult.ghlContactId;
    }

    // Best-effort sync: keep GHL contact phone aligned before sending.
    await updateGHLContact(
      ghlContactId,
      {
        firstName: lead.firstName || undefined,
        lastName: lead.lastName || undefined,
        email: lead.email || undefined,
        phone: normalizedPhone,
        companyName: lead.companyName || undefined,
        website: lead.companyWebsite || undefined,
        timezone: lead.timezone || undefined,
        source: "zrg-dashboard",
      },
      ghlPrivateKey,
      { locationId: lead.client.ghlLocationId || undefined }
    ).catch((err) => {
      console.warn("[sendSmsSystem] Failed to sync phone to GHL contact before send:", err);
    });

    const result = await sendSMS(ghlContactId, body, ghlPrivateKey, {
      locationId: lead.client.ghlLocationId || undefined,
    });

    if (
      !result.success &&
      (result.errorCode === "sms_dnd" ||
        isGhlSmsDndErrorText(result.errorMessage || result.error || ""))
    ) {
      const now = new Date();
      await prisma.lead
        .update({
          where: { id: leadId },
          data: {
            smsDndActive: true,
            smsDndUpdatedAt: now,
          },
        })
        .catch(() => undefined);

      // Hold booking progress wave for SMS DND (Phase 36)
      handleSmsDndForBookingProgress({ leadId }).catch(() => undefined);

      const error = "Cannot send SMS right now (DND active in GoHighLevel).";
      await recordSmsBlockedSendAttempt(leadId, error);

      return {
        success: false,
        errorCode: "sms_dnd",
        error,
      }
    }

    if (!result.success) {
      const errorText = result.error || "Failed to send message via GHL";
      const lowerError = errorText.toLowerCase();
      if (
        result.errorCode === "invalid_country_code" ||
        lowerError.includes("invalid_country_code") ||
        lowerError.includes("invalid country code")
      ) {
        const error = "Cannot send SMS right now (invalid country code in GoHighLevel contact).";
        await recordSmsBlockedSendAttempt(leadId, error);
        return {
          success: false,
          errorCode: "invalid_country_code",
          error,
        };
      }

      if (lowerError.includes("missing phone")) {
        const error = "Cannot send SMS: contact is missing phone in GoHighLevel.";
        await recordSmsBlockedSendAttempt(leadId, error);
        return {
          success: false,
          errorCode: "missing_phone",
          error,
        };
      }

      await recordSmsBlockedSendAttempt(leadId, errorText);
      return { success: false, error: errorText };
    }

    const ghlMessageId = result.data?.messageId || null;
    const ghlDateAdded = result.data?.dateAdded ? new Date(result.data.dateAdded) : new Date();

    let savedMessage: { id: string };

    try {
      savedMessage = await prisma.message.create({
        data: {
          ghlId: ghlMessageId,
          body,
          direction: "outbound",
          channel: "sms",
          leadId: lead.id,
          sentAt: ghlDateAdded,
          sentBy: meta.sentBy || undefined,
          sentByUserId: meta.sentByUserId || undefined,
          aiDraftId: meta.aiDraftId || undefined,
          aiDraftPartIndex: meta.aiDraftId ? aiDraftPartIndex ?? 0 : undefined,
        },
        select: { id: true },
      });
    } catch (error) {
      if (meta.aiDraftId && isPrismaUniqueConstraintError(error)) {
        const existing = await prisma.message.findFirst({
          where: {
            aiDraftId: meta.aiDraftId,
            ...(aiDraftPartIndex === 0
              ? { OR: [{ aiDraftPartIndex: null }, { aiDraftPartIndex: 0 }] }
              : { aiDraftPartIndex }),
          },
          select: { id: true },
        });

        if (existing) {
          return { success: true, messageId: existing.id };
        }
      }

      throw error;
    }

    await bumpLeadMessageRollup({ leadId: lead.id, direction: "outbound", source: "zrg", sentAt: ghlDateAdded });
    await recordSmsSendSuccess(leadId, { clearDnd: lead.smsDndActive, sentAt: new Date() });

    autoStartNoResponseSequenceOnOutbound({ leadId, outboundAt: ghlDateAdded }).catch((err) => {
      console.error("[sendSmsSystem] Failed to auto-start no-response sequence:", err);
    });

    if (!meta.skipBookingProgress) {
      // Record booking progress for wave tracking (Phase 36)
      recordOutboundForBookingProgress({ leadId, channel: "sms" }).catch((err) => {
        console.error("[sendSmsSystem] Failed to record booking progress:", err);
      });
    }

    return { success: true, messageId: savedMessage.id };
  } catch (error) {
    console.error("[sendSmsSystem] Failed:", error);
    const errorText = error instanceof Error ? error.message : "Unknown error";
    await recordSmsBlockedSendAttempt(leadId, `Unexpected send failure: ${errorText}`);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function sendLinkedInMessageSystem(
  leadId: string,
  body: string,
  meta: SystemSendMeta = {}
): Promise<LinkedInSystemSendResult> {
  try {
    if (meta.aiDraftId) {
      const existing = await prisma.message.findFirst({
        where: { aiDraftId: meta.aiDraftId },
        select: { id: true },
      });
      if (existing) return { success: true, messageId: existing.id };
    }

    let lead = await prisma.lead.findUnique({
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

    if (!lead) return { success: false, error: "Lead not found" };
    if (lead.status === "blacklisted") return { success: false, error: "Lead is blacklisted" };

    const repairedLinkedIn = mergeLinkedInFields({
      currentProfileUrl: lead.linkedinUrl,
      currentCompanyUrl: lead.linkedinCompanyUrl,
    });
    if (
      repairedLinkedIn.profileUrl !== (lead.linkedinUrl ?? null) ||
      repairedLinkedIn.companyUrl !== (lead.linkedinCompanyUrl ?? null)
    ) {
      lead = await prisma.lead.update({
        where: { id: lead.id },
        data: {
          linkedinUrl: repairedLinkedIn.profileUrl,
          linkedinCompanyUrl: repairedLinkedIn.companyUrl,
        },
        include: {
          client: {
            select: {
              id: true,
              unipileAccountId: true,
            },
          },
        },
      });
    }

    if (!lead.linkedinUrl && !lead.linkedinId) {
      return { success: false, error: "Lead has no LinkedIn profile linked" };
    }

    if (!lead.linkedinUrl) {
      return {
        success: false,
        error: "LinkedIn send requires a personal /in/ profile URL. This lead currently has no usable profile URL.",
      };
    }

    const validLinkedInProfileUrl = normalizeLinkedInUrl(lead.linkedinUrl);
    if (!validLinkedInProfileUrl) {
      console.warn(
        `[LINKEDIN] Invalid profile URL rejected — leadId=${lead.id}, url=${lead.linkedinUrl || "n/a"}`
      );
      return {
        success: false,
        error:
          "LinkedIn URL is not a personal profile — cannot send. Lead needs a /in/ profile URL.",
        isInvalidProfileUrl: true,
      };
    }

    if (!lead.client.unipileAccountId) {
      return { success: false, error: "Workspace has no LinkedIn account configured" };
    }

    const result = await sendLinkedInMessageWithWaterfall(
      lead.client.unipileAccountId,
      validLinkedInProfileUrl,
      body,
      undefined,
      undefined
    );

    if (!result.success) {
      if (result.isDisconnectedAccount) {
        await updateUnipileConnectionHealth({
          clientId: lead.client.id,
          isDisconnected: true,
          errorDetail: result.error,
        }).catch(() => undefined);
      }

      if (result.isUnreachableRecipient && process.env.UNIPILE_HEALTH_GATE === "1") {
        await prisma.lead
          .update({
            where: { id: lead.id },
            data: {
              linkedinUnreachableAt: new Date(),
              linkedinUnreachableReason: result.error || "Recipient cannot be reached",
            },
          })
          .catch(() => undefined);
      }

      return { success: false, error: result.error, attemptedMethods: result.attemptedMethods };
    }

    await updateUnipileConnectionHealth({
      clientId: lead.client.id,
      isDisconnected: false,
    }).catch(() => undefined);

    const savedMessage = await prisma.message.create({
      data: {
        body,
        direction: "outbound",
        channel: "linkedin",
        source: "zrg",
        leadId: lead.id,
        sentAt: new Date(),
        sentBy: meta.sentBy ?? "ai",
        sentByUserId: meta.sentByUserId || undefined,
        aiDraftId: meta.aiDraftId || undefined,
      },
    });

    await bumpLeadMessageRollup({ leadId: lead.id, direction: "outbound", source: "zrg", sentAt: savedMessage.sentAt });

    await prisma.lead.update({
      where: { id: leadId },
      data: { updatedAt: new Date() },
    });

    autoStartNoResponseSequenceOnOutbound({ leadId, outboundAt: savedMessage.sentAt }).catch(() => undefined);

    if (!meta.skipBookingProgress) {
      recordOutboundForBookingProgress({ leadId, channel: "linkedin" }).catch(() => undefined);
    }

    return {
      success: true,
      messageId: savedMessage.id,
      messageType: result.messageType,
      attemptedMethods: result.attemptedMethods,
    };
  } catch (error) {
    console.error("[sendLinkedInMessageSystem] Failed:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
