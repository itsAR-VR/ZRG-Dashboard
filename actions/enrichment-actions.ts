"use server";

/**
 * Server actions for lead enrichment management
 * Provides manual triggers for backfill and status checking
 */

import { prisma } from "@/lib/prisma";
import { triggerEnrichmentForLead, type ClayEnrichmentRequest } from "@/lib/clay-api";
import { fetchEmailBisonLead, getCustomVariable } from "@/lib/emailbison-api";
import { normalizeLinkedInUrl } from "@/lib/linkedin-utils";
import { normalizePhone } from "@/lib/lead-matching";

export interface EnrichmentStats {
  pending: number;
  enriched: number;
  notFound: number;
  notNeeded: number;
  total: number;
}

/**
 * Get enrichment statistics for a workspace
 */
export async function getEnrichmentStats(clientId: string): Promise<EnrichmentStats> {
  const [pending, enriched, notFound, notNeeded, total] = await Promise.all([
    prisma.lead.count({ where: { clientId, enrichmentStatus: "pending" } }),
    prisma.lead.count({ where: { clientId, enrichmentStatus: "enriched" } }),
    prisma.lead.count({ where: { clientId, enrichmentStatus: "not_found" } }),
    prisma.lead.count({ where: { clientId, enrichmentStatus: "not_needed" } }),
    prisma.lead.count({ where: { clientId } }),
  ]);

  return { pending, enriched, notFound, notNeeded, total };
}

/**
 * Mark leads for enrichment (backfill)
 * Marks email leads missing LinkedIn or phone as 'pending' for enrichment
 * Returns number of leads marked
 */
export async function markLeadsForEnrichment(clientId: string): Promise<{ marked: number }> {
  // Find email leads that:
  // - Don't have enrichment status set yet (null)
  // - Are missing LinkedIn URL or phone
  // - Are NOT SMS-only (have email)
  const result = await prisma.lead.updateMany({
    where: {
      clientId,
      enrichmentStatus: null, // Not yet processed
      email: { not: null }, // Email leads only
      OR: [
        { linkedinUrl: null },
        { phone: null },
      ],
    },
    data: {
      enrichmentStatus: "pending",
    },
  });

  console.log(`[Enrichment] Marked ${result.count} leads for enrichment in workspace ${clientId}`);

  return { marked: result.count };
}

/**
 * Trigger immediate enrichment for a single lead (for batch/cron processing)
 */
export async function enrichSingleLead(leadId: string): Promise<{
  success: boolean;
  message: string;
}> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
  });

  if (!lead) {
    return { success: false, message: "Lead not found" };
  }

  if (!lead.email) {
    return { success: false, message: "Lead has no email address" };
  }

  const missingLinkedIn = !lead.linkedinUrl;
  const missingPhone = !lead.phone;

  if (!missingLinkedIn && !missingPhone) {
    return { success: false, message: "Lead already has both LinkedIn and phone" };
  }

  // Mark as pending
  await prisma.lead.update({
    where: { id: leadId },
    data: { enrichmentStatus: "pending" },
  });

  // Build enrichment request
  const enrichmentRequest: ClayEnrichmentRequest = {
    leadId: lead.id,
    emailAddress: lead.email,
    firstName: lead.firstName || undefined,
    lastName: lead.lastName || undefined,
    fullName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || undefined,
    companyName: lead.companyName || undefined,
    companyDomain: lead.companyWebsite || undefined,
    state: lead.companyState || undefined,
    linkedInProfile: lead.linkedinUrl || undefined,
  };

  // Trigger enrichment
  const result = await triggerEnrichmentForLead(enrichmentRequest, missingLinkedIn, missingPhone);

  if (result.linkedInSent || result.phoneSent) {
    return {
      success: true,
      message: `Enrichment triggered (LinkedIn: ${result.linkedInSent}, Phone: ${result.phoneSent})`,
    };
  } else {
    return {
      success: false,
      message: "Enrichment request failed or rate limited",
    };
  }
}

/**
 * Reset failed enrichments to pending for retry
 */
