import "@/lib/server-dns";

import { prisma } from "@/lib/prisma";
import { fetchEmailBisonLead, getCustomVariable } from "@/lib/emailbison-api";
import { triggerEnrichmentForLead, type ClayEnrichmentRequest } from "@/lib/clay-api";
import { extractContactFromMessageContent, extractContactFromSignature } from "@/lib/signature-extractor";
import { toStoredPhone } from "@/lib/phone-utils";
import { normalizeLinkedInUrl } from "@/lib/linkedin-utils";
import { syncGhlContactPhoneForLead } from "@/lib/ghl-contacts";

export type PhoneEnrichmentAttemptResult = {
  success: boolean;
  phoneFound?: boolean;
  phone?: string | null;
  source?: "lead" | "message_content" | "emailbison" | "signature" | "clay_triggered" | "none";
  ghlSynced?: boolean;
  clayTriggered?: boolean;
  error?: string;
};

async function tryHydratePhoneFromRecentMessages(leadId: string): Promise<string | null> {
  const messages = await prisma.message.findMany({
    where: { leadId, direction: "inbound" },
    orderBy: { sentAt: "desc" },
    take: 6,
    select: { body: true, rawText: true, rawHtml: true },
  });

  for (const m of messages) {
    const text = m.rawText || m.rawHtml || m.body || "";
    if (!text.trim()) continue;
    const extraction = extractContactFromMessageContent(text);
    if (extraction.phone) {
      return toStoredPhone(extraction.phone) || extraction.phone;
    }
  }

  return null;
}

async function tryHydratePhoneFromEmailBisonCustomVars(opts: {
  emailBisonLeadId: string;
  emailBisonApiKey: string;
}): Promise<string | null> {
  const leadDetails = await fetchEmailBisonLead(opts.emailBisonApiKey, opts.emailBisonLeadId);
  if (!leadDetails.success || !leadDetails.data) return null;

  const customVars = leadDetails.data.custom_variables || [];
  const phoneRaw =
    getCustomVariable(customVars, "phone") ||
    getCustomVariable(customVars, "mobile") ||
    getCustomVariable(customVars, "phone number");

  if (!phoneRaw || phoneRaw === "-") return null;
  return toStoredPhone(phoneRaw);
}

async function tryHydratePhoneFromSignatureAi(opts: {
  clientId: string;
  leadId: string;
  leadName: string;
  leadEmail: string;
}): Promise<string | null> {
  const message = await prisma.message.findFirst({
    where: { leadId: opts.leadId, direction: "inbound", channel: "email" },
    orderBy: { sentAt: "desc" },
    select: { rawText: true, rawHtml: true, body: true },
  });

  const emailBody = (message?.rawText || message?.rawHtml || message?.body || "").trim();
  if (!emailBody) return null;

  const extraction = await extractContactFromSignature(emailBody, opts.leadName, opts.leadEmail, {
    clientId: opts.clientId,
    leadId: opts.leadId,
  });

  if (!extraction.isFromLead) return null;
  if (!extraction.phone) return null;
  return toStoredPhone(extraction.phone) || extraction.phone;
}

async function triggerClayPhoneEnrichment(opts: {
  leadId: string;
  emailAddress: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  state?: string | null;
  linkedInProfile?: string | null;
}): Promise<{ sent: boolean; error?: string }> {
  const fullName = `${opts.firstName || ""} ${opts.lastName || ""}`.trim();
  const req: ClayEnrichmentRequest = {
    leadId: opts.leadId,
    emailAddress: opts.emailAddress,
    firstName: opts.firstName || undefined,
    lastName: opts.lastName || undefined,
    fullName: fullName || undefined,
    companyName: opts.companyName || undefined,
    companyDomain: opts.companyDomain || undefined,
    state: opts.state || undefined,
    linkedInProfile: opts.linkedInProfile || undefined,
  };

  const result = await triggerEnrichmentForLead(req, false, true);
  if (!result.phoneSent) return { sent: false, error: "Clay phone enrichment did not send (rate limited or misconfigured)" };
  return { sent: true };
}

async function ensureMissingPhoneTask(leadId: string, note: string): Promise<void> {
  const existing = await prisma.followUpTask.findFirst({
    where: {
      leadId,
      type: "sms",
      status: "pending",
      suggestedMessage: { startsWith: "[SMS Disabled]" },
    },
    select: { id: true },
  });

  if (existing) return;

  await prisma.followUpTask.create({
    data: {
      leadId,
      type: "sms",
      dueDate: new Date(),
      status: "pending",
      suggestedMessage: `[SMS Disabled] ${note}`,
      campaignName: "phone_enrichment",
    },
  });
}

