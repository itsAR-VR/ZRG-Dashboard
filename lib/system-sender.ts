import { prisma, isPrismaUniqueConstraintError } from "@/lib/prisma";
import { sendSMS, updateGHLContact } from "@/lib/ghl-api";
import { ensureGhlContactIdForLead } from "@/lib/ghl-contacts";
import { autoStartNoResponseSequenceOnOutbound } from "@/lib/followup-automation";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { resolvePhoneE164ForGhl } from "@/lib/phone-normalization";
import { enrichPhoneThenSyncToGhl } from "@/lib/phone-enrichment";
import { recordOutboundForBookingProgress, handleSmsDndForBookingProgress } from "@/lib/booking-progress";
import { sendLinkedInMessageWithWaterfall } from "@/lib/unipile-api";
import { updateUnipileConnectionHealth } from "@/lib/workspace-integration-health";

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
  errorCode?: "sms_dnd";
  error?: string;
};

export type LinkedInSystemSendResult = {
  success: boolean;
  messageId?: string;
  error?: string;
  messageType?: "dm" | "inmail" | "connection_request";
  attemptedMethods?: string[];
};

function isGhlSmsDndErrorText(errorText: string): boolean {
  const lower = (errorText || "").toLowerCase();
  return (
    lower.includes("dnd is active") ||
    (lower.includes("dnd") && lower.includes("sms") && lower.includes("cannot send"))
  );
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

    const lead = await prisma.lead.findUnique({
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
	      return { success: false, error: "Workspace has no GHL API key configured" };
	    }
	    const ghlPrivateKey = lead.client.ghlPrivateKey;

	    let ghlContactId = lead.ghlContactId;
    if (!ghlContactId) {
      const ensureResult = await ensureGhlContactIdForLead(leadId, { requirePhone: true });
      if (!ensureResult.success || !ensureResult.ghlContactId) {
        return { success: false, error: ensureResult.error || "Lead has no GHL contact ID" };
      }
      ghlContactId = ensureResult.ghlContactId;
    }

	    let result = await sendSMS(ghlContactId, body, ghlPrivateKey, {
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

      return {
        success: false,
        errorCode: "sms_dnd",
        error: "Cannot send SMS right now (DND active in GoHighLevel).",
      };
    }

    // Common failure mode: contact exists but does not have a phone number saved in GHL.
    // If we have a phone in our DB, try to patch it onto the contact and retry once.
    if (!result.success && (result.error || "").toLowerCase().includes("missing phone number")) {
      const defaultCountryCallingCode = (process.env.GHL_DEFAULT_COUNTRY_CALLING_CODE || "1").trim();
      const phoneResolution = await resolvePhoneE164ForGhl({
        clientId: lead.clientId,
        leadId,
        phone: lead.phone,
        leadTimezone: lead.timezone,
        workspaceTimezone: lead.client.settings?.timezone ?? null,
        companyState: lead.companyState,
        email: lead.email,
        companyWebsite: lead.companyWebsite,
        defaultCountryCallingCode,
      });
      const phoneForGhl = phoneResolution.ok ? phoneResolution.e164 : null;

      const patchAttempt = async (phone: string) =>
        updateGHLContact(
          ghlContactId,
          {
            firstName: lead.firstName || undefined,
            lastName: lead.lastName || undefined,
            email: lead.email || undefined,
            phone,
            companyName: lead.companyName || undefined,
            website: lead.companyWebsite || undefined,
            timezone: lead.timezone || undefined,
	            source: "zrg-dashboard",
	          },
	          ghlPrivateKey,
	          { locationId: lead.client.ghlLocationId || undefined }
	        );

      if (phoneForGhl) {
	        const patch = await patchAttempt(phoneForGhl);
	        if (patch.success) {
	          result = await sendSMS(ghlContactId, body, ghlPrivateKey, {
	            locationId: lead.client.ghlLocationId || undefined,
	          });
	        }
      }

      // If still failing, attempt the enrichment pipeline (message content → EmailBison → optional signature AI → Clay).
      if (!result.success && (result.error || "").toLowerCase().includes("missing phone number")) {
        const includeSignatureAi = process.env.PHONE_ENRICHMENT_SIGNATURE_AI_ENABLED === "true";
        const enriched = await enrichPhoneThenSyncToGhl(leadId, { includeSignatureAi });

	        if (enriched.phoneFound) {
	          result = await sendSMS(ghlContactId, body, ghlPrivateKey, {
	            locationId: lead.client.ghlLocationId || undefined,
	          });
	        } else {
          return {
            success: false,
            error:
              enriched.source === "clay_triggered"
                ? "Cannot send SMS: phone missing. Enrichment triggered; SMS will be disabled until a phone is found."
                : "Cannot send SMS: phone missing. Add a phone number to the lead and re-sync to GHL.",
          };
        }
      }
    }

    if (!result.success) {
      return { success: false, error: result.error || "Failed to send message via GHL" };
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

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        updatedAt: new Date(),
        ...(lead.smsDndActive ? { smsDndActive: false, smsDndUpdatedAt: new Date() } : {}),
      },
    });

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

    const lead = await prisma.lead.findUnique({
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

    if (!lead.linkedinUrl && !lead.linkedinId) {
      return { success: false, error: "Lead has no LinkedIn profile linked" };
    }

    if (!lead.linkedinUrl) {
      return { success: false, error: "Lead has linkedinId but no LinkedIn URL - cannot send message" };
    }

    if (!lead.client.unipileAccountId) {
      return { success: false, error: "Workspace has no LinkedIn account configured" };
    }

    const result = await sendLinkedInMessageWithWaterfall(
      lead.client.unipileAccountId,
      lead.linkedinUrl,
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
