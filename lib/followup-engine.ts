import { prisma } from "@/lib/prisma";
import type { FollowUpStepData, StepCondition } from "@/actions/followup-sequence-actions";
import { getAIPromptTemplate } from "@/lib/ai/prompt-registry";
import { runResponse } from "@/lib/ai/openai-telemetry";
import { sendLinkedInConnectionRequest, sendLinkedInDM } from "@/lib/unipile-api";
import { sendMessage } from "@/actions/message-actions";
import { sendEmailReply } from "@/actions/email-actions";
import { getWorkspaceAvailabilitySlotsUtc } from "@/lib/availability-cache";
import { ensureLeadTimezone } from "@/lib/timezone-inference";
import { formatAvailabilitySlots } from "@/lib/availability-format";
import { selectDistributedAvailabilitySlots } from "@/lib/availability-distribution";
import { getWorkspaceSlotOfferCountsForRange, incrementWorkspaceSlotOffersBatch } from "@/lib/slot-offer-ledger";
import {
  shouldAutoBook,
  bookMeetingOnGHL,
  getOfferedSlots,
  type OfferedSlot,
} from "@/actions/booking-actions";
import { sendSlackNotification } from "@/lib/slack-notifications";

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
  offeredSlots: string | null;
  snoozedUntil: Date | null;
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
  /**
   * When true, the follow-up instance should advance past this step even though no send occurred.
   * Use for permanent skips (e.g., condition not met like phone_provided).
   */
  advance?: boolean;
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
 * Check if we can send a follow-up to this lead today (max 1 per channel per day).
 *
 * This supports omni-channel sequences where Email + LinkedIn (or SMS) may occur on the same day,
 * while still preventing repeated touches on the same channel within a day.
 */
