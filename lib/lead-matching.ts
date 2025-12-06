import { prisma } from "@/lib/prisma";

/**
 * Normalize phone number by stripping all non-digit characters
 * This allows matching +1-555-123-4567 = (555) 123-4567 = 5551234567
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  // Return null if not enough digits for a valid phone
  if (digits.length < 7) return null;
  return digits;
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
}

export interface ExternalIds {
  ghlContactId?: string | null;
  emailBisonLeadId?: string | null;
  linkedinId?: string | null;
}

export interface CampaignIds {
  campaignId?: string | null;
  emailCampaignId?: string | null;
  senderAccountId?: string | null;
}

export interface FindOrCreateLeadResult {
  lead: {
    id: string;
    ghlContactId: string | null;
    emailBisonLeadId: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    status: string;
    sentimentTag: string | null;
    clientId: string;
    autoReplyEnabled: boolean;
    autoFollowUpEnabled: boolean;
  };
  isNew: boolean;
  matchedBy: "email" | "phone" | "ghlContactId" | "emailBisonLeadId" | "new";
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

  // Priority 3: Match by email (case-insensitive via normalized comparison)
  if (normalizedEmail) {
    searchConditions.push({ email: { equals: normalizedEmail, mode: "insensitive" } });
  }

  // Priority 4: Match by phone (we store normalized, but also check raw)
  if (normalizedPhone) {
    searchConditions.push({ phone: normalizedPhone });
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
      } else if (normalizedEmail && existingLead.email?.toLowerCase() === normalizedEmail) {
        matchedBy = "email";
      } else if (normalizedPhone && existingLead.phone === normalizedPhone) {
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
      updates.phone = normalizedPhone;
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

    // Add campaign associations if not present
    if (!existingLead.campaignId && campaignIds?.campaignId) {
      updates.campaignId = campaignIds.campaignId;
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

  // Create new lead
  const newLead = await prisma.lead.create({
    data: {
      clientId,
      email: normalizedEmail,
      phone: normalizedPhone,
      firstName: contactInfo.firstName || null,
      lastName: contactInfo.lastName || null,
      ghlContactId: externalIds?.ghlContactId || null,
      emailBisonLeadId: externalIds?.emailBisonLeadId || null,
      campaignId: campaignIds?.campaignId || null,
      emailCampaignId: campaignIds?.emailCampaignId || null,
      senderAccountId: campaignIds?.senderAccountId || null,
      status: "new",
    },
  });

  console.log(`[Lead Matching] Created new lead ${newLead.id} (email: ${normalizedEmail}, phone: ${normalizedPhone})`);

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
export function getAvailableChannels(lead: { phone?: string | null; email?: string | null }): ("sms" | "email" | "linkedin")[] {
  const channels: ("sms" | "email" | "linkedin")[] = [];

  if (lead.phone) {
    channels.push("sms");
  }
  if (lead.email) {
    channels.push("email");
  }
  // LinkedIn will be added when we have linkedinId integration

  return channels;
}

