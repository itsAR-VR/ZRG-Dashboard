/**
 * Round-robin lead assignment logic (Phase 43)
 *
 * When a lead transitions to a positive sentiment, it gets automatically
 * assigned to the next setter in rotation. Assignment is one-time (once
 * assigned, a lead stays with that setter).
 */

import { prisma, isPrismaUniqueConstraintError } from "@/lib/prisma";
import { ClientMemberRole } from "@prisma/client";
import { POSITIVE_SENTIMENTS, isPositiveSentiment } from "@/lib/sentiment-shared";
import { slackPostMessage } from "@/lib/slack-bot";
import { getPublicAppUrl } from "@/lib/app-url";

export type LeadAssignmentChannel = "sms" | "email" | "linkedin";
export type LeadAssignmentSource = "round_robin" | "backfill" | "manual";

/**
 * Check if a sentiment tag should trigger lead assignment.
 * Uses the shared POSITIVE_SENTIMENTS constant for consistency.
 */
export function shouldAssignLead(sentimentTag: string | null): boolean {
  return isPositiveSentiment(sentimentTag);
}

export function getNextRoundRobinIndex(lastIndex: number | null | undefined, length: number): number {
  if (length <= 0) return -1;
  const safeLastIndex = typeof lastIndex === "number" ? lastIndex : -1;
  return (safeLastIndex + 1) % length;
}

export function computeEffectiveSetterSequence(opts: {
  activeSetterUserIds: string[];
  configuredSequence: string[] | null | undefined;
}): string[] {
  const configured = Array.isArray(opts.configuredSequence) ? opts.configuredSequence : [];
  if (configured.length === 0) return opts.activeSetterUserIds;

  const activeSet = new Set(opts.activeSetterUserIds);
  return configured.filter((userId) => activeSet.has(userId));
}

export function isChannelEligibleForLeadAssignment(opts: {
  emailOnly: boolean;
  channel?: LeadAssignmentChannel;
}): boolean {
  if (!opts.emailOnly) return true;
  return opts.channel === "email";
}

type RoundRobinSequenceEmptyAlert = {
  clientId: string;
  leadId: string;
  channel?: LeadAssignmentChannel;
  configuredSequenceLength: number;
  activeSetterCount: number;
};