export async function canSendFollowUp(
  leadId: string,
  channel: FollowUpStepData["channel"]
): Promise<boolean> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const [existingTask, existingMessage] = await Promise.all([
    prisma.followUpTask.findFirst({
      where: {
        leadId,
        type: channel,
        status: "completed",
        updatedAt: { gte: startOfDay, lte: endOfDay },
      },
      select: { id: true },
    }),
    channel === "ai_voice"
      ? Promise.resolve(null)
      : prisma.message.findFirst({
          where: {
            leadId,
            channel,
            direction: "outbound",
            source: "zrg",
            sentAt: { gte: startOfDay, lte: endOfDay },
          },
          select: { id: true },
        }),
  ]);

  return !existingTask && !existingMessage;
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
): Promise<{ content: string; subject: string | null; offeredSlots: OfferedSlot[] }> {
  // Fetch calendar link for the workspace
  const calendarLink = await getDefaultCalendarLink(lead.clientId);

  // Parse qualification questions
  const qualificationQuestions = parseQualificationQuestions(settings?.qualificationQuestions || null);
  const question1 = qualificationQuestions[0]?.question || "[qualification question 1]";
  const question2 = qualificationQuestions[1]?.question || "[qualification question 2]";

  const offeredAtIso = new Date().toISOString();
  const offeredAt = new Date(offeredAtIso);

  const needsAvailability =
    (step.messageTemplate || "").includes("{availability}") ||
    (step.subject || "").includes("{availability}");

  let availabilityText = "";
  let offeredSlots: OfferedSlot[] = [];

  if (needsAvailability) {
    try {
      const availability = await getWorkspaceAvailabilitySlotsUtc(lead.clientId, { refreshIfStale: true });
      const slotsUtc = availability.slotsUtc;

      if (slotsUtc.length > 0) {
        const tzResult = await ensureLeadTimezone(lead.id);
        const timeZone = tzResult.timezone || settings?.timezone || "UTC";
        const mode = tzResult.source === "workspace_fallback" ? "explicit_tz" : "your_time";

        const existingOffered = new Set<string>();
        if (lead.offeredSlots) {
          try {
            const parsed = JSON.parse(lead.offeredSlots) as Array<{ datetime?: string }>;
            for (const s of parsed) {
              if (!s?.datetime) continue;
              const d = new Date(s.datetime);
              if (!Number.isNaN(d.getTime())) existingOffered.add(d.toISOString());
            }
          } catch {
            // ignore parse errors
          }
        }

        const startAfterUtc = lead.snoozedUntil && lead.snoozedUntil > offeredAt ? lead.snoozedUntil : null;
        const anchor = startAfterUtc && startAfterUtc > offeredAt ? startAfterUtc : offeredAt;
        const rangeEnd = new Date(anchor.getTime() + 30 * 24 * 60 * 60 * 1000);
        const offerCounts = await getWorkspaceSlotOfferCountsForRange(lead.clientId, anchor, rangeEnd);

        const selectedUtcIso = selectDistributedAvailabilitySlots({
          slotsUtcIso: slotsUtc,
          offeredCountBySlotUtcIso: offerCounts,
          timeZone,
          excludeUtcIso: existingOffered,
          startAfterUtc,
          preferWithinDays: 5,
          now: offeredAt,
        });

        const formatted = formatAvailabilitySlots({
          slotsUtcIso: selectedUtcIso,
          timeZone,
          mode,
          limit: selectedUtcIso.length,
        });

        if (formatted.length > 0) {
          availabilityText = formatted.map((s) => s.label).join(" or ");
          offeredSlots = formatted.map((s) => ({
            datetime: s.datetime,
            label: s.label,
            offeredAt: offeredAtIso,
          }));
        } else {
          availabilityText = "a couple openings over the next few days";
          offeredSlots = [];
        }
      } else {
        availabilityText = "a couple openings over the next few days";
      }
    } catch (error) {
      console.error("[FollowUp] Failed to load availability:", error);
      availabilityText = "a couple openings over the next few days";
      offeredSlots = [];
    }
  }

  // Replace template variables
  const replaceVariables = (template: string | null): string => {
    if (!template) return "";

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
      .replace(/\{availability\}/g, availabilityText)
      .replace(/\{calendarLink\}/g, calendarLink?.url || "[calendar link]")
      // Qualification questions
      .replace(/\{qualificationQuestion1\}/g, question1)
      .replace(/\{qualificationQuestion2\}/g, question2);
  };

  const content = replaceVariables(step.messageTemplate);
  const subject = step.subject ? replaceVariables(step.subject) : null;

  return { content, subject, offeredSlots };
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

    // Handle unsupported channels
    if (step.channel === "ai_voice") {
      return {
        success: true,
        action: "skipped",
        message: `Channel "${step.channel}" not yet implemented - skipping step`,
        advance: true,
      };
    }

    // Evaluate step condition (LinkedIn steps re-check against current DB state below)
    if (step.channel !== "linkedin" && !evaluateCondition(lead, step.condition)) {
      return {
        success: true,
        action: "skipped",
        message: `Condition not met: ${step.condition?.type}`,
        advance: true,
      };
    }

    // For SMS channel: check if lead has phone number
    // If phone is missing and enrichment is pending, wait or pause
    if (step.channel === "sms" && !lead.phone) {
      // Fetch latest lead data to check enrichment status
      const currentLead = await prisma.lead.findUnique({ where: { id: lead.id } });
      
      if (currentLead?.enrichmentStatus === "pending") {
        // Check how long enrichment has been pending
        // Use enrichedAt as baseline or createdAt if not available
        const enrichmentStarted = currentLead.enrichmentLastRetry || currentLead.updatedAt;
        const pendingDuration = Date.now() - enrichmentStarted.getTime();
        const ENRICHMENT_WAIT_MS = 5 * 60 * 1000; // 5 minutes
        
        if (pendingDuration < ENRICHMENT_WAIT_MS) {
          // Still within wait window - skip this execution, will retry on next cron run
          console.log(`[FollowUp] SMS step skipped for lead ${lead.id} - waiting for enrichment (${Math.round(pendingDuration / 1000)}s / ${ENRICHMENT_WAIT_MS / 1000}s)`);
          return {
            success: true,
            action: "skipped",
            message: `Waiting for phone enrichment (${Math.round(pendingDuration / 1000)}s elapsed, ${ENRICHMENT_WAIT_MS / 1000}s max)`,
          };
        } else {
          // Exceeded wait window - pause the sequence
          await prisma.followUpInstance.update({
            where: { id: instanceId },
            data: {
              status: "paused",
              pausedReason: "awaiting_enrichment",
            },
          });
          
          console.log(`[FollowUp] SMS step paused for lead ${lead.id} - enrichment timeout (${Math.round(pendingDuration / 1000)}s)`);
          return {
            success: true,
            action: "skipped",
            message: "Sequence paused - phone enrichment timeout. Manual intervention required.",
          };
        }
      } else {
        // No phone and enrichment is not pending (failed, not_found, or not_needed)
        // Skip SMS step - can't send without phone
        console.log(`[FollowUp] SMS step skipped for lead ${lead.id} - no phone available (enrichment status: ${currentLead?.enrichmentStatus})`);
        return {
          success: true,
          action: "skipped",
          message: `SMS skipped - no phone number available (enrichment: ${currentLead?.enrichmentStatus || "none"})`,
          advance: true,
        };
      }
    }

    // LinkedIn steps: connection request (if not connected) and DMs once connected
    if (step.channel === "linkedin") {
      const currentLead = await prisma.lead.findUnique({
        where: { id: lead.id },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          linkedinUrl: true,
          linkedinId: true,
          enrichmentStatus: true,
          enrichmentLastRetry: true,
          updatedAt: true,
          client: { select: { unipileAccountId: true } },
        },
      });

      if (!currentLead) {
        return { success: false, action: "error", error: "Lead not found" };
      }

      const effectiveLead: LeadContext = {
        ...lead,
        firstName: currentLead.firstName ?? lead.firstName,
        lastName: currentLead.lastName ?? lead.lastName,
        email: currentLead.email ?? lead.email,
        phone: currentLead.phone ?? lead.phone,
        linkedinUrl: currentLead.linkedinUrl,
        linkedinId: currentLead.linkedinId,
      };

      if (!evaluateCondition(effectiveLead, step.condition)) {
        // Special-case: linkedin_connected should poll/wait rather than skipping permanently
        if (step.condition?.type === "linkedin_connected" && !currentLead.linkedinId) {
          const retryAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
          await prisma.followUpInstance.update({
            where: { id: instanceId },
            data: { nextStepDue: retryAt },
          });

          return {
            success: true,
            action: "skipped",
            message: "Waiting for LinkedIn connection acceptance; rescheduled in 1 hour",
          };
        }

        return {
          success: true,
          action: "skipped",
          message: `Condition not met: ${step.condition?.type}`,
          advance: true,
        };
      }

      if (!currentLead.linkedinUrl) {
        if (currentLead.enrichmentStatus === "pending") {
          const enrichmentStarted = currentLead.enrichmentLastRetry || currentLead.updatedAt;
          const pendingDuration = Date.now() - enrichmentStarted.getTime();
          const ENRICHMENT_WAIT_MS = 30 * 60 * 1000; // 30 minutes

          if (pendingDuration < ENRICHMENT_WAIT_MS) {
            return {
              success: true,
              action: "skipped",
              message: `Waiting for LinkedIn URL enrichment (${Math.round(pendingDuration / 1000)}s elapsed)`,
            };
          }

          await prisma.followUpInstance.update({
            where: { id: instanceId },
            data: {
              status: "paused",
              pausedReason: "awaiting_enrichment",
            },
          });

          return {
            success: true,
            action: "skipped",
            message: "Sequence paused - LinkedIn enrichment timeout. Manual intervention required.",
          };
        }

        return {
          success: true,
          action: "skipped",
          message: "LinkedIn skipped - lead has no LinkedIn URL",
          advance: true,
        };
      }

      const accountId = currentLead.client?.unipileAccountId;
      if (!accountId) {
        return {
          success: false,
          action: "error",
          error: "Workspace has no LinkedIn account configured (Unipile)",
        };
      }

      const canSend = await canSendFollowUp(lead.id, step.channel);
      if (!canSend) {
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
          message: `Rate limited - already sent ${step.channel} follow-up today. Rescheduled to tomorrow.`,
        };
      }

      const { content, offeredSlots } = await generateFollowUpMessage(step, effectiveLead, settings);

      // If connected, send a DM. If not connected, send a connection request with note.
      if (currentLead.linkedinId) {
        const dmResult = await sendLinkedInDM(
          accountId,
          currentLead.linkedinUrl,
          content,
          currentLead.linkedinId
        );

        if (!dmResult.success) {
          return { success: false, action: "error", error: dmResult.error || "Failed to send LinkedIn DM" };
        }

        await prisma.message.create({
          data: {
            leadId: lead.id,
            channel: "linkedin",
            source: "zrg",
            body: content,
            direction: "outbound",
            sentAt: new Date(),
          },
        });

        if (offeredSlots.length > 0) {
          await prisma.lead.update({
            where: { id: lead.id },
            data: { offeredSlots: JSON.stringify(offeredSlots) },
          });

          const offeredAt = offeredSlots[0]?.offeredAt ? new Date(offeredSlots[0].offeredAt) : new Date();
          await incrementWorkspaceSlotOffersBatch({
            clientId: lead.clientId,
            slotUtcIsoList: offeredSlots.map((s) => s.datetime),
            offeredAt: Number.isNaN(offeredAt.getTime()) ? new Date() : offeredAt,
          });
        }

        await prisma.followUpTask.create({
          data: {
            leadId: lead.id,
            type: "linkedin",
            dueDate: new Date(),
            status: "completed",
            suggestedMessage: content,
            instanceId: instanceId,
            stepOrder: step.stepOrder,
          },
        });

        return {
          success: true,
          action: "sent",
          message: `LinkedIn DM sent for lead ${effectiveLead.firstName || effectiveLead.id}`,
        };
      }

      const inviteResult = await sendLinkedInConnectionRequest(
        accountId,
        currentLead.linkedinUrl,
        content
      );

      if (!inviteResult.success) {
        return {
          success: false,
          action: "error",
          error: inviteResult.error || "Failed to send LinkedIn connection request",
        };
      }

      await prisma.message.create({
        data: {
          leadId: lead.id,
          channel: "linkedin",
          source: "zrg",
          body: content,
          direction: "outbound",
          sentAt: new Date(),
        },
      });

      if (offeredSlots.length > 0) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { offeredSlots: JSON.stringify(offeredSlots) },
        });

        const offeredAt = offeredSlots[0]?.offeredAt ? new Date(offeredSlots[0].offeredAt) : new Date();
        await incrementWorkspaceSlotOffersBatch({
          clientId: lead.clientId,
          slotUtcIsoList: offeredSlots.map((s) => s.datetime),
          offeredAt: Number.isNaN(offeredAt.getTime()) ? new Date() : offeredAt,
        });
      }

      await prisma.followUpTask.create({
        data: {
          leadId: lead.id,
          type: "linkedin",
          dueDate: new Date(),
          status: "completed",
          suggestedMessage: content,
          instanceId: instanceId,
          stepOrder: step.stepOrder,
        },
      });

      return {
        success: true,
        action: "sent",
        message: `LinkedIn connection request sent for lead ${effectiveLead.firstName || effectiveLead.id}`,
      };
    }

    // Check per-channel rate limit (only for channels that will send/create drafts)
    const canSend = await canSendFollowUp(lead.id, step.channel);
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
        message: `Rate limited - already sent ${step.channel} follow-up today. Rescheduled to tomorrow.`,
      };
    }

    // Generate message content
    const { content, subject, offeredSlots } = await generateFollowUpMessage(step, lead, settings);

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

    if (step.channel === "email") {
      if (!lead.email) {
        return {
          success: true,
          action: "skipped",
          message: "Email skipped - lead has no email",
          advance: true,
        };
      }

      // Auto-send email when possible (reply-only infrastructure).
      // If no thread exists, create a task and advance.
      const draft = await prisma.aIDraft.create({
        data: {
          leadId: lead.id,
          content,
          status: "pending",
          channel: "email",
        },
      });

      const sendResult = await sendEmailReply(draft.id);

      if (!sendResult.success) {
        await prisma.aIDraft
          .update({ where: { id: draft.id }, data: { status: "rejected" } })
          .catch(() => undefined);

        await prisma.followUpTask.create({
          data: {
            leadId: lead.id,
            type: "email",
            dueDate: new Date(),
            status: "pending",
            suggestedMessage: content,
            subject: subject,
            instanceId: instanceId,
            stepOrder: step.stepOrder,
          },
        });

        return {
          success: true,
          action: "skipped",
          message: `Email auto-send unavailable (${sendResult.error || "unknown error"}) - queued task`,
          advance: true,
        };
      }

      if (offeredSlots.length > 0) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { offeredSlots: JSON.stringify(offeredSlots) },
        });

        const offeredAt = offeredSlots[0]?.offeredAt ? new Date(offeredSlots[0].offeredAt) : new Date();
        await incrementWorkspaceSlotOffersBatch({
          clientId: lead.clientId,
          slotUtcIsoList: offeredSlots.map((s) => s.datetime),
          offeredAt: Number.isNaN(offeredAt.getTime()) ? new Date() : offeredAt,
        });
      }

      await prisma.followUpTask.create({
        data: {
          leadId: lead.id,
          type: "email",
          dueDate: new Date(),
          status: "completed",
          suggestedMessage: content,
          subject: subject,
          instanceId: instanceId,
          stepOrder: step.stepOrder,
        },
      });

      return {
        success: true,
        action: "sent",
        message: `Email sent for lead ${lead.firstName || lead.id}`,
      };
    }

    if (step.channel === "sms") {
      const sendResult = await sendMessage(lead.id, content);
      if (!sendResult.success) {
        return {
          success: false,
          action: "error",
          error: sendResult.error || "Failed to send SMS",
        };
      }

      if (offeredSlots.length > 0) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { offeredSlots: JSON.stringify(offeredSlots) },
        });

        const offeredAt = offeredSlots[0]?.offeredAt ? new Date(offeredSlots[0].offeredAt) : new Date();
        await incrementWorkspaceSlotOffersBatch({
          clientId: lead.clientId,
          slotUtcIsoList: offeredSlots.map((s) => s.datetime),
          offeredAt: Number.isNaN(offeredAt.getTime()) ? new Date() : offeredAt,
        });
      }

      await prisma.followUpTask.create({
        data: {
          leadId: lead.id,
          type: "sms",
          dueDate: new Date(),
          status: "completed",
          suggestedMessage: content,
          instanceId: instanceId,
          stepOrder: step.stepOrder,
        },
      });

      return {
        success: true,
        action: "sent",
        message: `SMS sent for lead ${lead.firstName || lead.id}`,
      };
    }

    return { success: false, action: "error", error: `Unsupported channel: ${step.channel}` };
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
        lead: {
          OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
        },
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
        offeredSlots: instance.lead.offeredSlots,
        snoozedUntil: instance.lead.snoozedUntil,
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
          // Advance past permanently skipped steps (e.g., phone_provided not met)
          if (result.advance) {
            const nextNextStep = instance.sequence.steps.find(
              (s) => s.stepOrder > nextStep.stepOrder
            );

            if (nextNextStep) {
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
    // Only pause sequences that are meant to run when the lead has NOT replied.
    // Meeting-requested and post-booking sequences are response-driven and should continue.
    const instances = await prisma.followUpInstance.findMany({
      where: {
        leadId,
        status: "active",
        sequence: { triggerOn: "no_response" },
      },
      select: { id: true },
    });

    if (instances.length === 0) return;

    await prisma.followUpInstance.updateMany({
      where: { id: { in: instances.map((i) => i.id) } },
      data: { status: "paused", pausedReason: "lead_replied" },
    });
  } catch (error) {
    console.error("Failed to pause follow-ups on reply:", error);
  }
}