export async function enrichPhoneThenSyncToGhl(leadId: string, opts?: {
  includeSignatureAi?: boolean;
}): Promise<PhoneEnrichmentAttemptResult> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        linkedinUrl: true,
        companyName: true,
        companyWebsite: true,
        companyState: true,
        enrichmentStatus: true,
        enrichmentRetryCount: true,
        emailBisonLeadId: true,
        ghlContactId: true,
        clientId: true,
        client: {
          select: {
            emailBisonApiKey: true,
          },
        },
      },
    });

    if (!lead) return { success: false, error: "Lead not found" };

    // If we already have a phone, just attempt to sync to GHL.
    if (lead.phone) {
      const sync = await syncGhlContactPhoneForLead(lead.id).catch((e) => ({
        success: false,
        updated: false,
        error: e instanceof Error ? e.message : "Failed to sync to GHL",
      }));
      if (!sync.success) {
        await ensureMissingPhoneTask(
          lead.id,
          `Phone exists on lead but could not be synced to GHL (${sync.error || "unknown error"}). Verify the lead phone format and GHL contact settings.`
        ).catch(() => undefined);
      }
      return {
        success: true,
        phoneFound: true,
        phone: lead.phone,
        source: "lead",
        ghlSynced: Boolean(sync.success && sync.updated),
      };
    }

    // 1) Message content extraction (fast, no AI)
    const fromMessages = await tryHydratePhoneFromRecentMessages(lead.id);
    if (fromMessages) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          phone: fromMessages,
          enrichmentStatus: "enriched",
          enrichmentSource: "message_content",
          enrichedAt: new Date(),
        },
      });

      const sync = await syncGhlContactPhoneForLead(lead.id).catch((e) => ({
        success: false,
        updated: false,
        error: e instanceof Error ? e.message : "Failed to sync to GHL",
      }));
      if (!sync.success) {
        await ensureMissingPhoneTask(
          lead.id,
          `Phone found in inbound message, but syncing it to the GHL contact failed (${sync.error || "unknown error"}). Verify GHL contact + phone formatting.`
        ).catch(() => undefined);
      }
      return {
        success: true,
        phoneFound: true,
        phone: fromMessages,
        source: "message_content",
        ghlSynced: Boolean(sync.success && sync.updated),
      };
    }

    // 2) EmailBison custom variables (if configured)
    if (lead.emailBisonLeadId && lead.client.emailBisonApiKey) {
      const fromBison = await tryHydratePhoneFromEmailBisonCustomVars({
        emailBisonLeadId: lead.emailBisonLeadId,
        emailBisonApiKey: lead.client.emailBisonApiKey,
      });

      if (fromBison) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            phone: fromBison,
            enrichmentStatus: "enriched",
            enrichmentSource: "emailbison",
            enrichedAt: new Date(),
          },
        });

        const sync = await syncGhlContactPhoneForLead(lead.id).catch((e) => ({
          success: false,
          updated: false,
          error: e instanceof Error ? e.message : "Failed to sync to GHL",
        }));
        if (!sync.success) {
          await ensureMissingPhoneTask(
            lead.id,
            `Phone found from EmailBison variables, but syncing it to the GHL contact failed (${sync.error || "unknown error"}). Verify GHL contact + phone formatting.`
          ).catch(() => undefined);
        }
        return {
          success: true,
          phoneFound: true,
          phone: fromBison,
          source: "emailbison",
          ghlSynced: Boolean(sync.success && sync.updated),
        };
      }
    }

    // 3) Signature extraction (AI) - optional because it can be slow/expensive
    if (opts?.includeSignatureAi && lead.email) {
      const leadName = `${lead.firstName || ""} ${lead.lastName || ""}`.trim() || "Lead";
      const fromSig = await tryHydratePhoneFromSignatureAi({
        clientId: lead.clientId,
        leadId: lead.id,
        leadName,
        leadEmail: lead.email,
      });

      if (fromSig) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            phone: fromSig,
            enrichmentStatus: "enriched",
            enrichmentSource: "signature",
            enrichedAt: new Date(),
          },
        });

        const sync = await syncGhlContactPhoneForLead(lead.id).catch((e) => ({
          success: false,
          updated: false,
          error: e instanceof Error ? e.message : "Failed to sync to GHL",
        }));
        if (!sync.success) {
          await ensureMissingPhoneTask(
            lead.id,
            `Phone found via signature extraction, but syncing it to the GHL contact failed (${sync.error || "unknown error"}). Verify GHL contact + phone formatting.`
          ).catch(() => undefined);
        }
        return {
          success: true,
          phoneFound: true,
          phone: fromSig,
          source: "signature",
          ghlSynced: Boolean(sync.success && sync.updated),
        };
      }
    }

    // 4) Clay enrichment trigger (async)
    if (!lead.email) {
      await ensureMissingPhoneTask(lead.id, "No email available to enrich phone. Add a phone number on the lead and re-sync to GHL.");
      return { success: true, phoneFound: false, source: "none" };
    }

    // One-time policy: only trigger Clay once per lead (avoid retry storms).
    // NOTE: A lead can have `enrichmentStatus="enriched"` from a different source (e.g., signature),
    // while still missing a phone. In that case we still allow a single Clay phone attempt (retryCount=0).
    const alreadyAttempted = (lead.enrichmentRetryCount || 0) >= 1;
    const inProgress = lead.enrichmentStatus === "pending";

    if (!inProgress && !alreadyAttempted) {
      const companyDomain = lead.companyWebsite || null;
      const clay = await triggerClayPhoneEnrichment({
        leadId: lead.id,
        emailAddress: lead.email,
        firstName: lead.firstName,
        lastName: lead.lastName,
        companyName: lead.companyName,
        companyDomain,
        state: lead.companyState,
        linkedInProfile: lead.linkedinUrl ? normalizeLinkedInUrl(lead.linkedinUrl) : null,
      });

      if (clay.sent) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            enrichmentStatus: "pending",
            enrichmentSource: "clay",
            enrichmentLastRetry: new Date(),
            enrichmentRetryCount: (lead.enrichmentRetryCount || 0) + 1,
          },
        });

        await ensureMissingPhoneTask(
          lead.id,
          "No phone found locally. Clay phone enrichment was triggered; SMS will remain disabled until a phone is found."
        ).catch(() => undefined);

        return { success: true, phoneFound: false, source: "clay_triggered", clayTriggered: true };
      }
    }

    await ensureMissingPhoneTask(
      lead.id,
      "Could not find a phone number in messages or EmailBison. Clay enrichment was not triggered (already pending or misconfigured)."
    );

    return { success: true, phoneFound: false, source: "none" };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Phone enrichment failed" };
  }
}
