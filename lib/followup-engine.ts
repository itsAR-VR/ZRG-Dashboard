import { prisma } from "@/lib/prisma";
import { generateResponseDraft } from "@/lib/ai-drafts";
import type { FollowUpStepData, StepCondition } from "@/actions/followup-sequence-actions";

// =============================================================================
// Types
// =============================================================================

interface LeadContext {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  linkedinId: string | null;
  sentimentTag: string | null;
  clientId: string;
}

interface WorkspaceSettings {
  timezone: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
  // New fields for template variables
  aiPersonaName: string | null;
  companyName: string | null;
  targetResult: string | null;
  qualificationQuestions: string | null; // JSON array of questions
  calendarSlotsToShow: number | null;
}

interface CalendarLinkData {
  url: string;
  name: string;
}

interface ExecutionResult {
  success: boolean;
  action: "sent" | "skipped" | "queued_for_approval" | "error";
  message?: string;
  error?: string;
}

// =============================================================================
// Condition Evaluation
// =============================================================================

/**
 * Evaluate if a step condition is met for a lead
 */
export function evaluateCondition(lead: LeadContext, condition: StepCondition | null): boolean {
  if (!condition) return true;

  switch (condition.type) {
    case "always":
      return true;

    case "phone_provided":
      return Boolean(lead.phone && lead.phone.length >= 10);

    case "linkedin_connected":
      // For now, check if we have their LinkedIn ID (implies connection)
      return Boolean(lead.linkedinId);

    case "no_response":
      // This would typically be checked at the sequence level
      // For step-level, always returns true (the sequence handles no-response logic)
      return true;

    case "email_opened":
      // TODO: Implement email open tracking check
      // For now, return true
      return true;

    default:
      return true;
  }
}

// =============================================================================
// Business Hours
// =============================================================================

/**
 * Parse time string "HH:MM" to hours and minutes
 */
function parseTime(timeStr: string | null | undefined, fallback: string = "09:00"): { hours: number; minutes: number } {
  const [hours, minutes] = (timeStr || fallback).split(":").map((p) => parseInt(p, 10));
  return {
    hours: Number.isFinite(hours) ? hours : 9,
    minutes: Number.isFinite(minutes) ? minutes : 0,
  };
}

/**
 * Check if current time is within business hours
 */
export function isWithinBusinessHours(settings: WorkspaceSettings | null): boolean {
  if (!settings) return true; // No settings = always OK

  const timezone = settings.timezone || "America/Los_Angeles";
  const { hours: startH, minutes: startM } = parseTime(settings.workStartTime, "09:00");
  const { hours: endH, minutes: endM } = parseTime(settings.workEndTime, "17:00");

  // Get current time in the workspace timezone
  const now = new Date();
  const localTime = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  const currentHours = localTime.getHours();
  const currentMinutes = localTime.getMinutes();
  const dayOfWeek = localTime.getDay();

  // Check weekend (0 = Sunday, 6 = Saturday)
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }

  // Convert to minutes for easy comparison
  const currentTotalMinutes = currentHours * 60 + currentMinutes;
  const startTotalMinutes = startH * 60 + startM;
  const endTotalMinutes = endH * 60 + endM;

  return currentTotalMinutes >= startTotalMinutes && currentTotalMinutes <= endTotalMinutes;
}

/**
 * Get the next available business hour time
 */
export function getNextBusinessHour(settings: WorkspaceSettings | null): Date {
  const timezone = settings?.timezone || "America/Los_Angeles";
  const { hours: startH, minutes: startM } = parseTime(settings?.workStartTime, "09:00");

  const now = new Date();
  let target = new Date(now.toLocaleString("en-US", { timeZone: timezone }));

  // Move to next day if we're past end time or on weekend
  const localDay = target.getDay();
  const { hours: endH, minutes: endM } = parseTime(settings?.workEndTime, "17:00");
  const currentTotalMinutes = target.getHours() * 60 + target.getMinutes();
  const endTotalMinutes = endH * 60 + endM;

  if (currentTotalMinutes > endTotalMinutes || localDay === 0 || localDay === 6) {
    // Move to next day
    target.setDate(target.getDate() + 1);
  }

  // Skip weekends
  while (target.getDay() === 0 || target.getDay() === 6) {
    target.setDate(target.getDate() + 1);
  }

  // Set to start of business hours
  target.setHours(startH, startM, 0, 0);

  return target;
}