/**
 * Pause follow-up instances for a lead until a specific timestamp.
 * Used for "contact me after X" deferrals (snooze).
 *
 * Policy: pause any active instances (and instances paused due to lead reply),
 * and set nextStepDue to the snooze cutoff so the sequence resumes at the next step.
 */
export async function pauseFollowUpsUntil(leadId: string, snoozedUntil: Date): Promise<void> {
  try {
    await prisma.followUpInstance.updateMany({
      where: {
        leadId,
        OR: [
          { status: "active" },
          { status: "paused", pausedReason: "lead_replied" },
        ],
      },
      data: {
        status: "paused",
        pausedReason: "lead_snoozed",
        nextStepDue: snoozedUntil,
      },
    });
  } catch (error) {
    console.error("Failed to pause follow-ups until:", error);
  }
}

/**
 * Resume follow-up instances that were paused due to a snooze once the cutoff has passed.
 * Resumes at the next step (does not restart the sequence).
 */
export async function resumeSnoozedFollowUps(opts?: {
  limit?: number;
}): Promise<{ checked: number; resumed: number; errors: string[] }> {
  const limit = opts?.limit ?? 200;
  const now = new Date();

  const results = { checked: 0, resumed: 0, errors: [] as string[] };

  const paused = await prisma.followUpInstance.findMany({
    where: {
      status: "paused",
      pausedReason: "lead_snoozed",
      nextStepDue: { lte: now },
      lead: { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
    },
    take: limit,
    select: {
      id: true,
      leadId: true,
      lead: { select: { autoFollowUpEnabled: true } },
    },
  });

  for (const instance of paused) {
    results.checked++;

    if (!instance.lead.autoFollowUpEnabled) {
      continue;
    }

    try {
      await prisma.followUpInstance.update({
        where: { id: instance.id },
        data: {
          status: "active",
          pausedReason: null,
        },
      });
      results.resumed++;
    } catch (error) {
      results.errors.push(
        `${instance.id}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  return results;
}

/**
 * Resume follow-up instances after a lead goes "ghost" again.
 * Policy: if the most recent inbound message is older than 7 days, resume at the next step.
 */
export async function resumeGhostedFollowUps(opts?: {
  days?: number;
  limit?: number;
}): Promise<{ checked: number; resumed: number; errors: string[] }> {
  const days = opts?.days ?? 7;
  const limit = opts?.limit ?? 100;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const results = { checked: 0, resumed: 0, errors: [] as string[] };

  const paused = await prisma.followUpInstance.findMany({
    where: {
      status: "paused",
      pausedReason: "lead_replied",
    },
    take: limit,
    select: {
      id: true,
      leadId: true,
      lead: { select: { autoFollowUpEnabled: true, snoozedUntil: true } },
    },
  });

  for (const instance of paused) {
    results.checked++;

    if (!instance.lead.autoFollowUpEnabled) {
      continue;
    }

    try {
      if (instance.lead.snoozedUntil && instance.lead.snoozedUntil > new Date()) {
        continue;
      }
      const lastInbound = await prisma.message.findFirst({
        where: { leadId: instance.leadId, direction: "inbound" },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      });

      // If we have no inbound history, or it's old, re-engage.
      if (!lastInbound?.sentAt || lastInbound.sentAt <= cutoff) {
        await prisma.followUpInstance.update({
          where: { id: instance.id },
          data: {
            status: "active",
            pausedReason: null,
            nextStepDue: new Date(),
          },
        });
        results.resumed++;
      }
    } catch (error) {
      results.errors.push(
        `${instance.id}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  return results;
}

// =============================================================================
// AI Time Parsing & Auto-Booking
// =============================================================================

/**
 * Parse a time/date expression from a message using OpenAI
 * Returns the best matching slot from offered slots, or null if no match
 */
export async function parseAcceptedTimeFromMessage(
  message: string,
  offeredSlots: OfferedSlot[],
  meta: { clientId: string; leadId?: string | null }
): Promise<OfferedSlot | null> {
  if (!message || offeredSlots.length === 0) return null;

  try {
    // Validate OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      console.error("OpenAI API key not configured");
      return null;
    }

    // Build slot context for the AI
    const slotContext = offeredSlots
      .map((slot, i) => `${i + 1}. ${slot.label} (${slot.datetime})`)
      .join("\n");

    const promptTemplate = getAIPromptTemplate("followup.parse_accepted_time.v1");
    const systemTemplate =
      promptTemplate?.messages.find((m) => m.role === "system")?.content ||
      "Match the message to one of the provided slots; reply with a slot number or NONE.";
    const systemPrompt = systemTemplate.replaceAll("{slotContext}", slotContext);

    // GPT-5-mini with low reasoning effort for time parsing using Responses API
    const response = await runResponse({
      clientId: meta.clientId,
      leadId: meta.leadId,
      featureId: promptTemplate?.featureId || "followup.parse_accepted_time",
      promptKey: promptTemplate?.key || "followup.parse_accepted_time.v1",
      params: {
        model: "gpt-5-mini",
        instructions: systemPrompt,
        input: message,
        reasoning: { effort: "low" },
        max_output_tokens: 10,
      },
    });

    const aiResponse = response.output_text?.trim();

    if (!aiResponse || aiResponse === "NONE") {
      return null;
    }

    const slotIndex = parseInt(aiResponse, 10) - 1;
    if (Number.isFinite(slotIndex) && slotIndex >= 0 && slotIndex < offeredSlots.length) {
      return offeredSlots[slotIndex];
    }

    return null;
  } catch (error) {
    console.error("Failed to parse time from message:", error);
    return null;
  }
}

/**
 * Detect "meeting accepted" intent from a message
 * Returns true if the message indicates acceptance of a meeting time
 */
export async function detectMeetingAcceptedIntent(
  message: string,
  meta: { clientId: string; leadId?: string | null }
): Promise<boolean> {
  if (!message) return false;

  try {
    // Validate OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) return false;

    const promptTemplate = getAIPromptTemplate("followup.detect_meeting_accept_intent.v1");
    const systemPrompt =
      promptTemplate?.messages.find((m) => m.role === "system")?.content ||
      "Determine if the message indicates acceptance. Reply YES or NO.";

    // GPT-5-mini with low reasoning effort for intent detection using Responses API
    const response = await runResponse({
      clientId: meta.clientId,
      leadId: meta.leadId,
      featureId: promptTemplate?.featureId || "followup.detect_meeting_accept_intent",
      promptKey: promptTemplate?.key || "followup.detect_meeting_accept_intent.v1",
      params: {
        model: "gpt-5-mini",
        instructions: systemPrompt,
        input: message,
        reasoning: { effort: "low" },
        max_output_tokens: 5,
      },
    });

    const result = response.output_text?.trim()?.toUpperCase();
    return result === "YES";
  } catch {
    return false;
  }
}

/**
 * Process an incoming message for auto-booking
 * Called when a new inbound message is received
 */
export async function processMessageForAutoBooking(
  leadId: string,
  messageBody: string
): Promise<{
  booked: boolean;
  appointmentId?: string;
  error?: string;
}> {
  try {
    const leadMeta = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, clientId: true },
    });

    if (!leadMeta) {
      return { booked: false, error: "Lead not found" };
    }

    // Check if lead should auto-book
    const autoBookResult = await shouldAutoBook(leadId);
    if (!autoBookResult.shouldBook) {
      return { booked: false };
    }

    // Detect if the message indicates meeting acceptance
    const isMeetingAccepted = await detectMeetingAcceptedIntent(messageBody, {
      clientId: leadMeta.clientId,
      leadId: leadMeta.id,
    });
    if (!isMeetingAccepted) {
      return { booked: false };
    }

    // Get offered slots for this lead
    const offeredSlots = await getOfferedSlots(leadId);
    if (offeredSlots.length === 0) {
      return { booked: false, error: "No offered slots found for lead" };
    }

    // Parse which slot they accepted
    const acceptedSlot = await parseAcceptedTimeFromMessage(messageBody, offeredSlots, {
      clientId: leadMeta.clientId,
      leadId: leadMeta.id,
    });
    if (!acceptedSlot) {
      // Ambiguous acceptance (e.g., "yes/sounds good") — do NOT auto-book.
      // Create a follow-up task with a suggested clarification message.
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { id: true, phone: true, email: true, linkedinUrl: true, sentimentTag: true },
      });

      const type = lead?.phone ? "sms" : lead?.email ? "email" : lead?.linkedinUrl ? "linkedin" : "call";
      const options = offeredSlots.slice(0, 2);
      const suggestion =
        options.length === 2
          ? `Which works better for you: (1) ${options[0]!.label} or (2) ${options[1]!.label}?`
          : `Which of these works best for you: ${offeredSlots.map((s) => s.label).join(" or ")}?`;

      await prisma.followUpTask.create({
        data: {
          leadId,
          type,
          dueDate: new Date(),
          status: "pending",
          suggestedMessage: suggestion,
        },
      });

      // Surface in Follow-ups tab
      if (lead?.sentimentTag !== "Blacklist") {
        await prisma.lead.update({
          where: { id: leadId },
          data: { sentimentTag: "Follow Up" },
        });
      }

      return { booked: false };
    }

    // Book the accepted slot
    const bookingResult = await bookMeetingOnGHL(leadId, acceptedSlot.datetime);
    if (bookingResult.success) {
      // Send Slack notification for auto-booking
      await sendAutoBookingSlackNotification(leadId, acceptedSlot);

      return {
        booked: true,
        appointmentId: bookingResult.appointmentId,
      };
    }

    return { booked: false, error: bookingResult.error };
  } catch (error) {
    console.error("Failed to process message for auto-booking:", error);
    return {
      booked: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Send Slack notification for auto-booked meeting
 */
async function sendAutoBookingSlackNotification(
  leadId: string,
  slot: OfferedSlot
): Promise<void> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { client: { include: { settings: true } } },
    });

    if (!lead || !lead.client.settings?.slackAlerts) return;

    const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown Lead";
    const slotTime = new Date(slot.datetime).toLocaleString();

    await sendSlackNotification({
      text: `🗓️ Auto-Booked Meeting`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "🗓️ Meeting Auto-Booked",
            emoji: true,
          },
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Lead:*\n${leadName}`,
            },
            {
              type: "mrkdwn",
              text: `*Workspace:*\n${lead.client.name}`,
            },
            {
              type: "mrkdwn",
              text: `*Time:*\n${slotTime}`,
            },
            {
              type: "mrkdwn",
              text: `*Slot Label:*\n${slot.label}`,
            },
          ],
        },
      ],
    });
  } catch (error) {
    console.error("Failed to send auto-booking Slack notification:", error);
  }
}