export async function resetFailedEnrichments(clientId: string): Promise<{ reset: number }> {
  const result = await prisma.lead.updateMany({
    where: {
      clientId,
      enrichmentStatus: "not_found",
      // Only reset recent failures (within last 30 days)
      enrichedAt: {
        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
    },
    data: {
      enrichmentStatus: "pending",
      enrichedAt: null,
    },
  });

  return { reset: result.count };
}

export interface RefreshEnrichmentResult {
  success: boolean;
  error?: string;
  // What was found from EmailBison
  fromEmailBison: {
    linkedinUrl: string | null;
    phone: string | null;
    companyName: string | null;
    companyWebsite: string | null;
    companyState: string | null;
  };
  // What Clay enrichment was triggered
  clayTriggered: {
    linkedin: boolean;
    phone: boolean;
  };
}

/**
 * Refresh lead data from EmailBison and trigger Clay enrichment if needed
 * This is the main enrichment action called from the UI
 * 
 * Flow:
 * 1. Fetch lead from DB to get emailBisonLeadId
 * 2. Fetch custom variables from EmailBison API
 * 3. Extract and normalize: linkedin url, phone, website, company state, company
 * 4. Update lead in DB with extracted data
 * 5. If LinkedIn or phone still missing, trigger Clay enrichment (LinkedIn first, phone second)
 */
export async function refreshAndEnrichLead(leadId: string): Promise<RefreshEnrichmentResult> {
  const result: RefreshEnrichmentResult = {
    success: false,
    fromEmailBison: {
      linkedinUrl: null,
      phone: null,
      companyName: null,
      companyWebsite: null,
      companyState: null,
    },
    clayTriggered: {
      linkedin: false,
      phone: false,
    },
  };

  // 1. Fetch lead from DB
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      client: {
        select: {
          emailBisonApiKey: true,
        },
      },
    },
  });

  if (!lead) {
    return { ...result, error: "Lead not found" };
  }

  // Check if lead has emailBisonLeadId (required for EmailBison API call)
  if (!lead.emailBisonLeadId) {
    return { ...result, error: "No EmailBison lead ID - cannot fetch enrichment data" };
  }

  // Check if client has EmailBison API key
  if (!lead.client.emailBisonApiKey) {
    return { ...result, error: "No EmailBison API key configured for this workspace" };
  }

  // 2. Fetch lead details from EmailBison API
  const emailBisonResult = await fetchEmailBisonLead(
    lead.client.emailBisonApiKey,
    lead.emailBisonLeadId
  );

  if (!emailBisonResult.success || !emailBisonResult.data) {
    return { ...result, error: emailBisonResult.error || "Failed to fetch EmailBison lead data" };
  }

  const customVars = emailBisonResult.data.custom_variables;

  // 3. Extract custom variables
  const extractedLinkedIn = getCustomVariable(customVars, "linkedin url");
  const extractedPhone = getCustomVariable(customVars, "phone");
  const extractedWebsite = getCustomVariable(customVars, "website");
  const extractedCompanyState = getCustomVariable(customVars, "company state");
  const extractedCompanyName = emailBisonResult.data.company || getCustomVariable(customVars, "company");

  // Normalize the extracted data
  const normalizedLinkedIn = normalizeLinkedInUrl(extractedLinkedIn);
  const normalizedPhone = normalizePhone(extractedPhone);

  result.fromEmailBison = {
    linkedinUrl: normalizedLinkedIn,
    phone: normalizedPhone,
    companyName: extractedCompanyName || null,
    companyWebsite: extractedWebsite || null,
    companyState: extractedCompanyState || null,
  };

  // 4. Update lead in DB with extracted data
  const updateData: {
    linkedinUrl?: string;
    phone?: string;
    companyName?: string;
    companyWebsite?: string;
    companyState?: string;
    enrichmentSource?: string;
    enrichedAt?: Date;
  } = {};

  // Only update if we found new data that the lead doesn't have
  if (normalizedLinkedIn && !lead.linkedinUrl) {
    updateData.linkedinUrl = normalizedLinkedIn;
  }
  if (normalizedPhone && !lead.phone) {
    updateData.phone = normalizedPhone;
  }
  if (extractedCompanyName && !lead.companyName) {
    updateData.companyName = extractedCompanyName;
  }
  if (extractedWebsite && !lead.companyWebsite) {
    updateData.companyWebsite = extractedWebsite;
  }
  if (extractedCompanyState && !lead.companyState) {
    updateData.companyState = extractedCompanyState;
  }

  if (Object.keys(updateData).length > 0) {
    updateData.enrichmentSource = "emailbison";
    updateData.enrichedAt = new Date();

    await prisma.lead.update({
      where: { id: leadId },
      data: updateData,
    });

    console.log(`[Enrichment] Updated lead ${leadId} with EmailBison data:`, updateData);
  }

  // 5. Check if LinkedIn or phone is still missing after EmailBison update
  const currentLinkedIn = updateData.linkedinUrl || lead.linkedinUrl;
  const currentPhone = updateData.phone || lead.phone;

  const missingLinkedIn = !currentLinkedIn;
  const missingPhone = !currentPhone;

  // 6. If still missing data, trigger Clay enrichment
  if (missingLinkedIn || missingPhone) {
    // Build enrichment request with all available data
    const enrichmentRequest: ClayEnrichmentRequest = {
      leadId: lead.id,
      emailAddress: lead.email || "",
      firstName: lead.firstName || undefined,
      lastName: lead.lastName || undefined,
      fullName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || undefined,
      companyName: updateData.companyName || lead.companyName || undefined,
      companyDomain: updateData.companyWebsite || lead.companyWebsite || undefined,
      state: updateData.companyState || lead.companyState || undefined,
      linkedInProfile: currentLinkedIn || undefined,
    };

    // Mark as pending enrichment with timestamp for timeout tracking
    await prisma.lead.update({
      where: { id: leadId },
      data: { 
        enrichmentStatus: "pending",
        enrichmentLastRetry: new Date(), // Initialize for follow-up engine timeout calculations
      },
    });

    // Trigger Clay enrichment (LinkedIn first, phone second as specified)
    const clayResult = await triggerEnrichmentForLead(enrichmentRequest, missingLinkedIn, missingPhone);

    result.clayTriggered = {
      linkedin: clayResult.linkedInSent,
      phone: clayResult.phoneSent,
    };

    console.log(`[Enrichment] Triggered Clay enrichment for lead ${leadId}:`, result.clayTriggered);
  } else {
    // Lead has all data, mark as not needed for enrichment
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        enrichmentStatus: "not_needed",
        enrichedAt: new Date(),
      },
    });
  }

  result.success = true;
  return result;
}
