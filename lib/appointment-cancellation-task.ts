/**
 * Appointment Cancellation Task Creation (Phase 28 follow-up)
 *
 * Creates FollowUpTasks when meeting cancellations/reschedules are detected,
 * surfacing them for manual review or re-booking.
 *
 * Task types:
 * - `meeting-canceled`: Meeting was canceled (lead needs re-booking follow-up)
 * - `meeting-rescheduled`: Meeting was rescheduled (informational, may need review)
 *
 * These tasks are rendered with a "red" indicator in the Follow-ups UI.
 */

import { prisma } from "@/lib/prisma";

export type CancellationTaskType = "meeting-canceled" | "meeting-rescheduled";

export interface CreateCancellationTaskOptions {
  leadId: string;
  taskType: CancellationTaskType;
  appointmentStartTime?: Date | string | null;
  /** Provider that detected the cancellation (GHL or Calendly) */
  provider?: "GHL" | "CALENDLY";
  /** Skip creation if a similar pending task already exists */
  skipIfExists?: boolean;
}

/**
 * Creates a FollowUpTask for a meeting cancellation or reschedule event.
 *
 * This surfaces the cancellation in the Follow-ups UI so operators can
 * take action (reach out to re-book, or review the situation).
 */
export async function createCancellationTask(
  opts: CreateCancellationTaskOptions
): Promise<{ created: boolean; taskId?: string; skippedReason?: string }> {
  const { leadId, taskType, appointmentStartTime, provider, skipIfExists = true } = opts;

  // Check if a similar pending task already exists
  if (skipIfExists) {
    const existingTask = await prisma.followUpTask.findFirst({
      where: {
        leadId,
        type: taskType,
        status: "pending",
      },
      select: { id: true },
    });

    if (existingTask) {
      return {
        created: false,
        taskId: existingTask.id,
        skippedReason: "Pending task already exists",
      };
    }
  }

  // Build suggested message based on task type
  let suggestedMessage: string;

  if (taskType === "meeting-canceled") {
    if (appointmentStartTime) {
      const startDate =
        typeof appointmentStartTime === "string" ? new Date(appointmentStartTime) : appointmentStartTime;
      const formatted = startDate.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      suggestedMessage = `Meeting originally scheduled for ${formatted} was canceled. Follow up to reschedule.`;
    } else {
      suggestedMessage = "Meeting was canceled. Follow up to reschedule.";
    }
  } else {
    // meeting-rescheduled
    suggestedMessage = "Meeting was rescheduled. Review and confirm the new time with the lead.";
  }

  // Add provider context if available
  if (provider) {
    suggestedMessage += ` (Detected via ${provider})`;
  }

  // Create the task with due date = now (immediate attention needed)
  const task = await prisma.followUpTask.create({
    data: {
      leadId,
      type: taskType,
      dueDate: new Date(),
      status: "pending",
      suggestedMessage,
    },
    select: { id: true },
  });

  return { created: true, taskId: task.id };
}

/**
 * Check if a task type should show a "red" indicator in the UI.
 * Used by the Follow-ups UI to style urgent/attention-needed tasks.
 */
export function isRedIndicatorTaskType(taskType: string): boolean {
  return taskType === "meeting-canceled" || taskType === "meeting-rescheduled";
}

/**
 * Get all "red indicator" task types for filtering.
 */
export const RED_INDICATOR_TASK_TYPES: CancellationTaskType[] = [
  "meeting-canceled",
  "meeting-rescheduled",
];
