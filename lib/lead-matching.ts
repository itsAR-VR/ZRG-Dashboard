import { prisma } from "@/lib/prisma";
import { normalizeLinkedInUrl } from "@/lib/linkedin-utils";
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
  matchedBy: "email" | "phone" | "ghlContactId" | "emailBisonLeadId" | "linkedinUrl" | "linkedinId" | "new";
}

/**
 * Find an existing lead or create a new one based on contact info
 * 
 * Matching priority:
 * 1. ghlContactId (if provided) - exact match for GHL contacts
 * 2. emailBisonLeadId (if provided) - exact match for Inboxxia leads  
 * 3. email (case-insensitive) - cross-channel matching
 * 4. phone (normalized digits) - cross-channel matching
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
  const normalizedLinkedInUrl = normalizeLinkedInUrl(contactInfo.linkedinUrl || externalIds?.linkedinUrl);

  // Build search conditions
  const searchConditions: any[] = [];

  // Priority 1: Match by ghlContactId if provided
  if (externalIds?.ghlContactId) {
    searchConditions.push({ ghlContactId: externalIds.ghlContactId });
  }

  // Priority 2: Match by emailBisonLeadId if provided
  if (externalIds?.emailBisonLeadId) {
    searchConditions.push({ emailBisonLeadId: externalIds.emailBisonLeadId });
  }

  // Priority 3: Match by linkedinId if provided
  if (externalIds?.linkedinId) {
    searchConditions.push({ linkedinId: externalIds.linkedinId });
  }

  // Priority 4: Match by linkedinUrl (normalized)
  if (normalizedLinkedInUrl) {
    searchConditions.push({ linkedinUrl: normalizedLinkedInUrl });
  }

  // Priority 5: Match by email (case-insensitive via normalized comparison)
  if (normalizedEmail) {
    searchConditions.push({ email: { equals: normalizedEmail, mode: "insensitive" } });
  }

  // Priority 6: Match by phone (we store normalized, but also check raw)
  if (normalizedPhone) {
    // Phone is stored in E.164-like format (`+` + digits). Use a contains match so we can
    // safely migrate older rows that stored digits-only without breaking matching.
    searchConditions.push({ phone: { contains: normalizedPhone } });
  }

  // Try to find existing lead
  let existingLead = null;
  let matchedBy: FindOrCreateLeadResult["matchedBy"] = "new";

  if (searchConditions.length > 0) {
    existingLead = await prisma.lead.findFirst({
      where: {
        clientId,
        OR: searchConditions,
      },
    });

    if (existingLead) {
      // Determine what we matched by (for logging/debugging)
      if (externalIds?.ghlContactId && existingLead.ghlContactId === externalIds.ghlContactId) {
        matchedBy = "ghlContactId";
      } else if (externalIds?.emailBisonLeadId && existingLead.emailBisonLeadId === externalIds.emailBisonLeadId) {
        matchedBy = "emailBisonLeadId";
      } else if (externalIds?.linkedinId && existingLead.linkedinId === externalIds.linkedinId) {
        matchedBy = "linkedinId";
      } else if (normalizedLinkedInUrl && existingLead.linkedinUrl === normalizedLinkedInUrl) {
        matchedBy = "linkedinUrl";
      } else if (normalizedEmail && existingLead.email?.toLowerCase() === normalizedEmail) {
        matchedBy = "email";
      } else if (normalizedPhone && normalizePhone(existingLead.phone) === normalizedPhone) {
        matchedBy = "phone";
      }
    }
  }

  if (existingLead) {
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
    if (!existingLead.linkedinUrl && normalizedLinkedInUrl) {
      updates.linkedinUrl = normalizedLinkedInUrl;
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

  // Create new lead
  const newLead = await prisma.lead.create({
    data: {
      clientId,
      email: normalizedEmail,
      phone: toStoredPhone(contactInfo.phone),
      linkedinUrl: normalizedLinkedInUrl,
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

  console.log(`[Lead Matching] Created new lead ${newLead.id} (email: ${normalizedEmail}, phone: ${normalizedPhone}, linkedin: ${normalizedLinkedInUrl})`);

  return {
    lead: newLead,
    isNew: true,
    matchedBy: "new",
  };
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
  email?: string | null;
  linkedinUrl?: string | null;
  linkedinId?: string | null;
}): ("sms" | "email" | "linkedin")[] {
  const channels: ("sms" | "email" | "linkedin")[] = [];

  if (lead.phone) {
    channels.push("sms");
  }
  if (lead.email) {
    channels.push("email");
  }
  if (lead.linkedinUrl || lead.linkedinId) {
    channels.push("linkedin");
  }

  return channels;
}
