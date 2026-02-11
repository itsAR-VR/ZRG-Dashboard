import "server-only";

/**
 * Delayed Auto-Send Scheduling (Phase 47l)
 *
 * Provides utilities for scheduling AI auto-send jobs with configurable delays.
 * Jobs are enqueued with a future `runAt` time and processed by the background job runner.
 */

import { BackgroundJobType } from "@prisma/client";
import { prisma, isPrismaUniqueConstraintError } from "@/lib/prisma";

export interface DelayedAutoSendParams {
  clientId: string;
  leadId: string;
  /** The inbound message that triggered the draft */
  triggerMessageId: string;
  /** The draft to send */
  draftId: string;
  /** Minimum delay in seconds (from inbound message time) */
  delayMinSeconds: number;
  /** Maximum delay in seconds (from inbound message time) */
  delayMaxSeconds: number;
  /** The inbound message's sentAt timestamp */
  inboundSentAt: Date;
}

/**
 * Compute a deterministic pseudo-random delay within the configured window.
 * Uses the messageId as a seed for determinism (retries compute same runAt).
 */
function computeDeterministicDelay(
  messageId: string,
  minSeconds: number,
  maxSeconds: number
): number {
  // Simple hash from messageId for deterministic randomness
  let hash = 0;
  for (let i = 0; i < messageId.length; i++) {
    const char = messageId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  hash = Math.abs(hash);

  // Map to range [minSeconds, maxSeconds] inclusive
  const range = maxSeconds - minSeconds;
  if (range <= 0) return minSeconds;

  return minSeconds + (hash % (range + 1));
}

export function computeChosenDelaySeconds(
  triggerMessageId: string,
  minSeconds: number,
  maxSeconds: number
): number {
  return computeDeterministicDelay(triggerMessageId, minSeconds, maxSeconds);
}

export function computeDelayedAutoSendRunAt(params: {
  triggerMessageId: string;
  inboundSentAt: Date;
  delayMinSeconds: number;
  delayMaxSeconds: number;
}): Date {
  const { triggerMessageId, inboundSentAt, delayMinSeconds, delayMaxSeconds } = params;
  const delaySeconds = computeDeterministicDelay(triggerMessageId, delayMinSeconds, delayMaxSeconds);
  const runAt = new Date(inboundSentAt.getTime() + delaySeconds * 1000);
  const now = new Date();
  return runAt < now ? new Date(now.getTime() + 30_000) : runAt;
}

export async function scheduleAutoSendAt(params: {
  clientId: string;
  leadId: string;
  triggerMessageId: string;
  draftId: string;
  runAt: Date;
}): Promise<{ scheduled: boolean; runAt?: Date; skipReason?: string }> {
  const { clientId, leadId, triggerMessageId, draftId, runAt } = params;
  const dedupeKey = `${clientId}:${triggerMessageId}:${BackgroundJobType.AI_AUTO_SEND_DELAYED}:${draftId}`;

  try {
    await prisma.backgroundJob.create({
      data: {
        type: BackgroundJobType.AI_AUTO_SEND_DELAYED,
        clientId,
        leadId,
        messageId: triggerMessageId,
        draftId,
        dedupeKey,
        status: "PENDING",
        runAt,
        maxAttempts: 3,
        attempts: 0,
      },
    });

    console.log(
      `[DelayedAutoSend] Scheduled job for draft ${draftId}, runAt: ${runAt.toISOString()}`
    );

    return { scheduled: true, runAt };
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      console.log(`[DelayedAutoSend] Job already scheduled (dedupe): ${dedupeKey}`);
      return { scheduled: false, skipReason: "already_scheduled" };
    }

    throw error;
  }
}

/**
 * Schedule a delayed auto-send job.
 * Returns true if job was enqueued, false if duplicate or delay is zero.
 *
 * When delay window is 0, returns false to signal immediate send should be used instead.
 */