// =============================================================================
// Rate Limiting
// =============================================================================

/**
 * Check if we can send a follow-up to this lead today (max 1 per day)
 */
export async function canSendFollowUp(leadId: string): Promise<boolean> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  // Check if we've already sent a follow-up task to this lead today
  const todaysFollowUps = await prisma.followUpTask.count({
    where: {
      leadId,
      status: "completed",
      updatedAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });

  // Also check messages sent today
  const todaysMessages = await prisma.message.count({
    where: {
      leadId,
      direction: "outbound",
      source: "zrg", // Only count messages we sent, not campaign messages
      sentAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });

  return todaysFollowUps + todaysMessages === 0;
}

// =============================================================================
// Message Generation
// =============================================================================

/**
 * Parse qualification questions from JSON string
 */
function parseQualificationQuestions(json: string | null): Array<{ id: string; question: string }> {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Get default calendar link for a workspace
 */
async function getDefaultCalendarLink(clientId: string): Promise<CalendarLinkData | null> {
  try {
    const calendarLink = await prisma.calendarLink.findFirst({
      where: {
        clientId,
        isDefault: true,
      },
      select: {
        url: true,
        name: true,
      },
    });
    return calendarLink;
  } catch {
    return null;
  }
}

/**
 * Generate a follow-up message from template
 * Supports variables: {firstName}, {lastName}, {email}, {phone}, {availability},
 * {senderName}, {companyName}, {result}, {calendarLink}, {qualificationQuestion1}, {qualificationQuestion2}
 */
export async function generateFollowUpMessage(
  step: FollowUpStepData,
  lead: LeadContext,
  settings: WorkspaceSettings | null
): Promise<{ content: string; subject: string | null }> {
  // Fetch calendar link for the workspace
  const calendarLink = await getDefaultCalendarLink(lead.clientId);

  // Parse qualification questions
  const qualificationQuestions = parseQualificationQuestions(settings?.qualificationQuestions || null);
  const question1 = qualificationQuestions[0]?.question || "[qualification question 1]";
  const question2 = qualificationQuestions[1]?.question || "[qualification question 2]";

  // Replace template variables
  const replaceVariables = (template: string | null): string => {
    if (!template) return "";

    // Get availability slots for email
    let availability = "";
    const slotsToShow = settings?.calendarSlotsToShow || 3;
    
    if (settings?.timezone) {
      const { hours: startH, minutes: startM } = parseTime(settings.workStartTime, "09:00");
      const { hours: endH, minutes: endM } = parseTime(settings.workEndTime, "17:00");

      const slots: string[] = [];
      const cursor = new Date();
      while (slots.length < slotsToShow) {
        cursor.setDate(cursor.getDate() + 1);
        if (cursor.getDay() === 0 || cursor.getDay() === 6) continue;

        const dayStr = cursor.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          timeZone: settings.timezone || "UTC",
        });
        slots.push(
          `${dayStr} ${startH}:${startM.toString().padStart(2, "0")} - ${endH}:${endM.toString().padStart(2, "0")}`
        );
      }
      // Format as "Monday Dec 9, Tuesday Dec 10" style
      availability = slots.join(" or ");
    }

    return template
      // Lead variables
      .replace(/\{firstName\}/g, lead.firstName || "there")
      .replace(/\{lastName\}/g, lead.lastName || "")
      .replace(/\{email\}/g, lead.email || "")
      .replace(/\{phone\}/g, lead.phone || "")
      // Workspace/company variables
      .replace(/\{senderName\}/g, settings?.aiPersonaName || "")
      .replace(/\{companyName\}/g, settings?.companyName || "")
      .replace(/\{result\}/g, settings?.targetResult || "achieving your goals")
      // Calendar/availability variables
      .replace(/\{availability\}/g, availability)
      .replace(/\{calendarLink\}/g, calendarLink?.url || "[calendar link]")
      // Qualification questions
      .replace(/\{qualificationQuestion1\}/g, question1)
      .replace(/\{qualificationQuestion2\}/g, question2);
  };

  const content = replaceVariables(step.messageTemplate);
  const subject = step.subject ? replaceVariables(step.subject) : null;

  return { content, subject };
}

// =============================================================================
// Step Execution
// =============================================================================

/**
 * Execute a single follow-up step
 */
