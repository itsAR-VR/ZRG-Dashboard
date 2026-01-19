/**
 * Round-robin lead assignment logic (Phase 43)
 *
 * When a lead transitions to a positive sentiment, it gets automatically
 * assigned to the next setter in rotation. Assignment is one-time (once
 * assigned, a lead stays with that setter).
 */

import { prisma } from "@/lib/prisma";
import { ClientMemberRole } from "@prisma/client";
import { POSITIVE_SENTIMENTS, isPositiveSentiment } from "@/lib/sentiment-shared";

/**
 * Check if a sentiment tag should trigger lead assignment.
 * Uses the shared POSITIVE_SENTIMENTS constant for consistency.
 */
export function shouldAssignLead(sentimentTag: string | null): boolean {
  return isPositiveSentiment(sentimentTag);
}

/**
 * Get active setters for a workspace, sorted by createdAt ASC.
 * This ordering ensures deterministic rotation matching stakeholder expectations
 * (e.g., Vanessa → David → Jon based on account creation order).
 */
async function getActiveSetters(clientId: string) {
  return prisma.clientMember.findMany({
    where: {
      clientId,
      role: ClientMemberRole.SETTER,
    },
    orderBy: { createdAt: "asc" }, // Deterministic order by creation time
    select: { userId: true },
  });
}

/**
 * Attempt to assign a lead to the next setter in round-robin rotation.
 *
 * Uses an interactive transaction to ensure atomicity:
 * 1. Check if lead is already assigned (skip if so)
 * 2. Calculate next setter index
 * 3. Update lead AND workspace settings in same transaction
 *
 * The updateMany with `assignedToUserId: null` ensures idempotency —
 * concurrent calls won't double-assign or drift the pointer.
 *
 * @returns The assigned setter's userId, or null if assignment was skipped
 */
export async function assignLeadRoundRobin({
  leadId,
  clientId,
}: {
  leadId: string;
  clientId: string;
}): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    // 1. Check if round-robin is enabled and get current state
    const settings = await tx.workspaceSettings.findUnique({
      where: { clientId },
      select: { roundRobinEnabled: true, roundRobinLastSetterIndex: true },
    });

    if (!settings?.roundRobinEnabled) {
      return null; // Round-robin not enabled for this workspace
    }

    // 2. Check if lead is already assigned
    const lead = await tx.lead.findUnique({
      where: { id: leadId },
      select: { assignedToUserId: true },
    });

    if (lead?.assignedToUserId) {
      // Already assigned — don't reassign or advance pointer
      return lead.assignedToUserId;
    }

    // 3. Get active setters
    const setters = await tx.clientMember.findMany({
      where: {
        clientId,
        role: ClientMemberRole.SETTER,
      },
      orderBy: { createdAt: "asc" },
      select: { userId: true },
    });

    if (setters.length === 0) {
      console.warn(`[LeadAssignment] No active setters for client ${clientId}`);
      return null;
    }

    // 4. Calculate next setter index
    const lastIndex = settings.roundRobinLastSetterIndex ?? -1;
    const nextIndex = (lastIndex + 1) % setters.length;
    const nextSetter = setters[nextIndex];
    const now = new Date();

    // 5. Atomic update: assign lead (only if still unassigned) + update index
    const updateResult = await tx.lead.updateMany({
      where: {
        id: leadId,
        assignedToUserId: null, // Idempotency guard
      },
      data: {
        assignedToUserId: nextSetter.userId,
        assignedAt: now,
      },
    });

    // Only advance the pointer if we actually assigned
    if (updateResult.count > 0) {
      await tx.workspaceSettings.update({
        where: { clientId },
        data: { roundRobinLastSetterIndex: nextIndex },
      });

      console.log(
        `[LeadAssignment] Assigned lead ${leadId} to setter ${nextSetter.userId} (index ${nextIndex})`
      );

      return nextSetter.userId;
    }

    // Lead was assigned by a concurrent call — return the current assignee
    const refreshedLead = await tx.lead.findUnique({
      where: { id: leadId },
      select: { assignedToUserId: true },
    });

    return refreshedLead?.assignedToUserId ?? null;
  });
}

/**
 * Conditionally assign a lead if it meets assignment criteria.
 *
 * This is the main entry point for background job integration:
 * - Checks if the lead is already assigned (skip if so)
 * - Checks if the sentiment triggers assignment
 * - Performs round-robin assignment if conditions are met
 *
 * @returns The assigned setter's userId, or null if assignment was skipped
 */
export async function maybeAssignLead({
  leadId,
  clientId,
  sentimentTag,
}: {
  leadId: string;
  clientId: string;
  sentimentTag: string | null;
}): Promise<string | null> {
  // Quick check: only assign if sentiment is positive
  if (!shouldAssignLead(sentimentTag)) {
    return null;
  }

  return assignLeadRoundRobin({ leadId, clientId });
}

/**
 * Bulk assign unassigned positive leads (for backfill).
 *
 * Processes leads one at a time to maintain round-robin fairness.
 * Uses the standard round-robin logic for each assignment.
 */
export async function backfillLeadAssignments(clientId: string): Promise<{
  assigned: number;
  skipped: number;
  errors: number;
}> {
  // Find all unassigned leads with positive sentiment
  const unassignedLeads = await prisma.lead.findMany({
    where: {
      clientId,
      assignedToUserId: null,
      sentimentTag: { in: [...POSITIVE_SENTIMENTS] },
    },
    orderBy: { lastInboundAt: "desc" }, // Most recent first
    select: { id: true },
  });

  let assigned = 0;
  let skipped = 0;
  let errors = 0;

  console.log(
    `[LeadAssignment] Backfill starting for ${clientId}: ${unassignedLeads.length} candidates`
  );

  for (const lead of unassignedLeads) {
    try {
      const result = await assignLeadRoundRobin({ leadId: lead.id, clientId });
      if (result) {
        assigned++;
      } else {
        skipped++;
      }
    } catch (error) {
      console.error(
        `[LeadAssignment] Backfill error for lead ${lead.id}:`,
        error instanceof Error ? error.message : error
      );
      errors++;
    }
  }

  console.log(
    `[LeadAssignment] Backfill complete for ${clientId}: ${assigned} assigned, ${skipped} skipped, ${errors} errors`
  );

  return { assigned, skipped, errors };
}
