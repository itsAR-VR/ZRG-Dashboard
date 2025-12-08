"use server";

/**
 * Server actions for lead enrichment management
 * Provides manual triggers for backfill and status checking
 */

import { prisma } from "@/lib/prisma";
import { triggerEnrichmentForLead } from "@/lib/clay-api";

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
 * Trigger immediate enrichment for a single lead
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

  // Trigger enrichment
  const result = await triggerEnrichmentForLead(
    lead.id,
    lead.email,
    lead.firstName || undefined,
    lead.lastName || undefined,
    undefined,
    missingLinkedIn,
    missingPhone
  );

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
