import { prisma } from "@/lib/prisma";
import { sendSMS, updateGHLContact } from "@/lib/ghl-api";
import { ensureGhlContactIdForLead } from "@/lib/ghl-contacts";
import { autoStartNoResponseSequenceOnOutbound } from "@/lib/followup-automation";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { toGhlPhoneBestEffort } from "@/lib/phone-utils";
import { enrichPhoneThenSyncToGhl } from "@/lib/phone-enrichment";

export type OutboundSentBy = "ai" | "setter";

export type SystemSendMeta = {
  sentBy?: OutboundSentBy | null;
  aiDraftId?: string | null;
};

export type SystemSendResult = {
  success: boolean;
  messageId?: string;
  errorCode?: "sms_dnd";
  error?: string;
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
    if (meta.aiDraftId) {
      const existing = await prisma.message.findUnique({
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
            ghlPrivateKey: true,
            ghlLocationId: true,
          },
        },
      },
    });

    if (!lead) return { success: false, error: "Lead not found" };
    if (lead.status === "blacklisted") return { success: false, error: "Lead is blacklisted" };

    if (!lead.client.ghlPrivateKey) {
      return { success: false, error: "Workspace has no GHL API key configured" };
    }

    let ghlContactId = lead.ghlContactId;
    if (!ghlContactId) {
      const ensureResult = await ensureGhlContactIdForLead(leadId, { requirePhone: true });
      if (!ensureResult.success || !ensureResult.ghlContactId) {
        return { success: false, error: ensureResult.error || "Lead has no GHL contact ID" };
      }
      ghlContactId = ensureResult.ghlContactId;
    }

    let result = await sendSMS(ghlContactId, body, lead.client.ghlPrivateKey, {
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
      const phoneForGhl = toGhlPhoneBestEffort(lead.phone, { defaultCountryCallingCode });

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
          lead.client.ghlPrivateKey,
          { locationId: lead.client.ghlLocationId || undefined }
        );

      if (phoneForGhl) {
        const patch = await patchAttempt(phoneForGhl);
        if (patch.success) {
          result = await sendSMS(ghlContactId, body, lead.client.ghlPrivateKey, {
            locationId: lead.client.ghlLocationId || undefined,
          });
        }
      }

      // If still failing, attempt the enrichment pipeline (message content → EmailBison → optional signature AI → Clay).
      if (!result.success && (result.error || "").toLowerCase().includes("missing phone number")) {
        const includeSignatureAi = process.env.PHONE_ENRICHMENT_SIGNATURE_AI_ENABLED === "true";
        const enriched = await enrichPhoneThenSyncToGhl(leadId, { includeSignatureAi });

        if (enriched.phoneFound) {
          result = await sendSMS(ghlContactId, body, lead.client.ghlPrivateKey, {
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

    const savedMessage = await prisma.message.create({
      data: {
        ghlId: ghlMessageId,
        body,
        direction: "outbound",
        channel: "sms",
        leadId: lead.id,
        sentAt: ghlDateAdded,
        sentBy: meta.sentBy || undefined,
        aiDraftId: meta.aiDraftId || undefined,
      },
    });

    await bumpLeadMessageRollup({ leadId: lead.id, direction: "outbound", sentAt: ghlDateAdded });

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

    return { success: true, messageId: savedMessage.id };
  } catch (error) {
    console.error("[sendSmsSystem] Failed:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