export async function scheduleDelayedAutoSend(
  params: DelayedAutoSendParams
): Promise<{ scheduled: boolean; runAt?: Date; skipReason?: string }> {
  const {
    clientId,
    leadId,
    triggerMessageId,
    draftId,
    delayMinSeconds,
    delayMaxSeconds,
    inboundSentAt,
  } = params;

  // If delay window is 0, skip scheduling (use immediate send)
  if (delayMinSeconds === 0 && delayMaxSeconds === 0) {
    return { scheduled: false, skipReason: "delay_window_zero" };
  }

  const effectiveRunAt = computeDelayedAutoSendRunAt({
    triggerMessageId,
    inboundSentAt,
    delayMinSeconds,
    delayMaxSeconds,
  });

  const scheduleResult = await scheduleAutoSendAt({
    clientId,
    leadId,
    triggerMessageId,
    draftId,
    runAt: effectiveRunAt,
  });

  if (scheduleResult.scheduled && scheduleResult.runAt) {
    const delaySeconds = Math.max(
      0,
      Math.round((scheduleResult.runAt.getTime() - inboundSentAt.getTime()) / 1000)
    );
    console.log(
      `[DelayedAutoSend] Scheduled job for draft ${draftId}, runAt: ${scheduleResult.runAt.toISOString()} (delay: ${delaySeconds}s)`
    );
  }

  return scheduleResult;
}

/**
 * Check if a delayed auto-send should be executed.
 * Validates that the trigger inbound is still the "active" inbound (no newer messages).
 *
 * Returns { proceed: true } if safe to send, or { proceed: false, reason } if should skip.
 */
export async function validateDelayedAutoSend(params: {
  leadId: string;
  triggerMessageId: string;
  draftId: string;
}): Promise<{ proceed: boolean; reason?: string }> {
  const { leadId, triggerMessageId, draftId } = params;

  // 1. Check draft is still pending
  const draft = await prisma.aIDraft.findUnique({
    where: { id: draftId },
    select: { status: true, leadId: true },
  });

  if (!draft) {
    return { proceed: false, reason: "draft_not_found" };
  }

  if (draft.status !== "pending") {
    return { proceed: false, reason: `draft_status_${draft.status}` };
  }

  if (draft.leadId !== leadId) {
    return { proceed: false, reason: "draft_lead_mismatch" };
  }

  // 2. Get the trigger message timestamp
  const triggerMessage = await prisma.message.findUnique({
    where: { id: triggerMessageId },
    select: { sentAt: true },
  });

  if (!triggerMessage) {
    return { proceed: false, reason: "trigger_message_not_found" };
  }

  // 3. Check for any newer inbound messages (cross-channel)
  const newerInbound = await prisma.message.findFirst({
    where: {
      leadId,
      direction: "inbound",
      sentAt: { gt: triggerMessage.sentAt },
    },
    select: { id: true },
  });

  if (newerInbound) {
    return { proceed: false, reason: "newer_inbound_exists" };
  }

  // 4. Check for any outbound messages after the trigger (manual send cancels auto-send)
  const outboundAfterTrigger = await prisma.message.findFirst({
    where: {
      leadId,
      direction: "outbound",
      sentAt: { gt: triggerMessage.sentAt },
    },
    select: { id: true },
  });

  if (outboundAfterTrigger) {
    return { proceed: false, reason: "outbound_after_trigger" };
  }

  // 5. Check lead/campaign is still in AI auto-send mode
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      emailCampaign: {
        select: { responseMode: true },
      },
    },
  });

  if (!lead?.emailCampaign) {
    return { proceed: false, reason: "no_campaign" };
  }

  if (lead.emailCampaign.responseMode !== "AI_AUTO_SEND") {
    return { proceed: false, reason: "campaign_not_ai_auto_send" };
  }

  return { proceed: true };
}

/**
 * Get delay configuration for a campaign.
 * Returns null if campaign not found or not in AI_AUTO_SEND mode.
 */
export async function getCampaignDelayConfig(campaignId: string): Promise<{
  delayMinSeconds: number;
  delayMaxSeconds: number;
} | null> {
  const campaign = await prisma.emailCampaign.findUnique({
    where: { id: campaignId },
    select: {
      responseMode: true,
      autoSendDelayMinSeconds: true,
      autoSendDelayMaxSeconds: true,
    },
  });

  if (!campaign || campaign.responseMode !== "AI_AUTO_SEND") {
    return null;
  }

  return {
    delayMinSeconds: campaign.autoSendDelayMinSeconds,
    delayMaxSeconds: campaign.autoSendDelayMaxSeconds,
  };
}
