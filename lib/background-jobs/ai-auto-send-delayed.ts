import "server-only";

/**
 * AI Auto-Send Delayed Job Runner (Phase 47l)
 *
 * Executes delayed auto-send jobs scheduled by the background job system.
 * Validates that the send is still appropriate before executing.
 */

import { validateDelayedAutoSend } from "@/lib/background-jobs/delayed-auto-send";
import { approveAndSendDraftSystem } from "@/actions/message-actions";
import { prisma } from "@/lib/prisma";
import { RescheduleBackgroundJobError } from "@/lib/background-jobs/errors";
import {
  getNextAutoSendWindow,
  isWithinAutoSendSchedule,
  resolveAutoSendScheduleConfig,
} from "@/lib/auto-send-schedule";

export interface AiAutoSendDelayedJobParams {
  clientId: string;
  leadId: string;
  messageId: string;
  draftId: string | null;
}

export async function runAiAutoSendDelayedJob(
  params: AiAutoSendDelayedJobParams
): Promise<void> {
  const { leadId, messageId, draftId } = params;

  if (!draftId) {
    console.warn("[AiAutoSendDelayed] Job has no draftId, skipping");
    return;
  }

  // Validate that it's still safe to send
  const validation = await validateDelayedAutoSend({
    leadId,
    triggerMessageId: messageId,
    draftId,
  });

  if (!validation.proceed) {
    console.log(
      `[AiAutoSendDelayed] Skipping job for draft ${draftId}: ${validation.reason}`
    );
    // Return successfully (job is "done" - we just chose not to send)
    return;
  }

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      timezone: true,
      emailCampaign: {
        select: {
          autoSendScheduleMode: true,
          autoSendCustomSchedule: true,
        },
      },
      client: {
        select: {
          settings: {
            select: {
              timezone: true,
              workStartTime: true,
              workEndTime: true,
              autoSendScheduleMode: true,
              autoSendCustomSchedule: true,
            },
          },
        },
      },
    },
  });

  const scheduleConfig = resolveAutoSendScheduleConfig(
    lead?.client?.settings ?? null,
    lead?.emailCampaign ?? null,
    lead?.timezone ?? null
  );
  const scheduleCheck = isWithinAutoSendSchedule(scheduleConfig);
  if (!scheduleCheck.withinSchedule) {
    const nextWindow = scheduleCheck.nextWindowStart || getNextAutoSendWindow(scheduleConfig);
    throw new RescheduleBackgroundJobError(nextWindow, `outside_schedule:${scheduleCheck.reason}`);
  }

  // Execute the send
  console.log(`[AiAutoSendDelayed] Sending draft ${draftId}`);

  const result = await approveAndSendDraftSystem(draftId, {
    sentBy: "ai",
  });

  if (!result.success) {
    // Throw to trigger retry (unless it's a terminal error)
    const error = result.error || "Unknown error";

    // Terminal errors that shouldn't retry
    const terminalErrors = [
      "Draft not found",
      "Draft is not pending",
      "Lead not found",
    ];

    if (terminalErrors.some((te) => error.includes(te))) {
      console.warn(`[AiAutoSendDelayed] Terminal error for draft ${draftId}: ${error}`);
      return; // Don't retry
    }

    throw new Error(`Failed to send draft: ${error}`);
  }

  console.log(`[AiAutoSendDelayed] Successfully sent draft ${draftId}`);
}
