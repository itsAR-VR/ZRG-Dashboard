import { prisma } from "@/lib/prisma";
import type { FollowUpStepData, StepCondition } from "@/actions/followup-sequence-actions";
import { runStructuredJsonPrompt, runTextPrompt } from "@/lib/ai/prompt-runner";
import { sendLinkedInConnectionRequest, sendLinkedInDM } from "@/lib/unipile-api";
import { updateUnipileConnectionHealth } from "@/lib/workspace-integration-health";
import { sendSmsSystem } from "@/lib/system-sender";
import { sendEmailReply } from "@/actions/email-actions";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { getWorkspaceAvailabilitySlotsUtc } from "@/lib/availability-cache";
import { ensureLeadTimezone } from "@/lib/timezone-inference";
import { formatAvailabilitySlots } from "@/lib/availability-format";
import { selectDistributedAvailabilitySlots } from "@/lib/availability-distribution";
import { getWorkspaceSlotOfferCountsForRange, incrementWorkspaceSlotOffersBatch } from "@/lib/slot-offer-ledger";
import { computeStepDeltaMs } from "@/lib/followup-schedule";
import {
  shouldAutoBook,
  bookMeetingForLead,
  getOfferedSlots,
  storeOfferedSlots,
  type OfferedSlot,
} from "@/lib/booking";
import { sendSlackNotification } from "@/lib/slack-notifications";
import { isWorkspaceFollowUpsPaused } from "@/lib/workspace-followups-pause";
import { enrichPhoneThenSyncToGhl } from "@/lib/phone-enrichment";
import { getBookingLink } from "@/lib/meeting-booking-provider";
import { getLeadQualificationAnswerState } from "@/lib/qualification-answer-extraction";
import type { AvailabilitySource } from "@prisma/client";
import { selectBookingTargetForLead } from "@/lib/booking-target-selector";
import {
  renderFollowUpTemplateStrict,
  type FollowUpTemplateError,
  type FollowUpTemplateValueKey,
  type FollowUpTemplateValues,
} from "@/lib/followup-template";

// =============================================================================
// Types
// =============================================================================

interface LeadContext {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
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
  airtableMode?: boolean | null;
  followUpsPausedUntil?: Date | null;
  // New fields for template variables
  aiPersonaName: string | null;
  companyName: string | null;
  targetResult: string | null;
  qualificationQuestions: string | null; // JSON array of questions
  calendarSlotsToShow: number | null;
  meetingBookingProvider?: "GHL" | "CALENDLY" | null;
  calendlyEventTypeLink?: string | null;
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

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function safeTimeZone(timeZone: string | null | undefined, fallback: string): string {
  const tz = timeZone || fallback;
  try {
    // Validate tz; Intl throws RangeError on invalid IANA names.
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return fallback;
  }
}

function getZonedDateTimeParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
} {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
    parts.find((p) => p.type === type)?.value;

  const weekdayLabel = get("weekday") || "Sun";
  const weekday = WEEKDAY_TO_INDEX[weekdayLabel] ?? 0;

  const year = Number.parseInt(get("year") || "0", 10);
  const month = Number.parseInt(get("month") || "1", 10);
  const day = Number.parseInt(get("day") || "1", 10);

  let hour = Number.parseInt(get("hour") || "0", 10);
  if (hour === 24) hour = 0;
  const minute = Number.parseInt(get("minute") || "0", 10);

  return {
    year: Number.isFinite(year) ? year : 0,
    month: Number.isFinite(month) ? month : 1,
    day: Number.isFinite(day) ? day : 1,
    weekday,
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
  };
}

function addDaysToYmd(ymd: { year: number; month: number; day: number }, days: number): {
  year: number;
  month: number;
  day: number;
} {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function zonedTimeToUtc(local: { year: number; month: number; day: number; hour: number; minute: number }, timeZone: string): Date {
  // Initial guess: interpret the local wall-clock time as UTC, then adjust by the observed tz offset.
  let utc = new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0, 0));
  const desiredAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0, 0);

  // Iterate to account for DST/offset differences after adjustment.
  for (let i = 0; i < 3; i++) {
    const actual = getZonedDateTimeParts(utc, timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0, 0);
    const diff = actualAsUtc - desiredAsUtc;
    if (diff === 0) break;
    utc = new Date(utc.getTime() - diff);
  }

  return utc;
}

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

  const timezone = safeTimeZone(settings.timezone, "America/Los_Angeles");
  const { hours: startH, minutes: startM } = parseTime(settings.workStartTime, "09:00");
  const { hours: endH, minutes: endM } = parseTime(settings.workEndTime, "17:00");

  const nowParts = getZonedDateTimeParts(new Date(), timezone);

  // Check weekend (0 = Sunday, 6 = Saturday)
  if (nowParts.weekday === 0 || nowParts.weekday === 6) {
    return false;
  }

  // Convert to minutes for easy comparison
  const currentTotalMinutes = nowParts.hour * 60 + nowParts.minute;
  const startTotalMinutes = startH * 60 + startM;
  const endTotalMinutes = endH * 60 + endM;

  return currentTotalMinutes >= startTotalMinutes && currentTotalMinutes <= endTotalMinutes;
}

/**
 * Get the next available business hour time
 */
