import { prisma } from "@/lib/prisma";
import {
  classifyLinkedInUrl,
  mergeLinkedInCompanyUrl,
  mergeLinkedInUrl,
  normalizeLinkedInUrl,
} from "@/lib/linkedin-utils";
import { normalizePhoneDigits, toStoredPhone } from "@/lib/phone-utils";

/**
 * Normalize phone number by stripping all non-digit characters
 * This allows matching +1-555-123-4567 = (555) 123-4567 = 5551234567
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  return normalizePhoneDigits(phone);
}

/**
 * Normalize email to lowercase for case-insensitive matching
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.toLowerCase().trim();
}

export interface ContactInfo {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  linkedinUrl?: string | null;
}

export interface ExternalIds {
  ghlContactId?: string | null;
  emailBisonLeadId?: string | null;
  linkedinId?: string | null;
  linkedinUrl?: string | null;
  linkedinCompanyUrl?: string | null;
}

export interface CampaignIds {
  campaignId?: string | null;
  smsCampaignId?: string | null;
  emailCampaignId?: string | null;
  senderAccountId?: string | null;
}

export interface FindOrCreateLeadResult {
  lead: {
    id: string;
    ghlContactId: string | null;
    emailBisonLeadId: string | null;
    linkedinId: string | null;
    linkedinUrl: string | null;
    linkedinCompanyUrl: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    status: string;
    sentimentTag: string | null;
    clientId: string;
    autoReplyEnabled: boolean;
    autoFollowUpEnabled: boolean;
    enrichmentStatus: string | null;
  };
  isNew: boolean;
  matchedBy: "email" | "alternateEmail" | "phone" | "ghlContactId" | "emailBisonLeadId" | "linkedinUrl" | "linkedinId" | "new";
}

/**
 * Find an existing lead or create a new one based on contact info
 * 
 * Matching priority:
 * 1. ghlContactId (if provided) - exact match for GHL contacts
 * 2. emailBisonLeadId (if provided) - exact match for Inboxxia leads  
 * 3. linkedinId / linkedinUrl (if provided)
 * 4. email (case-insensitive) - cross-channel matching
 * 5. alternateEmails (array membership)
 * 6. phone (normalized digits) - cross-channel matching
 * 
 * If a match is found, updates the lead with any new information.
 * If no match, creates a new lead.
 */