type LeadAssignmentAuditPayload = {
  clientId: string;
  leadId: string;
  assignedToUserId: string;
  channel?: LeadAssignmentChannel;
  source: LeadAssignmentSource;
};

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
  channel,
  source,
}: {
  leadId: string;
  clientId: string;
  channel?: LeadAssignmentChannel;
  source?: LeadAssignmentSource;
}): Promise<string | null> {
  const assignmentSource = source ?? "round_robin";
  let sequenceEmptyAlert: RoundRobinSequenceEmptyAlert | null = null;
  let assignmentEvent: LeadAssignmentAuditPayload | null = null;

  const assignedToUserId = await prisma.$transaction(async (tx) => {
    // Concurrency hardening: lock the workspace settings row before reading/updating the pointer.
    // This avoids pointer drift under concurrent assignments.
    await tx.$executeRaw`SELECT 1 FROM "WorkspaceSettings" WHERE "clientId" = ${clientId} FOR UPDATE`;

    // 1. Check if round-robin is enabled and get current state
    const settings = await tx.workspaceSettings.findUnique({
      where: { clientId },
      select: {
        roundRobinEnabled: true,
        roundRobinLastSetterIndex: true,
        roundRobinSetterSequence: true,
        roundRobinEmailOnly: true,
      },
    });

    if (!settings?.roundRobinEnabled) {
      return null; // Round-robin not enabled for this workspace
    }

    if (!isChannelEligibleForLeadAssignment({ emailOnly: settings.roundRobinEmailOnly, channel })) {
      return null; // Workspace is email-only; skip SMS/LinkedIn-triggered assignments
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

    const activeSetterUserIds = setters.map((s) => s.userId);
    const effectiveSequence = computeEffectiveSetterSequence({
      activeSetterUserIds,
      configuredSequence: settings.roundRobinSetterSequence,
    });

    if (effectiveSequence.length === 0) {
      console.warn(`[LeadAssignment] No eligible setters in configured sequence for client ${clientId}`);
      if (settings.roundRobinSetterSequence.length > 0) {
        sequenceEmptyAlert = {
          clientId,
          leadId,
          channel,
          configuredSequenceLength: settings.roundRobinSetterSequence.length,
          activeSetterCount: activeSetterUserIds.length,
        };
      }
      return null;
    }

    const nextIndex = getNextRoundRobinIndex(settings.roundRobinLastSetterIndex, effectiveSequence.length);
    const nextSetterUserId = effectiveSequence[nextIndex];
    const now = new Date();

    // 5. Atomic update: assign lead (only if still unassigned) + update index
    const updateResult = await tx.lead.updateMany({
      where: {
        id: leadId,
        assignedToUserId: null, // Idempotency guard
      },
      data: {
        assignedToUserId: nextSetterUserId,
        assignedAt: now,
      },
    });

    // Only advance the pointer if we actually assigned
    if (updateResult.count > 0) {
      await tx.workspaceSettings.update({
        where: { clientId },
        data: { roundRobinLastSetterIndex: nextIndex },
      });

      assignmentEvent = {
        clientId,
        leadId,
        assignedToUserId: nextSetterUserId,
        channel,
        source: assignmentSource,
      };

      console.log(
        `[LeadAssignment] Assigned lead ${leadId} to setter ${nextSetterUserId} (index ${nextIndex}, sequence=${
          settings.roundRobinSetterSequence.length > 0 ? "custom" : "fallback"
        })`
      );

      return nextSetterUserId;
    }

    // Lead was assigned by a concurrent call — return the current assignee
    const refreshedLead = await tx.lead.findUnique({
      where: { id: leadId },
      select: { assignedToUserId: true },
    });

    return refreshedLead?.assignedToUserId ?? null;
  });

  if (sequenceEmptyAlert) {
    notifyRoundRobinSequenceEmpty(sequenceEmptyAlert).catch((error) => {
      console.error("[LeadAssignment] Failed to send sequence-empty alert:", error);
    });
  }

  if (assignmentEvent) {
    recordLeadAssignmentEvent(assignmentEvent).catch((error) => {
      console.error("[LeadAssignment] Failed to record assignment event:", error);
    });
  }

  return assignedToUserId;
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
  channel,
}: {
  leadId: string;
  clientId: string;
  sentimentTag: string | null;
  channel: LeadAssignmentChannel;
}): Promise<string | null> {
  // Quick check: only assign if sentiment is positive
  if (!shouldAssignLead(sentimentTag)) {
    return null;
  }

  return assignLeadRoundRobin({ leadId, clientId, channel });
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
  const settings = await prisma.workspaceSettings.findUnique({
    where: { clientId },
    select: { roundRobinEmailOnly: true },
  });

  const emailOnly = Boolean(settings?.roundRobinEmailOnly);

  // Find all unassigned leads with positive sentiment
  const unassignedLeads = await prisma.lead.findMany({
    where: {
      clientId,
      assignedToUserId: null,
      sentimentTag: { in: [...POSITIVE_SENTIMENTS] },
      ...(emailOnly
        ? {
          OR: [{ emailBisonLeadId: { not: null } }, { emailCampaignId: { not: null } }],
        }
        : {}),
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
      const result = await assignLeadRoundRobin({
        leadId: lead.id,
        clientId,
        channel: "email",
        source: "backfill",
      });
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

function formatLeadLabel(lead: { firstName: string | null; lastName: string | null; email: string | null }): string {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (lead.email) return lead.email;
  return "Lead";
}

function buildLeadUrl(leadId: string): string {
  const base = getPublicAppUrl();
  return `${base}/?view=inbox&leadId=${encodeURIComponent(leadId)}`;
}

async function recordLeadAssignmentEvent(payload: LeadAssignmentAuditPayload): Promise<void> {
  await prisma.leadAssignmentEvent.create({
    data: {
      clientId: payload.clientId,
      leadId: payload.leadId,
      assignedToUserId: payload.assignedToUserId,
      assignedByUserId: null,
      source: payload.source,
      channel: payload.channel ?? null,
    },
  });
}

async function logRoundRobinSequenceEmptyOnce(opts: {
  clientId: string;
  leadId: string;
  dedupeKey: string;
}): Promise<boolean> {
  try {
    await prisma.notificationSendLog.create({
      data: {
        clientId: opts.clientId,
        leadId: opts.leadId,
        kind: "round_robin_sequence_empty",
        destination: "slack",
        dedupeKey: opts.dedupeKey,
      },
    });
    return true;
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) return false;
    console.error("[LeadAssignment] Failed to log sequence-empty alert:", error);
    return false;
  }
}

async function notifyRoundRobinSequenceEmpty(alert: RoundRobinSequenceEmptyAlert): Promise<void> {
  const [client, settings, lead] = await Promise.all([
    prisma.client.findUnique({
      where: { id: alert.clientId },
      select: { id: true, name: true, slackBotToken: true },
    }),
    prisma.workspaceSettings.findUnique({
      where: { clientId: alert.clientId },
      select: { slackAlerts: true, notificationSlackChannelIds: true },
    }),
    prisma.lead.findUnique({
      where: { id: alert.leadId },
      select: { id: true, firstName: true, lastName: true, email: true },
    }),
  ]);

  if (!client || !settings) return;
  if (settings.slackAlerts === false) return;

  const channelIds = (settings.notificationSlackChannelIds ?? [])
    .map((id) => (id || "").trim())
    .filter(Boolean);

  if (!client.slackBotToken || channelIds.length === 0) return;

  const dayKey = new Date().toISOString().slice(0, 10);
  const dedupeKey = `round_robin_sequence_empty:${alert.clientId}:slack:${dayKey}`;
  const gate = await logRoundRobinSequenceEmptyOnce({
    clientId: alert.clientId,
    leadId: alert.leadId,
    dedupeKey,
  });
  if (!gate) return;

  const leadLabel = lead ? formatLeadLabel(lead) : `Lead ${alert.leadId}`;
  const leadUrl = buildLeadUrl(alert.leadId);
  const text = [
    "⚠️ Round-robin sequence empty after filtering",
    `Workspace: ${client.name}`,
    `Lead: ${leadLabel}`,
    `Lead Link: ${leadUrl}`,
    `Channel: ${alert.channel ?? "unknown"}`,
    `Configured sequence length: ${alert.configuredSequenceLength}`,
    `Active setters: ${alert.activeSetterCount}`,
    "Action: Update sequence in Settings → Integrations → Assignments.",
  ].join("\n");

  for (const channelId of channelIds) {
    const res = await slackPostMessage({ token: client.slackBotToken, channelId, text });
    if (!res.success) {
      console.error("[LeadAssignment] Slack alert failed:", res.error);
    }
  }
}