export function getNextBusinessHour(settings: WorkspaceSettings | null): Date {
  const timezone = safeTimeZone(settings?.timezone, "America/Los_Angeles");
  const { hours: startH, minutes: startM } = parseTime(settings?.workStartTime, "09:00");
  const { hours: endH, minutes: endM } = parseTime(settings?.workEndTime, "17:00");

  const nowParts = getZonedDateTimeParts(new Date(), timezone);

  const currentTotalMinutes = nowParts.hour * 60 + nowParts.minute;
  const endTotalMinutes = endH * 60 + endM;
  const isWeekend = nowParts.weekday === 0 || nowParts.weekday === 6;

  let targetYmd = { year: nowParts.year, month: nowParts.month, day: nowParts.day };
  let targetWeekday = nowParts.weekday;

  // If we're past end time or on a weekend, move to the next day.
  if (currentTotalMinutes > endTotalMinutes || isWeekend) {
    targetYmd = addDaysToYmd(targetYmd, 1);
    targetWeekday = (targetWeekday + 1) % 7;
  }

  // Skip weekends.
  while (targetWeekday === 0 || targetWeekday === 6) {
    targetYmd = addDaysToYmd(targetYmd, 1);
    targetWeekday = (targetWeekday + 1) % 7;
  }

  // Convert the target local wall-clock time to an actual UTC instant.
  return zonedTimeToUtc({ ...targetYmd, hour: startH, minute: startM }, timezone);
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
 * Generate a follow-up message from template
 * Supports variables (canonical + aliases): see `lib/followup-template.ts`
 *
 * Policy (Phase 73): never send placeholders/fallbacks.
 * - Unknown template variables block sends.
 * - Missing referenced values block sends.
 *
 * This function returns a structured result so callers can pause automation safely.
 */
type GenerateFollowUpMessageResult =
  | { ok: true; content: string; subject: string | null; offeredSlots: OfferedSlot[] }
  | { ok: false; error: string; templateErrors: FollowUpTemplateError[]; offeredSlots: OfferedSlot[] };

function formatTemplateErrors(errors: FollowUpTemplateError[]): string {
  return errors.map((e) => e.message).join("; ");
}

const LEAD_VALUE_KEYS = new Set<FollowUpTemplateValueKey>([
  "firstName",
  "lastName",
  "email",
  "phone",
  "leadCompanyName",
]);

const WORKSPACE_VALUE_KEYS = new Set<FollowUpTemplateValueKey>([
  "aiPersonaName",
  "companyName",
  "targetResult",
  "qualificationQuestion1",
  "qualificationQuestion2",
]);

const BOOKING_VALUE_KEYS = new Set<FollowUpTemplateValueKey>(["bookingLink"]);

const AVAILABILITY_VALUE_KEYS = new Set<FollowUpTemplateValueKey>([
  "availability",
  "timeOption1",
  "timeOption2",
]);

function buildTemplateBlockedPauseReason(errors: FollowUpTemplateError[]): string {
  if (errors.length === 0) return "missing_workspace_setup";

  const leadTokens = new Set<string>();
  const workspaceTokens = new Set<string>();
  const bookingTokens = new Set<string>();
  const availabilityTokens = new Set<string>();

  for (const error of errors) {
    if (error.type === "unknown_token") {
      workspaceTokens.add(error.token);
      continue;
    }
    if (error.type === "spintax_error") {
      workspaceTokens.add("invalid_spintax");
      continue;
    }

    if (LEAD_VALUE_KEYS.has(error.valueKey)) {
      leadTokens.add(error.token);
    } else if (BOOKING_VALUE_KEYS.has(error.valueKey)) {
      bookingTokens.add(error.token);
    } else if (AVAILABILITY_VALUE_KEYS.has(error.valueKey)) {
      availabilityTokens.add(error.token);
    } else {
      workspaceTokens.add(error.token);
    }
  }

  const orderedTokens = [
    ...leadTokens,
    ...workspaceTokens,
    ...bookingTokens,
    ...availabilityTokens,
  ];
  const suffix = orderedTokens.length > 0 ? `: ${orderedTokens.join(", ")}` : "";

  if (leadTokens.size > 0) return `missing_lead_data${suffix}`;
  if (workspaceTokens.size > 0) return `missing_workspace_setup${suffix}`;
  if (bookingTokens.size > 0) return `missing_booking_link${suffix}`;
  if (availabilityTokens.size > 0) return `missing_availability${suffix}`;
  return `missing_workspace_setup${suffix}`;
}

export async function generateFollowUpMessage(
  step: FollowUpStepData,
  lead: LeadContext,
  settings: WorkspaceSettings | null
): Promise<GenerateFollowUpMessageResult> {
  const template = (step.messageTemplate || "").trim();
  if (!template) {
    return {
      ok: false,
      error: "Follow-up step has no message template",
      templateErrors: [],
      offeredSlots: [],
    };
  }

  // Provider-aware booking link for {calendarLink}/{link}
  let bookingLink: string | null = null;
  try {
    bookingLink = await getBookingLink(lead.clientId, settings as any);
  } catch (error) {
    console.error("[FollowUp] Failed to resolve booking link:", error);
    bookingLink = null;
  }

  // Parse qualification questions
  const qualificationQuestions = parseQualificationQuestions(settings?.qualificationQuestions || null);
  const question1 = qualificationQuestions[0]?.question ?? null;
  const question2 = qualificationQuestions[1]?.question ?? null;

  const offeredAtIso = new Date().toISOString();
  const offeredAt = new Date(offeredAtIso);

  const availabilityTokens = [
    "{availability}",
    "{time 1 day 1}",
    "{time 2 day 2}",
    "{x day x time}",
    "{y day y time}",
  ];
  const needsAvailability = availabilityTokens.some(
    (token) => (step.messageTemplate || "").includes(token) || (step.subject || "").includes(token)
  );

  let availabilityText: string | null = null;
  let offeredSlots: OfferedSlot[] = [];
  let slotOption1: string | null = null;
  let slotOption2: string | null = null;

  if (needsAvailability) {
    try {
      const answerState = await getLeadQualificationAnswerState({ leadId: lead.id, clientId: lead.clientId });
      const requestedAvailabilitySource: AvailabilitySource =
        answerState.requiredQuestionIds.length > 0 && !answerState.hasAllRequiredAnswers
          ? "DIRECT_BOOK"
          : "DEFAULT";

      const availability = await getWorkspaceAvailabilitySlotsUtc(lead.clientId, {
        refreshIfStale: true,
        availabilitySource: requestedAvailabilitySource,
      });
      const slotsUtc = availability.slotsUtc;

      if (slotsUtc.length > 0) {
        const tzResult = await ensureLeadTimezone(lead.id);
        const timeZone = tzResult.timezone || settings?.timezone || "UTC";
        const mode = "explicit_tz"; // Always show explicit timezone (e.g., "EST", "PST")

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
        const offerCounts = await getWorkspaceSlotOfferCountsForRange(lead.clientId, anchor, rangeEnd, {
          availabilitySource: availability.availabilitySource,
        });

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
          slotOption1 = formatted[0]!.label;
          slotOption2 = formatted[1]?.label ?? formatted[0]!.label;
          offeredSlots = formatted.map((s) => ({
            datetime: s.datetime,
            label: s.label,
            offeredAt: offeredAtIso,
            availabilitySource: availability.availabilitySource,
          }));
        }
      }
    } catch (error) {
      console.error("[FollowUp] Failed to load availability:", error);
      offeredSlots = [];
    }
  }

  const values: FollowUpTemplateValues = {
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    leadCompanyName: lead.companyName,
    aiPersonaName: settings?.aiPersonaName ?? null,
    companyName: settings?.companyName ?? null,
    targetResult: settings?.targetResult ?? null,
    qualificationQuestion1: question1,
    qualificationQuestion2: question2,
    bookingLink,
    availability: availabilityText,
    timeOption1: slotOption1,
    timeOption2: slotOption2,
  };

  const stepKey = step.id ?? `order-${step.stepOrder}`;
  const spintaxSeed = `${lead.id}:${stepKey}`;

  const renderedContent = renderFollowUpTemplateStrict({ template: step.messageTemplate, values, spintaxSeed });
  if (!renderedContent.ok) {
    return {
      ok: false,
      error: formatTemplateErrors(renderedContent.errors),
      templateErrors: renderedContent.errors,
      offeredSlots,
    };
  }

  const renderedSubject = step.subject
    ? renderFollowUpTemplateStrict({ template: step.subject, values, spintaxSeed })
    : null;
  if (renderedSubject && !renderedSubject.ok) {
    return {
      ok: false,
      error: formatTemplateErrors(renderedSubject.errors),
      templateErrors: renderedSubject.errors,
      offeredSlots,
    };
  }

  return {
    ok: true,
    content: renderedContent.output,
    subject: renderedSubject ? renderedSubject.output : null,
    offeredSlots,
  };
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
    if (process.env.FOLLOWUPS_DRY_RUN === "true") {
      return {
        success: true,
        action: "skipped",
        message: "FOLLOWUPS_DRY_RUN enabled - skipping follow-up execution",
      };
    }

    // Get workspace settings for business hours check
    const client = await prisma.client.findUnique({
      where: { id: lead.clientId },
      include: { settings: true },
    });

    const settings = client?.settings || null;
    const now = new Date();

    // Workspace-level pause: block automated follow-up execution while paused.
    // Manual messaging remains allowed via other actions.
    if (isWorkspaceFollowUpsPaused({ followUpsPausedUntil: settings?.followUpsPausedUntil, now })) {
      const pausedUntil = settings?.followUpsPausedUntil ?? null;

      if (pausedUntil) {
        await prisma.followUpInstance.update({
          where: { id: instanceId },
          data: { nextStepDue: pausedUntil },
        });
      }

      return {
        success: true,
        action: "skipped",
        message: pausedUntil
          ? `Workspace follow-ups paused until ${pausedUntil.toISOString()}`
          : "Workspace follow-ups paused",
      };
    }

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

    // Airtable Mode: email is handled externally (Airtable/n8n via EmailBison).
    // Never execute email steps from follow-up sequences when enabled.
    if (settings?.airtableMode && step.channel === "email") {
      return {
        success: true,
        action: "skipped",
        message: "Airtable Mode enabled - email steps are disabled",
        advance: true,
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
        // No phone and enrichment is not pending (failed, not_found, or not_needed).
        // Try the full phone enrichment pipeline before permanently skipping the SMS step.
        const includeSignatureAi = process.env.PHONE_ENRICHMENT_SIGNATURE_AI_ENABLED === "true";
        const enriched = await enrichPhoneThenSyncToGhl(lead.id, { includeSignatureAi });

        console.log(
          `[FollowUp] SMS step missing phone for lead ${lead.id} (enrichment: ${currentLead?.enrichmentStatus || "none"}). ` +
            `Pipeline result: ${enriched.success ? enriched.source || "unknown" : "error"}`
        );

        // If we triggered Clay, do NOT advance; let the sequence wait/pause.
        if (enriched.source === "clay_triggered") {
          return {
            success: true,
            action: "skipped",
            message: "Waiting for phone enrichment (Clay triggered)",
          };
        }

        // If we found a phone (or tried to sync) we still retry on a later cron run.
        if (enriched.phoneFound) {
          return {
            success: true,
            action: "skipped",
            message: "Phone discovered; retrying SMS on next cron run",
          };
        }

        // Otherwise permanently skip this SMS step and advance the sequence.
        return {
          success: true,
          action: "skipped",
          message: `SMS skipped - no phone number available (enrichment: ${currentLead?.enrichmentStatus || "none"})`,
          advance: true,
        };
      }
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

    // LinkedIn steps: connection request (if not connected) and DMs once connected
    if (step.channel === "linkedin") {
      const currentLead = await prisma.lead.findUnique({
        where: { id: lead.id },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          companyName: true,
          email: true,
          phone: true,
          linkedinUrl: true,
          linkedinId: true,
          linkedinUnreachableAt: true,
          linkedinUnreachableReason: true,
          enrichmentStatus: true,
          enrichmentLastRetry: true,
          updatedAt: true,
          client: { select: { unipileAccountId: true, unipileConnectionStatus: true } },
        },
      });

      if (!currentLead) {
        return { success: false, action: "error", error: "Lead not found" };
      }

      const effectiveLead: LeadContext = {
        ...lead,
        firstName: currentLead.firstName ?? lead.firstName,
        lastName: currentLead.lastName ?? lead.lastName,
        companyName: currentLead.companyName ?? lead.companyName,
        email: currentLead.email ?? lead.email,
        phone: currentLead.phone ?? lead.phone,
        linkedinUrl: currentLead.linkedinUrl,
        linkedinId: currentLead.linkedinId,
      };

      if (!evaluateCondition(effectiveLead, step.condition)) {
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

      const shouldHealthGateUnipile = process.env.UNIPILE_HEALTH_GATE === "1";

      if (shouldHealthGateUnipile && currentLead.linkedinUnreachableAt) {
        await prisma.followUpInstance.update({
          where: { id: instanceId },
          data: {
            status: "paused",
            pausedReason: "linkedin_unreachable",
          },
        });

        return {
          success: true,
          action: "skipped",
          message: `Sequence paused - LinkedIn recipient cannot be reached (${currentLead.linkedinUnreachableReason || "unknown"})`,
        };
      }

      if (shouldHealthGateUnipile && currentLead.client?.unipileConnectionStatus === "DISCONNECTED") {
        await prisma.followUpInstance.update({
          where: { id: instanceId },
          data: {
            status: "paused",
            pausedReason: "unipile_disconnected",
          },
        });

        return {
          success: true,
          action: "skipped",
          message: "Sequence paused - LinkedIn integration disconnected. Reconnect Unipile to resume.",
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

      const generated = await generateFollowUpMessage(step, effectiveLead, settings);
      if (!generated.ok) {
        await prisma.followUpInstance.update({
          where: { id: instanceId },
          data: {
            status: "paused",
            pausedReason: buildTemplateBlockedPauseReason(generated.templateErrors),
          },
        });

        return {
          success: true,
          action: "skipped",
          message: `Sequence paused - follow-up template blocked: ${generated.error}`,
        };
      }

      const { content, offeredSlots } = generated;

      // If connected, send a DM. If not connected, send a connection request with note.
      if (currentLead.linkedinId) {
        const dmResult = await sendLinkedInDM(
          accountId,
          currentLead.linkedinUrl,
          content,
          currentLead.linkedinId
        );

        if (!dmResult.success) {
          // Track disconnected account health for workspace notifications
          if (dmResult.isDisconnectedAccount) {
            await updateUnipileConnectionHealth({
              clientId: lead.clientId,
              isDisconnected: true,
              errorDetail: dmResult.error,
            }).catch((err) => console.error("[FollowUp] Failed to update Unipile health:", err));

            if (shouldHealthGateUnipile) {
              await prisma.followUpInstance.update({
                where: { id: instanceId },
                data: {
                  status: "paused",
                  pausedReason: "unipile_disconnected",
                },
              });

              return {
                success: true,
                action: "skipped",
                message: "Sequence paused - LinkedIn integration disconnected. Reconnect Unipile to resume.",
              };
            }
          }

          if (dmResult.isUnreachableRecipient) {
            await prisma.lead
              .update({
                where: { id: lead.id },
                data: {
                  linkedinUnreachableAt: new Date(),
                  linkedinUnreachableReason: dmResult.error || "Recipient cannot be reached",
                },
              })
              .catch(() => undefined);

            if (shouldHealthGateUnipile) {
              await prisma.followUpInstance.update({
                where: { id: instanceId },
                data: {
                  status: "paused",
                  pausedReason: "linkedin_unreachable",
                },
              });

              return {
                success: true,
                action: "skipped",
                message: "Sequence paused - LinkedIn recipient cannot be reached. Manual intervention required.",
              };
            }
          }
          return { success: false, action: "error", error: dmResult.error || "Failed to send LinkedIn DM" };
        }

        // Success: mark as connected if we had a previous disconnect
        await updateUnipileConnectionHealth({
          clientId: lead.clientId,
          isDisconnected: false,
        }).catch(() => {});

        const sentAt = new Date();
        await prisma.message.create({
          data: {
            leadId: lead.id,
            channel: "linkedin",
            source: "zrg",
            body: content,
            direction: "outbound",
            sentAt,
          },
        });
        await bumpLeadMessageRollup({ leadId: lead.id, direction: "outbound", source: "zrg", sentAt });

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
            availabilitySource:
              offeredSlots[0]?.availabilitySource === "DIRECT_BOOK" ? "DIRECT_BOOK" : "DEFAULT",
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
        // Track disconnected account health for workspace notifications
        if (inviteResult.isDisconnectedAccount) {
          await updateUnipileConnectionHealth({
            clientId: lead.clientId,
            isDisconnected: true,
            errorDetail: inviteResult.error,
          }).catch((err) => console.error("[FollowUp] Failed to update Unipile health:", err));

          if (shouldHealthGateUnipile) {
            await prisma.followUpInstance.update({
              where: { id: instanceId },
              data: {
                status: "paused",
                pausedReason: "unipile_disconnected",
              },
            });

            return {
              success: true,
              action: "skipped",
              message: "Sequence paused - LinkedIn integration disconnected. Reconnect Unipile to resume.",
            };
          }
        }

        if (inviteResult.isUnreachableRecipient) {
          await prisma.lead
            .update({
              where: { id: lead.id },
              data: {
                linkedinUnreachableAt: new Date(),
                linkedinUnreachableReason: inviteResult.error || "Recipient cannot be reached",
              },
            })
            .catch(() => undefined);

          if (shouldHealthGateUnipile) {
            await prisma.followUpInstance.update({
              where: { id: instanceId },
              data: {
                status: "paused",
                pausedReason: "linkedin_unreachable",
              },
            });

            return {
              success: true,
              action: "skipped",
              message: "Sequence paused - LinkedIn recipient cannot be reached. Manual intervention required.",
            };
          }
        }
        return {
          success: false,
          action: "error",
          error: inviteResult.error || "Failed to send LinkedIn connection request",
        };
      }

      // Success: mark as connected if we had a previous disconnect
      await updateUnipileConnectionHealth({
        clientId: lead.clientId,
        isDisconnected: false,
      }).catch(() => {});

      const sentAt = new Date();
      await prisma.message.create({
        data: {
          leadId: lead.id,
          channel: "linkedin",
          source: "zrg",
          body: content,
          direction: "outbound",
          sentAt,
        },
      });
      await bumpLeadMessageRollup({ leadId: lead.id, direction: "outbound", source: "zrg", sentAt });

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
          availabilitySource:
            offeredSlots[0]?.availabilitySource === "DIRECT_BOOK" ? "DIRECT_BOOK" : "DEFAULT",
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

    // Generate message content (strict: never send placeholders/fallbacks)
    const generated = await generateFollowUpMessage(step, lead, settings);
    if (!generated.ok) {
      await prisma.followUpInstance.update({
        where: { id: instanceId },
        data: {
          status: "paused",
          pausedReason: buildTemplateBlockedPauseReason(generated.templateErrors),
        },
      });

      return {
        success: true,
        action: "skipped",
        message: `Sequence paused - follow-up template blocked: ${generated.error}`,
      };
    }

    const { content, subject, offeredSlots } = generated;

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
          availabilitySource:
            offeredSlots[0]?.availabilitySource === "DIRECT_BOOK" ? "DIRECT_BOOK" : "DEFAULT",
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
      const sendResult = await sendSmsSystem(lead.id, content);
      if (!sendResult.success) {
        const msg = sendResult.error || "Failed to send SMS";
        const lower = msg.toLowerCase();

        // Contact is in SMS DND in GHL. Marked on the lead by sendSmsSystem().
        // Treat as non-retriable for follow-up sequences so cron doesn't loop on permanent DND.
        if (
          sendResult.errorCode === "sms_dnd" ||
          lower.includes("dnd is active for sms") ||
          (lower.includes("dnd is active") && lower.includes("sms"))
        ) {
          await prisma.followUpTask
            .create({
              data: {
                leadId: lead.id,
                type: "sms",
                dueDate: new Date(),
                status: "skipped",
                suggestedMessage: content,
                instanceId: instanceId,
                stepOrder: step.stepOrder,
              },
            })
            .catch(() => undefined);

          console.log(`[FollowUp] SMS step skipped for lead ${lead.id} - DND active in GHL`);
          return {
            success: true,
            action: "skipped",
            message: "SMS skipped - DND active in GoHighLevel",
            advance: true,
          };
        }

        // Avoid hard-failing and retry-spamming cron when SMS is impossible (most commonly: no phone on contact).
        if (
          lower.includes("missing phone") ||
          lower.includes("phone missing") ||
          lower.includes("no usable phone") ||
          lower.includes("no phone")
        ) {
          console.log(`[FollowUp] SMS step skipped for lead ${lead.id} - ${msg}`);
          return {
            success: true,
            action: "skipped",
            message: `SMS skipped - ${msg}`,
            advance: true,
          };
        }

        return {
          success: false,
          action: "error",
          error: msg,
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
          availabilitySource:
            offeredSlots[0]?.availabilitySource === "DIRECT_BOOK" ? "DIRECT_BOOK" : "DEFAULT",
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

function shouldPauseSequenceOnLeadReply(sequence: { name: string; triggerOn: string }): boolean {
  // Phase 71: Any inbound reply pauses automation. Follow-ups only resume after
  // an outbound reply (AI or setter), and should continue from the current step.
  return true;
}

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
          autoFollowUpEnabled: true,
          OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
          client: {
            OR: [
              { settings: { is: null } },
              {
                settings: {
                  is: {
                    OR: [{ followUpsPausedUntil: null }, { followUpsPausedUntil: { lte: now } }],
                  },
                },
              },
            ],
          },
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

      // Safety: if the lead has replied since the latest outbound touch, pause the instance so we don't
      // keep sending follow-ups while the conversation is active. Automation resumes on the next outbound reply.
      const leadHasRepliedSinceLatestOutbound =
        instance.lead.lastMessageDirection === "inbound" ||
        (instance.lead.lastInboundAt &&
          instance.lead.lastOutboundAt &&
          instance.lead.lastInboundAt > instance.lead.lastOutboundAt);

      const shouldPauseForConversation =
        shouldPauseSequenceOnLeadReply({
          name: instance.sequence.name,
          triggerOn: instance.sequence.triggerOn,
        }) &&
        leadHasRepliedSinceLatestOutbound;

      if (shouldPauseForConversation) {
        await prisma.followUpInstance.update({
          where: { id: instance.id },
          data: {
            status: "paused",
            pausedReason: "lead_replied",
          },
        });
        results.skipped++;
        continue;
      }

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
        companyName: instance.lead.companyName ?? null,
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
              const deltaMs = computeStepDeltaMs(nextStep, nextNextStep);
              const nextDue = new Date(Date.now() + deltaMs);

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
              const deltaMs = computeStepDeltaMs(nextStep, nextNextStep);
              const nextDue = new Date(Date.now() + deltaMs);

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
    const instances = await prisma.followUpInstance.findMany({
      where: {
        leadId,
        status: "active",
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
 * Pause follow-up instances when a meeting is booked.
 * Leaves meeting-selected sequences running and prevents other sequences from sending.
 */
export async function pauseFollowUpsOnBooking(
  leadId: string,
  opts?: { mode?: "complete" | "pause" }
): Promise<{ completedCount: number; pausedCount: number }> {
  try {
    const mode = opts?.mode ?? "complete";
    const instances = await prisma.followUpInstance.findMany({
      where: {
        leadId,
        status: { in: ["active", "paused"] },
        sequence: { triggerOn: { not: "meeting_selected" } },
      },
      select: { id: true },
    });

    if (instances.length === 0) return { completedCount: 0, pausedCount: 0 };

    const ids = instances.map((i) => i.id);

    if (mode === "complete") {
      await prisma.followUpInstance.updateMany({
        where: { id: { in: ids } },
        data: {
          status: "completed",
          completedAt: new Date(),
          nextStepDue: null,
        },
      });
      return { completedCount: ids.length, pausedCount: 0 };
    }

    await prisma.followUpInstance.updateMany({
      where: { id: { in: ids } },
      data: {
        status: "paused",
        pausedReason: "meeting_booked",
        nextStepDue: null,
      },
    });

    return { completedCount: 0, pausedCount: ids.length };
  } catch (error) {
    console.error("Failed to pause follow-ups on booking:", error);
    return { completedCount: 0, pausedCount: 0 };
  }
}

/**
 * Resume follow-up instances that were paused due to a booking after the booking is canceled.
 */
export async function resumeFollowUpsOnBookingCanceled(leadId: string): Promise<{ resumedCount: number }> {
  try {
    const now = new Date();
    const instances = await prisma.followUpInstance.findMany({
      where: {
        leadId,
        status: "paused",
        pausedReason: "meeting_booked",
      },
      select: {
        id: true,
        lead: {
          select: {
            autoFollowUpEnabled: true,
            snoozedUntil: true,
            client: { select: { settings: { select: { followUpsPausedUntil: true } } } },
          },
        },
      },
    });

    if (instances.length === 0) return { resumedCount: 0 };

    let resumed = 0;
    for (const instance of instances) {
      if (!instance.lead.autoFollowUpEnabled) continue;
      if (instance.lead.snoozedUntil && instance.lead.snoozedUntil > now) continue;
      if (
        isWorkspaceFollowUpsPaused({
          followUpsPausedUntil: instance.lead.client.settings?.followUpsPausedUntil,
          now,
        })
      ) {
        continue;
      }

      await prisma.followUpInstance.update({
        where: { id: instance.id },
        data: {
          status: "active",
          pausedReason: null,
          nextStepDue: new Date(),
        },
      });
      resumed++;
    }

    return { resumedCount: resumed };
  } catch (error) {
    console.error("Failed to resume follow-ups on booking cancellation:", error);
    return { resumedCount: 0 };
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
      lead: {
        select: {
          autoFollowUpEnabled: true,
          client: { select: { settings: { select: { followUpsPausedUntil: true } } } },
        },
      },
    },
  });

  for (const instance of paused) {
    results.checked++;

    if (!instance.lead.autoFollowUpEnabled) {
      continue;
    }

    if (
      isWorkspaceFollowUpsPaused({
        followUpsPausedUntil: instance.lead.client.settings?.followUpsPausedUntil,
        now,
      })
    ) {
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
 * Policy: only resume if the most recent message is outbound (we're the latest toucher),
 * and the most recent inbound message is older than N days.
 */
export async function resumeGhostedFollowUps(opts?: {
  days?: number;
  limit?: number;
}): Promise<{ checked: number; resumed: number; errors: string[] }> {
  const days = opts?.days ?? 7;
  const limit = opts?.limit ?? 100;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const now = new Date();

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
      lead: {
        select: {
          autoFollowUpEnabled: true,
          snoozedUntil: true,
          client: { select: { settings: { select: { followUpsPausedUntil: true } } } },
        },
      },
    },
  });

  for (const instance of paused) {
    results.checked++;

    if (!instance.lead.autoFollowUpEnabled) {
      continue;
    }

    try {
      if (
        isWorkspaceFollowUpsPaused({
          followUpsPausedUntil: instance.lead.client.settings?.followUpsPausedUntil,
          now,
        })
      ) {
        continue;
      }

      if (instance.lead.snoozedUntil && instance.lead.snoozedUntil > new Date()) {
        continue;
      }
      const lastMessage = await prisma.message.findFirst({
        where: { leadId: instance.leadId },
        orderBy: { sentAt: "desc" },
        select: { direction: true },
      });

      // Never resume if the lead is the most recent sender.
      if (!lastMessage || lastMessage.direction !== "outbound") {
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

/**
 * Resume follow-up instances that were paused because we were waiting on enrichment
 * (e.g., missing phone for SMS or missing LinkedIn URL for LinkedIn steps).
 *
 * Policy: only resume when the next step's channel prerequisites are now satisfied.
 */
export async function resumeAwaitingEnrichmentFollowUps(opts?: {
  limit?: number;
}): Promise<{ checked: number; resumed: number; errors: string[] }> {
  const limit = opts?.limit ?? 200;
  const now = new Date();

  const results = { checked: 0, resumed: 0, errors: [] as string[] };

  const paused = await prisma.followUpInstance.findMany({
    where: { status: "paused", pausedReason: "awaiting_enrichment" },
    take: limit,
    include: {
      lead: {
        select: {
          id: true,
          phone: true,
          linkedinUrl: true,
          enrichmentStatus: true,
          autoFollowUpEnabled: true,
          snoozedUntil: true,
          client: { select: { settings: { select: { followUpsPausedUntil: true } } } },
        },
      },
      sequence: {
        include: {
          steps: { orderBy: { stepOrder: "asc" } },
        },
      },
    },
  });

  for (const instance of paused) {
    results.checked++;

    if (!instance.lead.autoFollowUpEnabled) continue;
    if (instance.lead.snoozedUntil && instance.lead.snoozedUntil > now) continue;

    if (
      isWorkspaceFollowUpsPaused({
        followUpsPausedUntil: instance.lead.client.settings?.followUpsPausedUntil,
        now,
      })
    ) {
      continue;
    }

    const nextStep = instance.sequence.steps.find((s) => s.stepOrder > instance.currentStep);
    if (!nextStep) {
      continue;
    }

    const channel = nextStep.channel;
    const enrichmentTerminal =
      instance.lead.enrichmentStatus === "failed" || instance.lead.enrichmentStatus === "not_found";
    if (channel === "sms" && !instance.lead.phone && !enrichmentTerminal) continue;
    if (channel === "linkedin" && !instance.lead.linkedinUrl) continue;

    try {
      // If we timed out enrichment and still don't have phone, advance past the SMS step so the sequence doesn't get stuck.
      if (channel === "sms" && !instance.lead.phone && enrichmentTerminal) {
        const nextNextStep = instance.sequence.steps.find((s) => s.stepOrder > nextStep.stepOrder);

        if (nextNextStep) {
          const deltaMs = computeStepDeltaMs(nextStep, nextNextStep);
          const nextDue = new Date(Date.now() + deltaMs);
          await prisma.followUpInstance.update({
            where: { id: instance.id },
            data: {
              status: "active",
              pausedReason: null,
              currentStep: nextStep.stepOrder,
              lastStepAt: new Date(),
              nextStepDue: nextDue,
            },
          });
        } else {
          await prisma.followUpInstance.update({
            where: { id: instance.id },
            data: {
              status: "completed",
              pausedReason: null,
              currentStep: nextStep.stepOrder,
              lastStepAt: new Date(),
              nextStepDue: null,
              completedAt: new Date(),
            },
          });
        }

        results.resumed++;
      } else {
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
      results.errors.push(`${instance.id}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  return results;
}

export async function resumeAwaitingEnrichmentFollowUpsForLead(
  leadId: string
): Promise<{ success: boolean; resumed?: number; error?: string }> {
  try {
    const now = new Date();
    const instances = await prisma.followUpInstance.findMany({
      where: { leadId, status: "paused", pausedReason: "awaiting_enrichment" },
      include: {
        lead: {
          select: {
            phone: true,
            linkedinUrl: true,
            enrichmentStatus: true,
            autoFollowUpEnabled: true,
            snoozedUntil: true,
            client: { select: { settings: { select: { followUpsPausedUntil: true } } } },
          },
        },
        sequence: { include: { steps: { orderBy: { stepOrder: "asc" } } } },
      },
    });

    if (instances.length === 0) return { success: true, resumed: 0 };

    let resumed = 0;
    for (const instance of instances) {
      if (!instance.lead.autoFollowUpEnabled) continue;
      if (instance.lead.snoozedUntil && instance.lead.snoozedUntil > now) continue;

      if (
        isWorkspaceFollowUpsPaused({
          followUpsPausedUntil: instance.lead.client.settings?.followUpsPausedUntil,
          now,
        })
      ) {
        continue;
      }

      const nextStep = instance.sequence.steps.find((s) => s.stepOrder > instance.currentStep);
      if (!nextStep) continue;

      const channel = nextStep.channel;
      const enrichmentTerminal =
        instance.lead.enrichmentStatus === "failed" || instance.lead.enrichmentStatus === "not_found";
      if (channel === "sms" && !instance.lead.phone && !enrichmentTerminal) continue;
      if (channel === "linkedin" && !instance.lead.linkedinUrl) continue;

      if (channel === "sms" && !instance.lead.phone && enrichmentTerminal) {
        const nextNextStep = instance.sequence.steps.find((s) => s.stepOrder > nextStep.stepOrder);

        if (nextNextStep) {
          const deltaMs = computeStepDeltaMs(nextStep, nextNextStep);
          const nextDue = new Date(Date.now() + deltaMs);
          await prisma.followUpInstance.update({
            where: { id: instance.id },
            data: {
              status: "active",
              pausedReason: null,
              currentStep: nextStep.stepOrder,
              lastStepAt: new Date(),
              nextStepDue: nextDue,
            },
          });
        } else {
          await prisma.followUpInstance.update({
            where: { id: instance.id },
            data: {
              status: "completed",
              pausedReason: null,
              currentStep: nextStep.stepOrder,
              lastStepAt: new Date(),
              nextStepDue: null,
              completedAt: new Date(),
            },
          });
        }

        resumed++;
      } else {
        await prisma.followUpInstance.update({
          where: { id: instance.id },
          data: { status: "active", pausedReason: null, nextStepDue: new Date() },
        });
        resumed++;
      }
    }

    return { success: true, resumed };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to resume follow-ups" };
  }
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

    const model = "gpt-5-mini";
    const result = await runTextPrompt({
      pattern: "text",
      clientId: meta.clientId,
      leadId: meta.leadId,
      promptKey: "followup.parse_accepted_time.v1",
      model,
      reasoningEffort: "low",
      systemFallback: "Match the message to one of the provided slots; reply with a slot number or NONE.\n\n{slotContext}",
      templateVars: { slotContext },
      input: message,
      budget: {
        min: 800,
        max: 1200,
        retryMax: 1600,
        overheadTokens: 128,
        outputScale: 0.1,
        preferApiCount: true,
      },
    });

    if (!result.success) return null;

    const aiResponse = result.data.trim();

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

type ProposedTimesParseResult = {
  proposedStartTimesUtc: string[];
  confidence: number;
  needsTimezoneClarification: boolean;
};

function normalizeUtcIsoOrNull(value: string): string | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function parseProposedTimesFromMessage(
  message: string,
  meta: {
    clientId: string;
    leadId?: string | null;
    nowUtcIso: string;
    leadTimezone: string | null;
  }
): Promise<ProposedTimesParseResult | null> {
  const messageTrimmed = (message || "").trim();
  if (!messageTrimmed) return null;

  const nowUtcIso = normalizeUtcIsoOrNull(meta.nowUtcIso) || new Date().toISOString();
  const leadTimezone = (meta.leadTimezone || "").trim();
  const tzForPrompt = leadTimezone || "UNKNOWN";

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      proposed_start_times_utc: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
      needs_timezone_clarification: { type: "boolean" },
    },
    required: ["proposed_start_times_utc", "confidence", "needs_timezone_clarification"],
  } as const;

  const validate = (value: unknown): { success: true; data: ProposedTimesParseResult } | { success: false; error: string } => {
    if (!value || typeof value !== "object") return { success: false, error: "not_an_object" };
    const record = value as Record<string, unknown>;

    const proposedRaw = record.proposed_start_times_utc;
    const confidenceRaw = record.confidence;
    const needsTzRaw = record.needs_timezone_clarification;

    if (!Array.isArray(proposedRaw)) return { success: false, error: "proposed_start_times_utc_not_array" };
    if (typeof confidenceRaw !== "number" || !Number.isFinite(confidenceRaw)) {
      return { success: false, error: "confidence_not_number" };
    }
    if (typeof needsTzRaw !== "boolean") return { success: false, error: "needs_timezone_clarification_not_boolean" };

    const normalized = proposedRaw
      .map((t) => (typeof t === "string" ? normalizeUtcIsoOrNull(t) : null))
      .filter((t): t is string => !!t);
    const deduped = Array.from(new Set(normalized)).sort().slice(0, 3);

    const confidence = Math.max(0, Math.min(1, confidenceRaw));

    return {
      success: true,
      data: {
        proposedStartTimesUtc: deduped,
        confidence,
        needsTimezoneClarification: needsTzRaw,
      },
    };
  };

  const model = "gpt-5-mini";
  const result = await runStructuredJsonPrompt<ProposedTimesParseResult>({
    pattern: "structured_json",
    clientId: meta.clientId,
    leadId: meta.leadId,
    promptKey: "followup.parse_proposed_times.v1",
    featureId: "followup.parse_proposed_times",
    model,
    reasoningEffort: "low",
    systemFallback: `You extract proposed meeting start times from a message and output UTC ISO datetimes.

Context:
- now_utc: {{nowUtcIso}}
- lead_timezone: {{leadTimezone}} (IANA timezone or UNKNOWN)

Rules:
- Only output proposed_start_times_utc when the message clearly proposes a specific date + time to meet.
- Use lead_timezone to interpret dates/times. If lead_timezone is UNKNOWN and the message does not include an explicit timezone, set needs_timezone_clarification=true and output an empty list.
- If times are vague (e.g., "tomorrow morning", "next week", "sometime Tuesday"), output an empty list and set confidence <= 0.5.
- Output at most 3 start times, sorted ascending, deduped.

Output JSON.`,
    templateVars: { nowUtcIso, leadTimezone: tzForPrompt },
    input: messageTrimmed,
    schemaName: "proposed_times",
    schema,
    budget: {
      min: 256,
      max: 800,
      retryMax: 1400,
      overheadTokens: 192,
      outputScale: 0.15,
      preferApiCount: true,
    },
    validate,
  });

  if (!result.success) return null;
  return result.data;
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

    const model = "gpt-5-mini";
    const result = await runTextPrompt({
      pattern: "text",
      clientId: meta.clientId,
      leadId: meta.leadId,
      promptKey: "followup.detect_meeting_accept_intent.v1",
      model,
      reasoningEffort: "low",
      systemFallback: "Determine if the message indicates acceptance. Reply YES or NO.",
      input: message,
      budget: {
        min: 512,
        max: 800,
        retryMax: 1200,
        overheadTokens: 96,
        outputScale: 0.1,
        preferApiCount: true,
      },
    });

    if (!result.success) return false;

    return result.data.trim().toUpperCase() === "YES";
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
  messageBody: string,
  meta?: { channel?: "sms" | "email" | "linkedin" }
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

    // Get offered slots for this lead
    const offeredSlots = await getOfferedSlots(leadId);
    const preferred = meta?.channel;

    const pickTaskType = async (): Promise<"sms" | "email" | "linkedin" | "call"> => {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { phone: true, email: true, linkedinUrl: true },
      });

      const preferredSendable =
        preferred === "sms"
          ? Boolean(lead?.phone)
          : preferred === "email"
            ? Boolean(lead?.email)
            : preferred === "linkedin"
              ? Boolean(lead?.linkedinUrl)
              : false;

      if (preferredSendable) return preferred!;
      if (lead?.phone) return "sms";
      if (lead?.email) return "email";
      if (lead?.linkedinUrl) return "linkedin";
      return "call";
    };

    // Scenario 1/2: lead accepts one of the offered slots.
    if (offeredSlots.length > 0) {
      // Detect if the message indicates meeting acceptance
      const isMeetingAccepted = await detectMeetingAcceptedIntent(messageBody, {
        clientId: leadMeta.clientId,
        leadId: leadMeta.id,
      });
      if (!isMeetingAccepted) {
        return { booked: false };
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
          select: { id: true, sentimentTag: true },
        });

        const type = await pickTaskType();
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
      const bookingResult = await bookMeetingForLead(leadId, acceptedSlot.datetime, {
        availabilitySource: acceptedSlot.availabilitySource,
      });
      if (bookingResult.success) {
        // Send Slack notification for auto-booking
        await sendAutoBookingSlackNotification(leadId, acceptedSlot);

        return {
          booked: true,
          appointmentId: bookingResult.appointmentId,
        };
      }

      return { booked: false, error: bookingResult.error };
    }

    // Scenario 3: no offered slots; lead proposes their own time.
    const messageTrimmed = (messageBody || "").trim();
    const looksLikeTimeProposal =
      /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day)?\b/i.test(messageTrimmed) ||
      /\b(tomorrow|today|next week|next)\b/i.test(messageTrimmed) ||
      /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(messageTrimmed) ||
      /\b\d{1,2}\/\d{1,2}\b/.test(messageTrimmed) ||
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(messageTrimmed);

    if (!looksLikeTimeProposal) {
      return { booked: false };
    }

    const tzResult = await ensureLeadTimezone(leadId);

    const proposed = await parseProposedTimesFromMessage(messageTrimmed, {
      clientId: leadMeta.clientId,
      leadId: leadMeta.id,
      nowUtcIso: new Date().toISOString(),
      leadTimezone: tzResult.timezone || null,
    });

    if (!proposed) {
      return { booked: false };
    }

    if (proposed.needsTimezoneClarification) {
      const type = await pickTaskType();
      await prisma.followUpTask.create({
        data: {
          leadId,
          type,
          dueDate: new Date(),
          status: "pending",
          suggestedMessage: "What timezone are you in for that time?",
        },
      });
      return { booked: false };
    }

    if (proposed.proposedStartTimesUtc.length === 0) {
      return { booked: false };
    }

    const bookingTarget = await selectBookingTargetForLead({
      clientId: leadMeta.clientId,
      leadId: leadMeta.id,
    });
    const requestedAvailabilitySource: AvailabilitySource =
      bookingTarget.target === "no_questions" ? "DIRECT_BOOK" : "DEFAULT";

    const availability = await getWorkspaceAvailabilitySlotsUtc(leadMeta.clientId, {
      refreshIfStale: true,
      availabilitySource: requestedAvailabilitySource,
    });
    const availabilitySet = new Set(availability.slotsUtc);

    const match = proposed.proposedStartTimesUtc.find((iso) => availabilitySet.has(iso)) ?? null;

    const HIGH_CONFIDENCE_THRESHOLD = 0.9;

    if (match && proposed.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
      const bookingResult = await bookMeetingForLead(leadId, match, {
        availabilitySource: availability.availabilitySource,
      });
      if (bookingResult.success) {
        return { booked: true, appointmentId: bookingResult.appointmentId };
      }
      return { booked: false, error: bookingResult.error };
    }

    // Not safe to auto-book (low confidence or no matching availability). Offer alternatives.
    const type = await pickTaskType();
    const timeZone = tzResult.timezone || "UTC";
    const mode = "explicit_tz"; // Always show explicit timezone (e.g., "EST", "PST")

    const anchor = new Date();
    const rangeEnd = new Date(anchor.getTime() + 30 * 24 * 60 * 60 * 1000);
    const offerCounts = await getWorkspaceSlotOfferCountsForRange(leadMeta.clientId, anchor, rangeEnd, {
      availabilitySource: availability.availabilitySource,
    });

    const selectedUtcIso = selectDistributedAvailabilitySlots({
      slotsUtcIso: availability.slotsUtc,
      offeredCountBySlotUtcIso: offerCounts,
      timeZone,
      preferWithinDays: 5,
      now: anchor,
    });

    const formatted = formatAvailabilitySlots({
      slotsUtcIso: selectedUtcIso,
      timeZone,
      mode,
      limit: Math.max(2, selectedUtcIso.length),
    });

    if (formatted.length > 0) {
      const offeredAtIso = new Date().toISOString();
      const offered = formatted.slice(0, 2).map((s) => ({
        datetime: s.datetime,
        label: s.label,
        offeredAt: offeredAtIso,
        availabilitySource: availability.availabilitySource,
      }));

      await storeOfferedSlots(leadId, offered);
      incrementWorkspaceSlotOffersBatch({
        clientId: leadMeta.clientId,
        slotUtcIsoList: offered.map((s) => s.datetime),
        offeredAt: new Date(offeredAtIso),
        availabilitySource: availability.availabilitySource,
      }).catch(() => undefined);

      const suggestion =
        offered.length === 2
          ? `I don’t have that exact time available — does (1) ${offered[0]!.label} or (2) ${offered[1]!.label} work instead?`
          : `I don’t have that exact time available — does ${offered[0]!.label} work instead?`;

      await prisma.followUpTask.create({
        data: {
          leadId,
          type,
          dueDate: new Date(),
          status: "pending",
          suggestedMessage: suggestion,
        },
      });
    } else {
      await prisma.followUpTask.create({
        data: {
          leadId,
          type,
          dueDate: new Date(),
          status: "pending",
          suggestedMessage: "The lead proposed a time, but no availability match was found. Please propose alternative times.",
        },
      });
    }

    return { booked: false };
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