export async function executeFollowUpStep(
  instanceId: string,
  step: FollowUpStepData,
  lead: LeadContext
): Promise<ExecutionResult> {
  try {
    // Get workspace settings for business hours check
    const client = await prisma.client.findUnique({
      where: { id: lead.clientId },
      include: { settings: true },
    });

    const settings = client?.settings || null;

    // Check business hours
    if (!isWithinBusinessHours(settings)) {
      const nextBusinessHour = getNextBusinessHour(settings);
      // Reschedule to next business hour
      await prisma.followUpInstance.update({
        where: { id: instanceId },
        data: { nextStepDue: nextBusinessHour },
      });

      return {
        success: true,
        action: "skipped",
        message: `Rescheduled to next business hour: ${nextBusinessHour.toISOString()}`,
      };
    }

    // Check rate limit
    const canSend = await canSendFollowUp(lead.id);
    if (!canSend) {
      // Reschedule to tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);

      await prisma.followUpInstance.update({
        where: { id: instanceId },
        data: { nextStepDue: tomorrow },
      });

      return {
        success: true,
        action: "skipped",
        message: "Rate limited - already sent follow-up today. Rescheduled to tomorrow.",
      };
    }

    // Evaluate step condition
    if (!evaluateCondition(lead, step.condition)) {
      return {
        success: true,
        action: "skipped",
        message: `Condition not met: ${step.condition?.type}`,
      };
    }

    // Handle unsupported channels
    if (step.channel === "linkedin" || step.channel === "ai_voice") {
      return {
        success: true,
        action: "skipped",
        message: `Channel "${step.channel}" not yet implemented - skipping step`,
      };
    }

    // Generate message content
    const { content, subject } = await generateFollowUpMessage(step, lead, settings);

    // Check if approval is required
    if (step.requiresApproval) {
      // Create a pending task for approval
      await prisma.followUpTask.create({
        data: {
          leadId: lead.id,
          type: step.channel,
          dueDate: new Date(),
          status: "pending",
          suggestedMessage: content,
          subject: subject,
          instanceId: instanceId,
          stepOrder: step.stepOrder,
        },
      });

      // Pause the instance until approved
      await prisma.followUpInstance.update({
        where: { id: instanceId },
        data: {
          status: "paused",
          pausedReason: "awaiting_approval",
        },
      });

      return {
        success: true,
        action: "queued_for_approval",
        message: "Follow-up queued for manual approval",
      };
    }

    // For auto-send, create an AI draft
    // The actual sending will be handled by the existing draft approval flow
    // or we can directly send based on channel

    if (step.channel === "email") {
      // Generate AI draft for email
      const draftResult = await generateResponseDraft(
        lead.id,
        `[Follow-up Step ${step.stepOrder}] ${content}`,
        lead.sentimentTag || "Follow Up",
        "email"
      );

      if (!draftResult.success) {
        return {
          success: false,
          action: "error",
          error: draftResult.error || "Failed to generate email draft",
        };
      }

      // Create follow-up task record
      await prisma.followUpTask.create({
        data: {
          leadId: lead.id,
          type: "email",
          dueDate: new Date(),
          status: "completed",
          suggestedMessage: draftResult.content,
          subject: subject,
          instanceId: instanceId,
          stepOrder: step.stepOrder,
        },
      });

      return {
        success: true,
        action: "sent",
        message: `Email draft created for lead ${lead.firstName}`,
      };
    } else if (step.channel === "sms") {
      // Generate AI draft for SMS
      const draftResult = await generateResponseDraft(
        lead.id,
        `[Follow-up Step ${step.stepOrder}] ${content}`,
        lead.sentimentTag || "Follow Up",
        "sms"
      );

      if (!draftResult.success) {
        return {
          success: false,
          action: "error",
          error: draftResult.error || "Failed to generate SMS draft",
        };
      }

      // Create follow-up task record
      await prisma.followUpTask.create({
        data: {
          leadId: lead.id,
          type: "sms",
          dueDate: new Date(),
          status: "completed",
          suggestedMessage: draftResult.content,
          instanceId: instanceId,
          stepOrder: step.stepOrder,
        },
      });

      return {
        success: true,
        action: "sent",
        message: `SMS draft created for lead ${lead.firstName}`,
      };
    }

    return {
      success: false,
      action: "error",
      error: `Unsupported channel: ${step.channel}`,
    };
  } catch (error) {
    console.error("Failed to execute follow-up step:", error);
    return {
      success: false,
      action: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// =============================================================================
// Batch Processing (called by cron)
// =============================================================================

/**
 * Process all due follow-up instances
 * This should be called by an external cron service
 */
export async function processFollowUpsDue(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: string[];
}> {
  const results = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: [] as string[],
  };

  try {
    const now = new Date();

    // Get all active instances with due steps
    const instances = await prisma.followUpInstance.findMany({
      where: {
        status: "active",
        nextStepDue: { lte: now },
      },
      include: {
        lead: true,
        sequence: {
          include: {
            steps: {
              orderBy: { stepOrder: "asc" },
            },
            client: {
              include: { settings: true },
            },
          },
        },
      },
    });

    for (const instance of instances) {
      results.processed++;

      // Find the next step to execute
      const nextStep = instance.sequence.steps.find(
        (s) => s.stepOrder > instance.currentStep
      );

      if (!nextStep) {
        // No more steps - mark as completed
        await prisma.followUpInstance.update({
          where: { id: instance.id },
          data: {
            status: "completed",
            completedAt: new Date(),
            nextStepDue: null,
          },
        });
        results.skipped++;
        continue;
      }

      // Build lead context
      const leadContext: LeadContext = {
        id: instance.lead.id,
        firstName: instance.lead.firstName,
        lastName: instance.lead.lastName,
        email: instance.lead.email,
        phone: instance.lead.phone,
        linkedinUrl: instance.lead.linkedinUrl,
        linkedinId: instance.lead.linkedinId,
        sentimentTag: instance.lead.sentimentTag,
        clientId: instance.lead.clientId,
      };

      // Build step data
      const stepData: FollowUpStepData = {
        id: nextStep.id,
        stepOrder: nextStep.stepOrder,
        dayOffset: nextStep.dayOffset,
        channel: nextStep.channel as FollowUpStepData["channel"],
        messageTemplate: nextStep.messageTemplate,
        subject: nextStep.subject,
        condition: nextStep.condition
          ? (JSON.parse(nextStep.condition) as StepCondition)
          : null,
        requiresApproval: nextStep.requiresApproval,
        fallbackStepId: nextStep.fallbackStepId,
      };

      // Execute the step
      const result = await executeFollowUpStep(instance.id, stepData, leadContext);

      if (result.success) {
        if (result.action === "sent" || result.action === "queued_for_approval") {
          results.succeeded++;

          // Advance to next step (unless paused for approval)
          if (result.action === "sent") {
            // Find the next-next step
            const nextNextStep = instance.sequence.steps.find(
              (s) => s.stepOrder > nextStep.stepOrder
            );

            if (nextNextStep) {
              // Calculate next due date
              const dayDiff = nextNextStep.dayOffset - nextStep.dayOffset;
              const nextDue = new Date(Date.now() + dayDiff * 24 * 60 * 60 * 1000);

              await prisma.followUpInstance.update({
                where: { id: instance.id },
                data: {
                  currentStep: nextStep.stepOrder,
                  lastStepAt: new Date(),
                  nextStepDue: nextDue,
                },
              });
            } else {
              // Sequence complete
              await prisma.followUpInstance.update({
                where: { id: instance.id },
                data: {
                  currentStep: nextStep.stepOrder,
                  lastStepAt: new Date(),
                  nextStepDue: null,
                  status: "completed",
                  completedAt: new Date(),
                },
              });
            }
          }
        } else if (result.action === "skipped") {
          results.skipped++;
        }
      } else {
        results.failed++;
        results.errors.push(`Instance ${instance.id}: ${result.error}`);
      }
    }

    return results;
  } catch (error) {
    console.error("Failed to process follow-ups:", error);
    results.errors.push(error instanceof Error ? error.message : "Unknown error");
    return results;
  }
}

/**
 * Pause all follow-up instances for a lead when they reply
 */
export async function pauseFollowUpsOnReply(leadId: string): Promise<void> {
  try {
    await prisma.followUpInstance.updateMany({
      where: {
        leadId,
        status: "active",
      },
      data: {
        status: "paused",
        pausedReason: "lead_replied",
      },
    });
  } catch (error) {
    console.error("Failed to pause follow-ups on reply:", error);
  }
}