export async function findOrCreateLead(
  clientId: string,
  contactInfo: ContactInfo,
  externalIds?: ExternalIds,
  campaignIds?: CampaignIds
): Promise<FindOrCreateLeadResult> {
  const normalizedEmail = normalizeEmail(contactInfo.email);
  const normalizedPhone = normalizePhone(contactInfo.phone);
  const contactLinkedIn = classifyLinkedInUrl(contactInfo.linkedinUrl);
  const externalLinkedIn = classifyLinkedInUrl(externalIds?.linkedinUrl);
  const externalLinkedInCompany = classifyLinkedInUrl(externalIds?.linkedinCompanyUrl);
  const normalizedLinkedInUrl = normalizeLinkedInUrl(
    externalLinkedIn.profileUrl || contactLinkedIn.profileUrl
  );
  const normalizedLinkedInCompanyUrl =
    externalLinkedInCompany.companyUrl ||
    externalLinkedIn.companyUrl ||
    contactLinkedIn.companyUrl;

  // Try to find existing lead with explicit priority
  let existingLead = null;
  let matchedBy: FindOrCreateLeadResult["matchedBy"] = "new";

  if (!existingLead && externalIds?.ghlContactId) {
    existingLead = await prisma.lead.findFirst({
      where: { clientId, ghlContactId: externalIds.ghlContactId },
    });
    if (existingLead) matchedBy = "ghlContactId";
  }

  if (!existingLead && externalIds?.emailBisonLeadId) {
    existingLead = await prisma.lead.findFirst({
      where: { clientId, emailBisonLeadId: externalIds.emailBisonLeadId },
    });
    if (existingLead) matchedBy = "emailBisonLeadId";
  }

  if (!existingLead && externalIds?.linkedinId) {
    existingLead = await prisma.lead.findFirst({
      where: { clientId, linkedinId: externalIds.linkedinId },
    });
    if (existingLead) matchedBy = "linkedinId";
  }

  if (!existingLead && normalizedLinkedInUrl) {
    existingLead = await prisma.lead.findFirst({
      where: { clientId, linkedinUrl: normalizedLinkedInUrl },
    });
    if (existingLead) matchedBy = "linkedinUrl";
  }

  if (!existingLead && normalizedEmail) {
    existingLead = await prisma.lead.findFirst({
      where: { clientId, email: { equals: normalizedEmail, mode: "insensitive" } },
    });
    if (existingLead) matchedBy = "email";
  }

  if (!existingLead && normalizedEmail) {
    existingLead = await prisma.lead.findFirst({
      where: { clientId, alternateEmails: { has: normalizedEmail } },
    });
    if (existingLead) matchedBy = "alternateEmail";
  }

  if (!existingLead && normalizedPhone) {
    // Phone is stored in E.164-like format (`+` + digits). Use a contains match so we can
    // safely migrate older rows that stored digits-only without breaking matching.
    existingLead = await prisma.lead.findFirst({
      where: { clientId, phone: { contains: normalizedPhone } },
    });
    if (existingLead) matchedBy = "phone";
  }

  if (existingLead) {
    if (matchedBy === "alternateEmail") {
      console.log(`[Lead Matching] Matched via alternateEmails (${normalizedEmail ?? "unknown"})`);
    }
    // Update existing lead with any new information
    const updates: any = {};

    // Fill in missing contact info
    if (!existingLead.email && normalizedEmail) {
      updates.email = normalizedEmail;
    }
    if (!existingLead.phone && normalizedPhone) {
      updates.phone = toStoredPhone(contactInfo.phone);
    }
    if (!existingLead.firstName && contactInfo.firstName) {
      updates.firstName = contactInfo.firstName;
    }
    if (!existingLead.lastName && contactInfo.lastName) {
      updates.lastName = contactInfo.lastName;
    }

    // Add external IDs if not present
    if (!existingLead.ghlContactId && externalIds?.ghlContactId) {
      updates.ghlContactId = externalIds.ghlContactId;
    }
    if (!existingLead.emailBisonLeadId && externalIds?.emailBisonLeadId) {
      updates.emailBisonLeadId = externalIds.emailBisonLeadId;
    }
    if (!existingLead.linkedinId && externalIds?.linkedinId) {
      updates.linkedinId = externalIds.linkedinId;
    }
    const mergedLinkedIn = mergeLinkedInUrl(existingLead.linkedinUrl, normalizedLinkedInUrl);
    if (mergedLinkedIn && mergedLinkedIn !== existingLead.linkedinUrl) {
      updates.linkedinUrl = mergedLinkedIn;
    }
    const mergedLinkedInCompany = mergeLinkedInCompanyUrl(
      existingLead.linkedinCompanyUrl,
      normalizedLinkedInCompanyUrl
    );
    if (mergedLinkedInCompany && mergedLinkedInCompany !== existingLead.linkedinCompanyUrl) {
      updates.linkedinCompanyUrl = mergedLinkedInCompany;
    }

    // Add campaign associations if not present
    if (!existingLead.campaignId && campaignIds?.campaignId) {
      updates.campaignId = campaignIds.campaignId;
    }
    if (existingLead.smsCampaignId == null && campaignIds?.smsCampaignId) {
      updates.smsCampaignId = campaignIds.smsCampaignId;
    }
    if (!existingLead.emailCampaignId && campaignIds?.emailCampaignId) {
      updates.emailCampaignId = campaignIds.emailCampaignId;
    }
    if (!existingLead.senderAccountId && campaignIds?.senderAccountId) {
      updates.senderAccountId = campaignIds.senderAccountId;
    }

    // Only update if there are changes
    if (Object.keys(updates).length > 0) {
      const updatedLead = await prisma.lead.update({
        where: { id: existingLead.id },
        data: updates,
      });

      console.log(`[Lead Matching] Updated existing lead ${existingLead.id} (matched by ${matchedBy})`);

      return {
        lead: updatedLead,
        isNew: false,
        matchedBy,
      };
    }

    console.log(`[Lead Matching] Found existing lead ${existingLead.id} (matched by ${matchedBy})`);

    return {
      lead: existingLead,
      isNew: false,
      matchedBy,
    };
  }

  // Determine enrichment status for new lead
  // SMS-only leads (no email) don't need enrichment
  // Email leads need enrichment if missing LinkedIn or phone
  let enrichmentStatus: string | null = null;
  if (!normalizedEmail && normalizedPhone) {
    // SMS-only lead
    enrichmentStatus = "not_needed";
  } else if (normalizedEmail && (!normalizedLinkedInUrl || !normalizedPhone)) {
    // Email lead missing some data
    enrichmentStatus = "pending";
  }

  // Create new lead (race-safe under webhook retries)
  try {
    const newLead = await prisma.lead.create({
      data: {
        clientId,
        email: normalizedEmail,
        phone: toStoredPhone(contactInfo.phone),
        linkedinUrl: normalizedLinkedInUrl,
        linkedinCompanyUrl: normalizedLinkedInCompanyUrl,
        linkedinId: externalIds?.linkedinId || null,
        firstName: contactInfo.firstName || null,
        lastName: contactInfo.lastName || null,
        ghlContactId: externalIds?.ghlContactId || null,
        emailBisonLeadId: externalIds?.emailBisonLeadId || null,
        campaignId: campaignIds?.campaignId || null,
        smsCampaignId: campaignIds?.smsCampaignId || null,
        emailCampaignId: campaignIds?.emailCampaignId || null,
        senderAccountId: campaignIds?.senderAccountId || null,
        status: "new",
        enrichmentStatus,
        enrichmentLastRetry: enrichmentStatus === "pending" ? new Date() : null,
      },
    });

    console.log(
      `[Lead Matching] Created new lead ${newLead.id} (hasEmail: ${!!normalizedEmail}, hasPhone: ${!!normalizedPhone}, hasLinkedInProfile: ${!!normalizedLinkedInUrl}, hasLinkedInCompany: ${!!normalizedLinkedInCompanyUrl})`
    );

    return {
      lead: newLead,
      isNew: true,
      matchedBy: "new",
    };
  } catch (error) {
    const errorCode = (error as { code?: unknown })?.code;
    const ghlContactId = externalIds?.ghlContactId;

    if (errorCode === "P2002" && ghlContactId) {
      const existingLead = await prisma.lead.findUnique({
        where: { ghlContactId },
      });

      if (existingLead) {
        console.warn(`[Lead Matching] Lead create race on ghlContactId; returning existing lead ${existingLead.id}`);
        return {
          lead: existingLead,
          isNew: false,
          matchedBy: "ghlContactId",
        };
      }
    }

    throw error;
  }
}

/**
 * Get all active channels for a lead based on their messages
 */
export async function getLeadChannels(leadId: string): Promise<("sms" | "email" | "linkedin")[]> {
  const messages = await prisma.message.findMany({
    where: { leadId },
    select: { channel: true },
    distinct: ["channel"],
  });

  return messages.map((m) => m.channel as "sms" | "email" | "linkedin");
}

/**
 * Get available channels for a lead based on contact info
 * (channels they CAN use, even if no messages yet)
 */
export function getAvailableChannels(lead: {
  phone?: string | null;
  ghlContactId?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  linkedinId?: string | null;
}): ("sms" | "email" | "linkedin")[] {
  const channels: ("sms" | "email" | "linkedin")[] = [];

  // SMS is available if we have a phone OR a linked GHL contact (we can reply via contactId).
  if (lead.phone || lead.ghlContactId) {
    channels.push("sms");
  }
  if (lead.email) {
    channels.push("email");
  }
  if (normalizeLinkedInUrl(lead.linkedinUrl)) {
    channels.push("linkedin");
  }

  return channels;
}
