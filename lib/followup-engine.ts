import { isPrismaUniqueConstraintError, prisma } from "@/lib/prisma";
import type { FollowUpStepData, StepCondition } from "@/actions/followup-sequence-actions";
import { runStructuredJsonPrompt, runTextPrompt } from "@/lib/ai/prompt-runner";
import { sanitizeAiInteractionMetadata } from "@/lib/ai/openai-telemetry";
import { sendLinkedInConnectionRequest, sendLinkedInDM } from "@/lib/unipile-api";
import { updateUnipileConnectionHealth } from "@/lib/workspace-integration-health";
import { sendLinkedInMessageSystem, sendSmsSystem } from "@/lib/system-sender";
import { sendEmailReply } from "@/actions/email-actions";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { getWorkspaceAvailabilitySlotsUtc } from "@/lib/availability-cache";
import { ensureLeadTimezone, isValidIanaTimezone } from "@/lib/timezone-inference";
import { formatAvailabilitySlotLabel, formatAvailabilitySlots } from "@/lib/availability-format";
import { selectDistributedAvailabilitySlots } from "@/lib/availability-distribution";
import { getWorkspaceSlotOfferCountsForRange, incrementWorkspaceSlotOffersBatch } from "@/lib/slot-offer-ledger";
import { computeStepDeltaMs } from "@/lib/followup-schedule";
import { recordAiRouteSkip } from "@/lib/ai/route-skip-observability";
import {
  shouldAutoBook,
  bookMeetingForLead,
  getOfferedSlots,
  storeOfferedSlots,
  type OfferedSlot,
} from "@/lib/booking";
import { sendSlackNotification } from "@/lib/slack-notifications";
import { isWorkspaceFollowUpsPaused } from "@/lib/workspace-followups-pause";
import { triggerEnrichmentForLead } from "@/lib/clay-api";
import { getBookingLink } from "@/lib/meeting-booking-provider";
import { getLeadQualificationAnswerState } from "@/lib/qualification-answer-extraction";
import type { AvailabilitySource, Prisma } from "@prisma/client";
import { selectBookingTargetForLead } from "@/lib/booking-target-selector";
import { resolveFollowUpPersonaContext, type FollowUpPersonaContext } from "@/lib/followup-persona";
import {
  renderFollowUpTemplateStrict,
  type FollowUpTemplateError,
  type FollowUpTemplateValueKey,
  type FollowUpTemplateValues,
} from "@/lib/followup-template";
import { resolveEmailIntegrationProvider } from "@/lib/email-integration";
import { sendEmailReplySystem } from "@/lib/email-send";
import { mergeLinkedInFields, normalizeLinkedInUrl } from "@/lib/linkedin-utils";
import {
  runMeetingOverseerExtraction,
  selectOfferedSlotByPreference,
  type MeetingOverseerExtractDecision,
} from "@/lib/meeting-overseer";
import { isAutoBookingBlockedSentiment } from "@/lib/sentiment-shared";
import { computeAIDraftResponseDisposition } from "@/lib/ai-drafts/response-disposition";
import {
  buildLeadContextBundle,
  buildLeadContextBundleTelemetryMetadata,
  isLeadContextBundleGloballyDisabled,
} from "@/lib/lead-context-bundle";
import { CONFIDENCE_POLICY_KEYS, resolveThreshold } from "@/lib/confidence-policy";

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
  // Phase 112: shared LeadContextBundle rollout toggles (super-admin controlled).
  leadContextBundleEnabled?: boolean | null;
  leadContextBundleBudgets?: unknown | null;
  followupBookingGateEnabled?: boolean | null;
  meetingOverseerEnabled?: boolean | null;
  // New fields for template variables
  aiPersonaName: string | null;
  aiSignature: string | null;
  companyName: string | null;
  targetResult: string | null;
  qualificationQuestions: string | null; // JSON array of questions
  calendarSlotsToShow: number | null;
  meetingBookingProvider?: "GHL" | "CALENDLY" | null;
  calendlyEventTypeLink?: string | null;
}

type LeadForAutoBookingConfirmation = Prisma.LeadGetPayload<{
  include: {
    client: {
      include: {
        emailBisonBaseHost: { select: { host: true } };
        settings: true;
      };
    };
  };
}>;

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

const EMAIL_DRAFT_ALREADY_SENDING_ERROR = "Draft is already being sent";

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

const WEEKDAY_TOKEN_TO_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export type WeekdayToken = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type TimeOfDayToken = "morning" | "afternoon" | "evening";

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

function resolveWeekdayToken(token: string | null | undefined): number | null {
  if (!token) return null;
  const normalized = token.trim().toLowerCase();
  return WEEKDAY_TOKEN_TO_INDEX[normalized] ?? null;
}

function normalizeTimeOfDayToken(value: string | null | undefined): TimeOfDayToken | null {
  const raw = (value || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.startsWith("morn")) return "morning";
  if (raw.startsWith("after")) return "afternoon";
  if (raw.startsWith("even")) return "evening";
  return null;
}

function matchesTimeOfDay(hour: number, pref: TimeOfDayToken): boolean {
  if (!Number.isFinite(hour)) return false;
  if (pref === "morning") return hour >= 5 && hour < 12;
  if (pref === "afternoon") return hour >= 12 && hour < 17;
  if (pref === "evening") return hour >= 17 && hour < 21;
  return false;
}

function detectWeekdayTokenFromText(message: string): WeekdayToken | null {
  const text = (message || "").toLowerCase();
  if (!text) return null;
  if (/\bmon(day)?\b/.test(text)) return "mon";
  if (/\btue(s|sday)?\b/.test(text) || /\btues(day)?\b/.test(text)) return "tue";
  if (/\bwed(nesday)?\b/.test(text)) return "wed";
  if (/\bthu(rs|rsday)?\b/.test(text) || /\bthur(s|sday)?\b/.test(text)) return "thu";
  if (/\bfri(day)?\b/.test(text)) return "fri";
  if (/\bsat(urday)?\b/.test(text)) return "sat";
  if (/\bsun(day)?\b/.test(text)) return "sun";
  return null;
}

function resolveRelativeDateToWeekdayToken(
  relativePreference: string | null | undefined,
  timeZone: string
): WeekdayToken | null {
  const pref = (relativePreference || "").trim().toLowerCase();
  if (!pref) return null;

  let targetDate: Date | null = null;
  const now = new Date();
  if (pref.includes("today")) {
    targetDate = now;
  } else if (pref.includes("tomorrow")) {
    targetDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  } else {
    return null;
  }

  const INDEX_TO_TOKEN: WeekdayToken[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const parts = getZonedDateTimeParts(targetDate, safeTimeZone(timeZone, "UTC"));
  return INDEX_TO_TOKEN[parts.weekday] ?? null;
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

/**
 * Select the earliest UTC slot that falls on the requested weekday in the given timezone.
 * Returns a normalized UTC ISO string, or null when no matching slot exists.
 */
export function selectEarliestSlotForWeekday(opts: {
  slotsUtcIso: string[];
  weekdayToken: string;
  timeZone: string;
  preferredTimeOfDay?: string | null;
}): string | null {
  const weekdayIndex = resolveWeekdayToken(opts.weekdayToken);
  if (weekdayIndex === null) return null;

  const timeZone = safeTimeZone(opts.timeZone, "UTC");
  const timePreference = normalizeTimeOfDayToken(opts.preferredTimeOfDay ?? null);
  let bestUtcAny: Date | null = null;
  let bestUtcByTimeOfDay: Date | null = null;

  for (const slotUtcIso of opts.slotsUtcIso) {
    const slotUtc = new Date(slotUtcIso);
    if (Number.isNaN(slotUtc.getTime())) continue;

    const parts = getZonedDateTimeParts(slotUtc, timeZone);
    if (parts.weekday !== weekdayIndex) continue;

    if (!bestUtcAny || slotUtc.getTime() < bestUtcAny.getTime()) bestUtcAny = slotUtc;
    if (
      timePreference &&
      matchesTimeOfDay(parts.hour, timePreference) &&
      (!bestUtcByTimeOfDay || slotUtc.getTime() < bestUtcByTimeOfDay.getTime())
    ) {
      bestUtcByTimeOfDay = slotUtc;
    }
  }

  const bestUtc = bestUtcByTimeOfDay || bestUtcAny;
  return bestUtc ? bestUtc.toISOString() : null;
}

function findNearestAvailableSlot(
  proposedUtcIso: string,
  slotsUtcIso: string[],
  windowMs: number
): {
  slotUtcIso: string;
  strategy: Exclude<AutoBookingMatchStrategy, "exact" | null>;
  deltaMinutes: number;
  direction: "before" | "after" | "exact";
} | null {
  const proposedMs = new Date(proposedUtcIso).getTime();
  if (!Number.isFinite(proposedMs)) return null;

  let bestDelta = Number.POSITIVE_INFINITY;
  const candidates: Array<{ slotUtcIso: string; slotMs: number }> = [];

  for (const slotUtcIso of slotsUtcIso) {
    const slotMs = new Date(slotUtcIso).getTime();
    if (!Number.isFinite(slotMs)) continue;
    const delta = Math.abs(slotMs - proposedMs);
    if (delta > windowMs) continue;

    if (delta < bestDelta) {
      bestDelta = delta;
      candidates.length = 0;
      candidates.push({ slotUtcIso, slotMs });
      continue;
    }

    if (delta === bestDelta) {
      candidates.push({ slotUtcIso, slotMs });
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    const chosen = candidates[0]!;
    const direction = chosen.slotMs === proposedMs ? "exact" : chosen.slotMs > proposedMs ? "after" : "before";
    return {
      slotUtcIso: chosen.slotUtcIso,
      strategy: "nearest",
      deltaMinutes: Math.round(bestDelta / 60000),
      direction,
    };
  }

  // Product decision (Phase 138): for equal-distance ties, book the later slot.
  const later = candidates.sort((a, b) => b.slotMs - a.slotMs)[0]!;
  const direction = later.slotMs === proposedMs ? "exact" : later.slotMs > proposedMs ? "after" : "before";
  return {
    slotUtcIso: later.slotUtcIso,
    strategy: "nearest_tie_later",
    deltaMinutes: Math.round(bestDelta / 60000),
    direction,
  };
}

function findNearestAvailableSlotOptions(
  proposedUtcIso: string,
  slotsUtcIso: string[],
  windowMs: number,
  limit = 2
): Array<{ slotUtcIso: string; deltaMinutes: number; direction: "before" | "after" | "exact" }> {
  const proposedMs = new Date(proposedUtcIso).getTime();
  if (!Number.isFinite(proposedMs)) return [];
  const rows: Array<{ slotUtcIso: string; slotMs: number; deltaMs: number }> = [];

  for (const slotUtcIso of slotsUtcIso) {
    const slotMs = new Date(slotUtcIso).getTime();
    if (!Number.isFinite(slotMs)) continue;
    const deltaMs = Math.abs(slotMs - proposedMs);
    if (deltaMs > windowMs) continue;
    rows.push({ slotUtcIso, slotMs, deltaMs });
  }

  rows.sort((a, b) => {
    if (a.deltaMs !== b.deltaMs) return a.deltaMs - b.deltaMs;
    return a.slotMs - b.slotMs;
  });

  return rows.slice(0, Math.max(1, limit)).map((row) => ({
    slotUtcIso: row.slotUtcIso,
    deltaMinutes: Math.round(row.deltaMs / 60000),
    direction: row.slotMs === proposedMs ? "exact" : row.slotMs > proposedMs ? "after" : "before",
  }));
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
  "signature",
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
  settings: WorkspaceSettings | null,
  personaContext?: FollowUpPersonaContext | null
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
          leadTimeZone: tzResult.timezone ?? null,
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

  const resolvedSenderName = personaContext?.senderName ?? settings?.aiPersonaName ?? null;
  const resolvedSignature = personaContext?.signature ?? settings?.aiSignature ?? null;

  const values: FollowUpTemplateValues = {
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    leadCompanyName: lead.companyName,
    aiPersonaName: resolvedSenderName,
    signature: resolvedSignature,
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

function parseBlockedSmsDndAttempt(pausedReason: string | null | undefined): number {
  const reason = (pausedReason || "").trim();
  if (!reason) return 0;
  const match = reason.match(/^blocked_sms_dnd:attempt:(\d+)$/i);
  if (!match) return 0;
  const attempt = Number(match[1]);
  if (!Number.isFinite(attempt) || attempt < 0) return 0;
  return attempt;
}

async function ensureFollowUpTaskRecorded(opts: {
  leadId: string;
  type: "email" | "sms" | "linkedin";
  instanceId: string;
  stepOrder: number;
  status: "pending" | "completed" | "skipped";
  suggestedMessage?: string | null;
  subject?: string | null;
}): Promise<void> {
  const existing = await prisma.followUpTask
    .findFirst({
      where: {
        leadId: opts.leadId,
        type: opts.type,
        instanceId: opts.instanceId,
        stepOrder: opts.stepOrder,
      },
      select: { id: true, status: true },
    })
    .catch(() => null);

  // Keep completed records immutable (do not overwrite successful sends).
  if (existing?.status === "completed") return;

  if (existing?.id) {
    await prisma.followUpTask
      .update({
        where: { id: existing.id },
        data: {
          status: opts.status,
          dueDate: new Date(),
          suggestedMessage: opts.suggestedMessage ?? null,
          subject: opts.subject ?? null,
        },
        select: { id: true },
      })
      .catch(() => undefined);
    return;
  }

  await prisma.followUpTask
    .create({
      data: {
        leadId: opts.leadId,
        type: opts.type,
        dueDate: new Date(),
        status: opts.status,
        suggestedMessage: opts.suggestedMessage ?? null,
        subject: opts.subject ?? null,
        instanceId: opts.instanceId,
        stepOrder: opts.stepOrder,
      },
      select: { id: true },
    })
    .catch(() => undefined);
}

async function triggerLinkedInClayEnrichmentBestEffort(opts: {
  leadId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  companyWebsite: string | null;
  companyState: string | null;
  enrichmentStatus?: string | null;
}): Promise<boolean> {
  if (!opts.email) return false;
  if ((opts.enrichmentStatus || "").toLowerCase() === "pending") return false;

  const request = {
    leadId: opts.leadId,
    emailAddress: opts.email,
    firstName: opts.firstName || undefined,
    lastName: opts.lastName || undefined,
    fullName: [opts.firstName, opts.lastName].filter(Boolean).join(" ") || undefined,
    companyName: opts.companyName || undefined,
    companyDomain: opts.companyWebsite || undefined,
    state: opts.companyState || undefined,
  };

  const triggerResult = await triggerEnrichmentForLead(request, true, false).catch(() => null);
  if (!triggerResult?.linkedInSent) return false;

  await prisma.lead
    .update({
      where: { id: opts.leadId },
      data: {
        enrichmentStatus: "pending",
        enrichmentLastRetry: new Date(),
      },
    })
    .catch(() => undefined);

  return true;
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
  lead: LeadContext,
  sequencePersonaId?: string | null,
  sequenceTriggerOn?: string | null
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
    let personaContext: FollowUpPersonaContext | null = null;

    try {
      personaContext = await resolveFollowUpPersonaContext({
        clientId: lead.clientId,
        leadId: lead.id,
        sequencePersonaId: sequencePersonaId ?? null,
      });
    } catch (error) {
      console.warn("[FollowUp] Failed to resolve persona context:", error);
    }

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

    const isSetterReplyTrigger = (sequenceTriggerOn || "").trim().toLowerCase() === "setter_reply";
    // Operator decision (Phase 124): for setter-reply sequences, bypass business-hours rescheduling
    // only for the first step so "+2 minutes" semantics are preserved without making the whole
    // sequence ignore business hours.
    const bypassBusinessHours = isSetterReplyTrigger && step.stepOrder === 1;

    // Check business hours (except for the first step of setter-reply triggered sequences, which should execute on schedule)
    if (!bypassBusinessHours && !isWithinBusinessHours(settings)) {
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

    // SMS automation should never stall waiting on enrichment when no phone exists.
    if (step.channel === "sms" && !lead.phone) {
      const suggestedMessage = "SMS skipped — lead has no phone number. Automation advanced to the next step.";

      await ensureFollowUpTaskRecorded({
        leadId: lead.id,
        type: "sms",
        instanceId,
        stepOrder: step.stepOrder,
        status: "pending",
        suggestedMessage,
      });

      return {
        success: true,
        action: "skipped",
        message: suggestedMessage,
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

    // LinkedIn steps: connection request (if not connected) and DMs once connected
    if (step.channel === "linkedin") {
      let currentLead = await prisma.lead.findUnique({
        where: { id: lead.id },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          companyName: true,
          companyWebsite: true,
          companyState: true,
          email: true,
          phone: true,
          linkedinUrl: true,
          linkedinCompanyUrl: true,
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

      const repairedLinkedIn = mergeLinkedInFields({
        currentProfileUrl: currentLead.linkedinUrl,
        currentCompanyUrl: currentLead.linkedinCompanyUrl,
      });
      if (
        repairedLinkedIn.profileUrl !== (currentLead.linkedinUrl ?? null) ||
        repairedLinkedIn.companyUrl !== (currentLead.linkedinCompanyUrl ?? null)
      ) {
        await prisma.lead
          .update({
            where: { id: currentLead.id },
            data: {
              linkedinUrl: repairedLinkedIn.profileUrl,
              linkedinCompanyUrl: repairedLinkedIn.companyUrl,
            },
          })
          .catch(() => undefined);
        currentLead = {
          ...currentLead,
          linkedinUrl: repairedLinkedIn.profileUrl,
          linkedinCompanyUrl: repairedLinkedIn.companyUrl,
        };
      }

      const effectiveLead: LeadContext = {
        ...lead,
        firstName: currentLead.firstName ?? lead.firstName,
        lastName: currentLead.lastName ?? lead.lastName,
        companyName: currentLead.companyName ?? lead.companyName,
        email: currentLead.email ?? lead.email,
        phone: currentLead.phone ?? lead.phone,
        linkedinUrl: normalizeLinkedInUrl(currentLead.linkedinUrl),
        linkedinId: currentLead.linkedinId,
      };

      const normalizedLinkedInProfileUrl = normalizeLinkedInUrl(currentLead.linkedinUrl);

      if (!evaluateCondition(effectiveLead, step.condition)) {
        return {
          success: true,
          action: "skipped",
          message: `Condition not met: ${step.condition?.type}`,
          advance: true,
        };
      }

      if (!normalizedLinkedInProfileUrl) {
        const enrichmentTriggered = await triggerLinkedInClayEnrichmentBestEffort({
          leadId: currentLead.id,
          email: currentLead.email,
          firstName: currentLead.firstName,
          lastName: currentLead.lastName,
          companyName: currentLead.companyName,
          companyWebsite: currentLead.companyWebsite,
          companyState: currentLead.companyState,
          enrichmentStatus: currentLead.enrichmentStatus,
        });

        if (currentLead.linkedinCompanyUrl) {
          console.warn(
            `[LINKEDIN] Company URL skipped — leadId=${currentLead.id}, url=${currentLead.linkedinCompanyUrl}`
          );
          return {
            success: true,
            action: "skipped",
            message: enrichmentTriggered
              ? "LinkedIn skipped - lead has company page URL only (no personal profile). Clay enrichment requested."
              : "LinkedIn skipped - lead has company page URL only (no personal profile).",
            advance: true,
          };
        }

        return {
          success: true,
          action: "skipped",
          message: enrichmentTriggered
            ? "LinkedIn skipped - lead has no personal LinkedIn profile URL. Clay enrichment requested."
            : "LinkedIn skipped - lead has no LinkedIn URL",
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

      const generated = await generateFollowUpMessage(step, effectiveLead, settings, personaContext);
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
          normalizedLinkedInProfileUrl,
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
        normalizedLinkedInProfileUrl,
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
    const generated = await generateFollowUpMessage(step, lead, settings, personaContext);
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
      const alreadyQueued = await prisma.followUpTask.findFirst({
        where: {
          leadId: lead.id,
          type: step.channel,
          instanceId: instanceId,
          stepOrder: step.stepOrder,
          status: "pending",
        },
        select: { id: true },
      });

      if (!alreadyQueued) {
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
      }

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
      const followupDraftKey = `followup:${instanceId}:${step.stepOrder}`;

      let draft = await prisma.aIDraft.findUnique({
        where: {
          triggerMessageId_channel: {
            triggerMessageId: followupDraftKey,
            channel: "email",
          },
        },
        select: { id: true, status: true, leadId: true, content: true },
      });

      if (!draft) {
        try {
          draft = await prisma.aIDraft.create({
            data: {
              leadId: lead.id,
              content,
              status: "pending",
              channel: "email",
              triggerMessageId: followupDraftKey,
            },
            select: { id: true, status: true, leadId: true, content: true },
          });
        } catch (error) {
          if (isPrismaUniqueConstraintError(error)) {
            draft = await prisma.aIDraft.findUnique({
              where: {
                triggerMessageId_channel: {
                  triggerMessageId: followupDraftKey,
                  channel: "email",
                },
              },
              select: { id: true, status: true, leadId: true, content: true },
            });
          } else {
            throw error;
          }
        }
      }

      if (!draft) {
        return { success: false, action: "error", error: "Failed to create follow-up email draft" };
      }

      if (draft.leadId !== lead.id) {
        return {
          success: false,
          action: "error",
          error: "Follow-up email draft key collision (lead mismatch)",
        };
      }

      if (draft.status === "approved") {
        return {
          success: true,
          action: "sent",
          message: "Email already sent for this follow-up step",
        };
      }

      if (draft.status === "sending") {
        const inFlightMessage = await prisma.message.findFirst({
          where: { aiDraftId: draft.id },
          select: { id: true, body: true, sentBy: true },
        });

        if (inFlightMessage) {
          const responseDisposition = computeAIDraftResponseDisposition({
            sentBy: (inFlightMessage.sentBy as "ai" | "setter") ?? null,
            draftContent: draft.content ?? "",
            finalContent: inFlightMessage.body,
          });

          await prisma.aIDraft
            .updateMany({
              where: { id: draft.id, status: "sending" },
              data: { status: "approved", responseDisposition },
            })
            .catch(() => undefined);

          return {
            success: true,
            action: "sent",
            message: "Email already sent for this follow-up step",
          };
        }

        return {
          success: true,
          action: "skipped",
          message: "Email send already in progress - skipping duplicate follow-up execution",
        };
      }

      // Keep the draft content current unless it has already been processed.
      await prisma.aIDraft
        .updateMany({ where: { id: draft.id, status: "pending" }, data: { content } })
        .catch(() => undefined);

      const sendResult = await sendEmailReply(draft.id);

      if (!sendResult.success) {
        if (sendResult.errorCode === "draft_already_sending" || sendResult.error === EMAIL_DRAFT_ALREADY_SENDING_ERROR) {
          return {
            success: true,
            action: "skipped",
            message: "Email send already in progress - skipping duplicate follow-up execution",
          };
        }

        if (sendResult.errorCode === "send_outcome_unknown") {
          console.error("[FollowUp] Pausing follow-up due to uncertain email send outcome:", {
            instanceId,
            leadId: lead.id,
            draftId: draft.id,
            error: sendResult.error || null,
          });
          await prisma.followUpInstance
            .update({
              where: { id: instanceId },
              data: { status: "paused", pausedReason: "email_send_uncertain" },
            })
            .catch(() => undefined);

          return {
            success: true,
            action: "skipped",
            message: "Follow-up paused - email send outcome could not be confirmed",
          };
        }

        await prisma.aIDraft
          .update({ where: { id: draft.id }, data: { status: "rejected" } })
          .catch(() => undefined);

        const alreadyQueued = await prisma.followUpTask.findFirst({
          where: {
            leadId: lead.id,
            type: "email",
            instanceId: instanceId,
            stepOrder: step.stepOrder,
            status: { in: ["pending", "completed"] },
          },
          select: { id: true },
        });

        if (!alreadyQueued) {
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
        }

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

      const alreadyCompleted = await prisma.followUpTask.findFirst({
        where: {
          leadId: lead.id,
          type: "email",
          instanceId: instanceId,
          stepOrder: step.stepOrder,
          status: "completed",
        },
        select: { id: true },
      });

      if (!alreadyCompleted) {
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
      }

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
        // Retry hourly for up to 24 business-hour attempts; then skip with an audit artifact.
        if (
          sendResult.errorCode === "sms_dnd" ||
          lower.includes("dnd is active for sms") ||
          (lower.includes("dnd is active") && lower.includes("sms"))
        ) {
          const instance = await prisma.followUpInstance
            .findUnique({
              where: { id: instanceId },
              select: { pausedReason: true },
            })
            .catch(() => null);

          const previousAttempts = parseBlockedSmsDndAttempt(instance?.pausedReason);
          const nextAttempt = previousAttempts + 1;
          const maxAttempts = 24;

          await ensureFollowUpTaskRecorded({
            leadId: lead.id,
            type: "sms",
            instanceId: instanceId,
            stepOrder: step.stepOrder,
            status: "pending",
            suggestedMessage: "SMS blocked — DND active in GoHighLevel (retrying hourly; up to 24 attempts).",
          });

          if (nextAttempt >= maxAttempts) {
            // Give up: skip this step and advance, but keep an audit trail.
            await prisma.followUpInstance
              .updateMany({
                where: { id: instanceId, pausedReason: { startsWith: "blocked_sms_dnd" } },
                data: { pausedReason: null },
              })
              .catch(() => undefined);

            await ensureFollowUpTaskRecorded({
              leadId: lead.id,
              type: "sms",
              instanceId: instanceId,
              stepOrder: step.stepOrder,
              status: "pending",
              suggestedMessage: `SMS skipped — DND active after ${maxAttempts} retry attempts.`,
            });

            console.log(`[FollowUp] SMS step skipped for lead ${lead.id} - DND active after ${maxAttempts} attempts`);
            return {
              success: true,
              action: "skipped",
              message: `SMS skipped — DND active after ${maxAttempts} retry attempts`,
              advance: true,
            };
          }

          await prisma.followUpInstance.update({
            where: { id: instanceId },
            data: {
              pausedReason: `blocked_sms_dnd:attempt:${nextAttempt}`,
              nextStepDue: new Date(Date.now() + 60 * 60 * 1000),
            },
          });

          console.log(`[FollowUp] SMS blocked for lead ${lead.id} - DND active in GHL (attempt ${nextAttempt}/${maxAttempts})`);
          return {
            success: true,
            action: "skipped",
            message: `SMS blocked — DND active (retry ${nextAttempt}/${maxAttempts})`,
          };
        }

        // Avoid hard-failing and retry-spamming cron when SMS is impossible (most commonly: no phone on contact).
        if (
          sendResult.errorCode === "invalid_country_code" ||
          sendResult.errorCode === "phone_normalization_failed" ||
          sendResult.errorCode === "missing_phone" ||
          lower.includes("invalid_country_code") ||
          lower.includes("invalid country code") ||
          lower.includes("missing phone") ||
          lower.includes("phone missing") ||
          lower.includes("no usable phone") ||
          lower.includes("no phone")
        ) {
          await ensureFollowUpTaskRecorded({
            leadId: lead.id,
            type: "sms",
            instanceId: instanceId,
            stepOrder: step.stepOrder,
            status: "pending",
            suggestedMessage: `SMS skipped — ${msg}`,
          });

          console.log(`[FollowUp] SMS skipped for lead ${lead.id} - ${msg}`);
          return {
            success: true,
            action: "skipped",
            message: `SMS skipped — ${msg}`,
            advance: true,
          };
        }

        if (
          sendResult.errorCode === "ghl_not_configured" ||
          lower.includes("no ghl api key") ||
          lower.includes("missing ghl configuration")
        ) {
          await prisma.followUpInstance.update({
            where: { id: instanceId },
            data: {
              status: "paused",
              pausedReason: "blocked_sms_config",
              nextStepDue: null,
            },
          });

          await ensureFollowUpTaskRecorded({
            leadId: lead.id,
            type: "sms",
            instanceId: instanceId,
            stepOrder: step.stepOrder,
            status: "pending",
            suggestedMessage: `SMS blocked — ${msg}`,
          });

          return {
            success: true,
            action: "skipped",
            message: "SMS blocked — GoHighLevel not configured",
          };
        }

        await prisma.followUpInstance.update({
          where: { id: instanceId },
          data: {
            status: "paused",
            pausedReason: "blocked_sms_error",
            nextStepDue: null,
          },
        });

        await ensureFollowUpTaskRecorded({
          leadId: lead.id,
          type: "sms",
          instanceId: instanceId,
          stepOrder: step.stepOrder,
          status: "pending",
          suggestedMessage: `SMS failed — ${msg}`,
        });

        return {
          success: true,
          action: "skipped",
          message: `SMS failed — ${msg}`,
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

      await ensureFollowUpTaskRecorded({
        leadId: lead.id,
        type: "sms",
        instanceId: instanceId,
        stepOrder: step.stepOrder,
        status: "completed",
        suggestedMessage: content,
      });

      // Clear DND retry state after a successful send (if it was set earlier).
      await prisma.followUpInstance
        .updateMany({
          where: { id: instanceId, pausedReason: { startsWith: "blocked_sms_dnd" } },
          data: { pausedReason: null },
        })
        .catch(() => undefined);

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
        linkedinUrl: normalizeLinkedInUrl(instance.lead.linkedinUrl),
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
      const result = await executeFollowUpStep(
        instance.id,
        stepData,
        leadContext,
        instance.sequence.aiPersonaId ?? null,
        instance.sequence.triggerOn ?? null
      );

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
 * Cron backstop: complete any active/paused non-post-booking sequences
 * for leads that are already "meeting-booked".
 */
type FollowUpBackstopClient = Pick<typeof prisma, "followUpInstance">;

export async function completeFollowUpsForMeetingBookedLeads(
  prismaClient: FollowUpBackstopClient = prisma
): Promise<{ completedCount: number }> {
  try {
    const result = await prismaClient.followUpInstance.updateMany({
      where: {
        status: { in: ["active", "paused"] },
        sequence: { triggerOn: { not: "meeting_selected" } },
        lead: { status: "meeting-booked" },
      },
      data: {
        status: "completed",
        completedAt: new Date(),
        nextStepDue: null,
      },
    });

    if (result.count > 0) {
      console.log(`[Backstop] Completed ${result.count} orphaned instances for meeting-booked leads`);
    }

    return { completedCount: result.count };
  } catch (error) {
    console.error("[Backstop] Failed to complete follow-ups for meeting-booked leads:", error);
    return { completedCount: 0 };
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
    if (channel === "linkedin" && !normalizeLinkedInUrl(instance.lead.linkedinUrl)) continue;

    try {
      if (channel === "sms" && !instance.lead.phone && enrichmentTerminal) {
        await ensureFollowUpTaskRecorded({
          leadId: instance.lead.id,
          type: "sms",
          instanceId: instance.id,
          stepOrder: nextStep.stepOrder,
          status: "pending",
          suggestedMessage: "SMS skipped — missing phone after enrichment completed/failed.",
        });

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
      if (channel === "linkedin" && !normalizeLinkedInUrl(instance.lead.linkedinUrl)) continue;

      if (channel === "sms" && !instance.lead.phone && enrichmentTerminal) {
        await ensureFollowUpTaskRecorded({
          leadId: leadId,
          type: "sms",
          instanceId: instance.id,
          stepOrder: nextStep.stepOrder,
          status: "pending",
          suggestedMessage: "SMS skipped — missing phone after enrichment completed/failed.",
        });

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

async function updateAiInteractionMetadata(interactionId: string | null, metadata: unknown): Promise<void> {
  if (!interactionId) return;
  const sanitized = sanitizeAiInteractionMetadata(metadata);
  if (!sanitized) return;
  await prisma.aIInteraction
    .update({
      where: { id: interactionId },
      data: { metadata: sanitized },
      select: { id: true },
    })
    .catch(() => undefined);
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

  let leadMemoryContextForPrompt = "";
  let bundleMetadata: unknown = undefined;

  if (meta.leadId) {
    const settings = await prisma.workspaceSettings
      .findUnique({
        where: { clientId: meta.clientId },
        select: {
          clientId: true,
          serviceDescription: true,
          aiGoals: true,
          leadContextBundleEnabled: true,
          leadContextBundleBudgets: true,
        },
      })
      .catch(() => null);

    const leadContextBundleEnabled =
      Boolean((settings as any)?.leadContextBundleEnabled) && !isLeadContextBundleGloballyDisabled();

    if (leadContextBundleEnabled) {
      try {
        const bundle = await buildLeadContextBundle({
          clientId: meta.clientId,
          leadId: meta.leadId,
          profile: "followup_parse",
          timeoutMs: 500,
          settings,
        });

        leadMemoryContextForPrompt = bundle.leadMemoryContext || "";
        bundleMetadata = buildLeadContextBundleTelemetryMetadata(bundle);
      } catch (error) {
        console.warn("[FollowupEngine] LeadContextBundle build failed for followup parse; continuing without memory context", {
          clientId: meta.clientId,
          leadId: meta.leadId,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

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
    // Extraction task: keep reasoning minimal to avoid burning output tokens.
    reasoningEffort: "minimal",
    maxAttempts: 4,
    systemFallback: `You extract proposed meeting start times from a message and output UTC ISO datetimes.

Context:
- now_utc: {{nowUtcIso}}
- lead_timezone: {{leadTimezone}} (IANA timezone or UNKNOWN)
- lead_memory_context (redacted): {{leadMemoryContext}}

Rules:
- Only output proposed_start_times_utc when the message clearly proposes a specific date + time to meet.
- Use lead_timezone to interpret dates/times. If lead_timezone is UNKNOWN and the message does not include an explicit timezone, set needs_timezone_clarification=true and output an empty list.
- If times are vague (e.g., "tomorrow morning", "next week", "sometime Tuesday"), output an empty list and set confidence <= 0.5.
- Output at most 3 start times, sorted ascending, deduped.

Output JSON.`,
    metadata: bundleMetadata,
    templateVars: { nowUtcIso, leadTimezone: tzForPrompt, leadMemoryContext: leadMemoryContextForPrompt || "None." },
    input: messageTrimmed,
    schemaName: "proposed_times",
    schema,
    budget: {
      min: 512,
      max: 1200,
      retryMax: 2400,
      overheadTokens: 192,
      outputScale: 0.15,
      preferApiCount: true,
    },
    validate,
  });

  if (!result.success) return null;

  void updateAiInteractionMetadata(result.telemetry.interactionId, {
    ...(bundleMetadata && typeof bundleMetadata === "object" ? (bundleMetadata as any) : {}),
    followupParse: {
      confidence: result.data.confidence,
      proposedTimesCount: result.data.proposedStartTimesUtc.length,
      needsTimezoneClarification: result.data.needsTimezoneClarification,
    },
  });

  return result.data;
}

type FollowupBookingGateDecision = {
  decision: "approve" | "needs_clarification" | "deny";
  confidence: number;
  issues: string[];
  clarificationMessage: string | null;
  rationale: string;
};

type FollowupBookingGateScenario = "accept_offered" | "proposed_time_match" | "day_only";

function formatOfferedSlotsForGate(offeredSlots: OfferedSlot[]): string {
  const list = Array.isArray(offeredSlots) ? offeredSlots : [];
  if (list.length === 0) return "None.";
  return list
    .slice(0, 8)
    .map((s, idx) => `${idx + 1}. ${s.label} (${s.datetime})`)
    .join("\n");
}

function summarizeOverseerForGate(decision: MeetingOverseerExtractDecision | null | undefined): string {
  if (!decision) return "None.";
  return JSON.stringify(
    {
      is_scheduling_related: decision.is_scheduling_related,
      intent: decision.intent,
      intent_to_book: decision.intent_to_book,
      intent_confidence: decision.intent_confidence,
      acceptance_specificity: decision.acceptance_specificity,
      accepted_slot_index: decision.accepted_slot_index,
      preferred_day_of_week: decision.preferred_day_of_week,
      preferred_time_of_day: decision.preferred_time_of_day,
      relative_preference: decision.relative_preference,
      relative_preference_detail: decision.relative_preference_detail,
      qualification_status: decision.qualification_status,
      qualification_confidence: decision.qualification_confidence,
      time_from_body_only: decision.time_from_body_only,
      detected_timezone: decision.detected_timezone,
      time_extraction_confidence: decision.time_extraction_confidence,
      needs_clarification: decision.needs_clarification,
      clarification_reason: decision.clarification_reason,
      confidence: decision.confidence,
    },
    null,
    2
  );
}

async function runFollowupBookingGate(opts: {
  clientId: string;
  leadId: string;
  scenario: FollowupBookingGateScenario;
  messageId?: string | null;
  messageText: string;
  matchedSlotUtc: string;
  parseConfidence?: number;
  nowUtcIso: string;
  leadTimezone: string | null;
  offeredSlots?: OfferedSlot[];
  acceptedSlot?: OfferedSlot | null;
  overseerDecision?: MeetingOverseerExtractDecision | null;
  retryCount?: number;
  retryContext?: string;
}): Promise<FollowupBookingGateDecision | null> {
  const messageTrimmed = (opts.messageText || "").trim();
  if (!messageTrimmed) return null;

  const tzForPrompt = (opts.leadTimezone || "").trim() || "UNKNOWN";

  let leadMemoryContextForPrompt = "";
  let bundleMetadata: unknown = undefined;

  try {
    const bundle = await buildLeadContextBundle({
      clientId: opts.clientId,
      leadId: opts.leadId,
      profile: "followup_booking_gate",
      timeoutMs: 500,
    });

    leadMemoryContextForPrompt = bundle.leadMemoryContext || "";
    bundleMetadata = buildLeadContextBundleTelemetryMetadata(bundle);
  } catch (error) {
    console.warn("[FollowupEngine] LeadContextBundle build failed for booking gate; skipping gate", {
      clientId: opts.clientId,
      leadId: opts.leadId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const retryContext = (opts.retryContext || "").trim().slice(0, 1200);

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["decision", "confidence", "issues", "clarification_message", "rationale"],
    properties: {
      decision: { type: "string", enum: ["approve", "needs_clarification", "deny"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      issues: { type: "array", items: { type: "string" }, default: [] },
      clarification_message: { type: ["string", "null"] },
      rationale: { type: "string" },
    },
  } as const;

  const validate = (
    value: unknown
  ): { success: true; data: FollowupBookingGateDecision } | { success: false; error: string } => {
    if (!value || typeof value !== "object") return { success: false, error: "not_an_object" };
    const record = value as Record<string, unknown>;

    const decision = record.decision;
    const confidence = record.confidence;
    const issues = record.issues;
    const clarification = record.clarification_message;
    const rationale = record.rationale;

    if (decision !== "approve" && decision !== "needs_clarification" && decision !== "deny") {
      return { success: false, error: "invalid_decision" };
    }
    if (typeof confidence !== "number" || !Number.isFinite(confidence)) return { success: false, error: "confidence_not_number" };
    if (!Array.isArray(issues) || !issues.every((i) => typeof i === "string")) return { success: false, error: "issues_not_string_array" };
    if (!(clarification === null || typeof clarification === "string")) {
      return { success: false, error: "clarification_message_invalid" };
    }
    if (typeof rationale !== "string") return { success: false, error: "rationale_not_string" };

    return {
      success: true,
      data: {
        decision,
        confidence: Math.max(0, Math.min(1, confidence)),
        issues: issues.map((s) => s.trim()).filter(Boolean).slice(0, 8),
        clarificationMessage: typeof clarification === "string" ? clarification.trim().slice(0, 280) : null,
        rationale: rationale.trim().slice(0, 200),
      },
    };
  };

  const model = "gpt-5-mini";
  const input = `Inbound message:
${messageTrimmed}

Scenario:
${opts.scenario}

Retry context (if any):
${retryContext || "None."}

Offered slots (if any):
${formatOfferedSlotsForGate(opts.offeredSlots || [])}

Accepted slot (if any):
${opts.acceptedSlot ? `${opts.acceptedSlot.label} (${opts.acceptedSlot.datetime})` : "None."}

Matched availability slot (UTC ISO):
${opts.matchedSlotUtc}

Parse confidence (if any):
${typeof opts.parseConfidence === "number" ? opts.parseConfidence : "N/A"}

Overseer extraction summary (if any):
${summarizeOverseerForGate(opts.overseerDecision)}

now_utc:
${opts.nowUtcIso}

lead_timezone:
${tzForPrompt}`;

  const result = await runStructuredJsonPrompt<FollowupBookingGateDecision>({
    pattern: "structured_json",
    clientId: opts.clientId,
    leadId: opts.leadId,
    promptKey: "followup.booking.gate.v1",
    featureId: "followup.booking.gate",
    model,
    reasoningEffort: "minimal",
    maxAttempts: 3,
    systemFallback: `You are a safety gate for automatic meeting booking.

Context:
- now_utc: {{nowUtcIso}}
- lead_timezone: {{leadTimezone}} (IANA timezone or UNKNOWN)
- lead_memory_context (redacted): {{leadMemoryContext}}
- scenario: accept_offered | proposed_time_match | day_only

Task:
- Decide if it is safe to auto-book the slot based on the inbound message and structured context.

Rules:
- For proposed_time_match: if lead_timezone is UNKNOWN and the message does not include an explicit timezone, decision MUST be "needs_clarification".
- For accept_offered: do NOT require lead_timezone. Prefer "approve" when the accepted slot is clear unless the message indicates deferral or non-scheduling.
- For day_only: do NOT require lead_timezone. Prefer "approve" when the message indicates booking intent for that day unless the message indicates deferral or non-scheduling.
- If the message is ambiguous or not clearly scheduling-related, decision should be "deny" or "needs_clarification".
- Do NOT quote the user's message in the output.
- clarification_message must be a single short sentence question (no links, no PII).
- rationale must be <= 200 characters.
- issues must be a short list of categories (no quotes, no PII).

Output JSON only:
{
  "decision": "approve" | "needs_clarification" | "deny",
  "confidence": number,
  "issues": string[],
  "clarification_message": string | null,
  "rationale": string
}`,
    metadata: bundleMetadata,
    templateVars: {
      nowUtcIso: opts.nowUtcIso,
      leadTimezone: tzForPrompt,
      leadMemoryContext: leadMemoryContextForPrompt || "None.",
    },
    input,
    schemaName: "followup_booking_gate",
    schema,
    budget: { min: 256, max: 900, retryMax: 1600, overheadTokens: 128, outputScale: 0.2, preferApiCount: true },
    validate,
  });

  if (!result.success) return null;

  void updateAiInteractionMetadata(result.telemetry.interactionId, {
    ...(bundleMetadata && typeof bundleMetadata === "object" ? (bundleMetadata as any) : {}),
    bookingGate: {
      scenario: opts.scenario,
      retryCount: Math.max(0, Math.min(1, Math.trunc(opts.retryCount ?? 0))),
      decision: result.data.decision,
      confidence: result.data.confidence,
      issuesCount: result.data.issues.length,
    },
  });

  if (opts.messageId) {
    const payload = {
      decision: result.data.decision,
      confidence: result.data.confidence,
      issues: result.data.issues,
      clarification_message: result.data.clarificationMessage,
      rationale: result.data.rationale,
      scenario: opts.scenario,
      retry_count: Math.max(0, Math.min(1, Math.trunc(opts.retryCount ?? 0))),
      matched_slot_utc: opts.matchedSlotUtc,
      parse_confidence: typeof opts.parseConfidence === "number" ? opts.parseConfidence : null,
    };
    await prisma.meetingOverseerDecision
      .upsert({
        where: { messageId_stage: { messageId: opts.messageId, stage: "booking_gate" } },
        create: {
          messageId: opts.messageId,
          leadId: opts.leadId,
          clientId: opts.clientId,
          stage: "booking_gate",
          promptKey: "followup.booking.gate.v1",
          model,
          confidence: result.data.confidence,
          payload,
        },
        update: {
          promptKey: "followup.booking.gate.v1",
          model,
          confidence: result.data.confidence,
          payload,
        },
        select: { id: true },
      })
      .catch(() => undefined);
  }

  return result.data;
}

export async function runFollowupBookingGateWithOneRetry(opts: {
  runAttempt: (retryCount: 0 | 1) => Promise<FollowupBookingGateDecision | null>;
}): Promise<{ gate: FollowupBookingGateDecision | null; attempts: 1 | 2 }> {
  const first = await opts.runAttempt(0);
  if (!first) return { gate: null, attempts: 1 };
  if (first.decision !== "needs_clarification") return { gate: first, attempts: 1 };
  const second = await opts.runAttempt(1);
  return { gate: second, attempts: 2 };
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

type BookingRoute = "accept_offered" | "day_only" | "proposed_time" | "none";

type BookingSignal = {
  wantsToBook: boolean;
  route: BookingRoute;
  preferredDayOfWeek: string | null;
  preferredTimeOfDay: string | null;
};

export type AutoBookingFailureReason =
  | "no_scheduling_intent"
  | "blocked_sentiment"
  | "disabled"
  | "no_match"
  | "low_confidence"
  | "gate_denied"
  | "needs_clarification"
  | "booking_api_error"
  | "overseer_error"
  | "unqualified_or_unknown"
  | null;

export type AutoBookingTaskKind =
  | "clarification"
  | "alternatives"
  | "timezone_clarification"
  | "qualification_clarification"
  | "other"
  | null;

export type AutoBookingMatchStrategy = "exact" | "nearest" | "nearest_tie_later" | null;

export type AutoBookingContext = {
  schedulingDetected: boolean;
  schedulingIntent: string | null;
  clarificationTaskCreated: boolean;
  clarificationMessage: string | null;
  followUpTaskCreated: boolean;
  followUpTaskKind: AutoBookingTaskKind;
  qualificationEvaluated: boolean;
  isQualifiedForBooking: boolean | null;
  qualificationReason: string | null;
  failureReason: AutoBookingFailureReason;
  route: BookingRoute | null;
  matchStrategy: AutoBookingMatchStrategy;
};

export type AutoBookingResult = {
  booked: boolean;
  appointmentId?: string;
  error?: string;
  context: AutoBookingContext;
};

function defaultAutoBookingContext(overrides?: Partial<AutoBookingContext>): AutoBookingContext {
  return {
    schedulingDetected: false,
    schedulingIntent: null,
    clarificationTaskCreated: false,
    clarificationMessage: null,
    followUpTaskCreated: false,
    followUpTaskKind: null,
    qualificationEvaluated: false,
    isQualifiedForBooking: null,
    qualificationReason: null,
    failureReason: null,
    route: null,
    matchStrategy: null,
    ...overrides,
  };
}

export function deriveBookingSignal(opts: {
  overseerDecision: MeetingOverseerExtractDecision | null;
  hasOfferedSlots: boolean;
}): BookingSignal {
  const preferredDayOfWeek = opts.overseerDecision?.preferred_day_of_week ?? null;
  const preferredTimeOfDay = opts.overseerDecision?.preferred_time_of_day ?? null;

  if (!opts.overseerDecision) {
    return { wantsToBook: false, route: "none", preferredDayOfWeek, preferredTimeOfDay };
  }

  if (!opts.overseerDecision.is_scheduling_related) {
    return { wantsToBook: false, route: "none", preferredDayOfWeek, preferredTimeOfDay };
  }

  if (
    opts.overseerDecision.intent === "decline" ||
    opts.overseerDecision.intent === "other" ||
    opts.overseerDecision.intent === "request_times" ||
    opts.overseerDecision.intent === "reschedule"
  ) {
    return { wantsToBook: false, route: "none", preferredDayOfWeek, preferredTimeOfDay };
  }

  if (opts.overseerDecision.intent === "accept_offer") {
    if (!opts.hasOfferedSlots) {
      // Shouldn't happen in normal flows; fail closed.
      return { wantsToBook: false, route: "none", preferredDayOfWeek, preferredTimeOfDay };
    }
    return { wantsToBook: true, route: "accept_offered", preferredDayOfWeek, preferredTimeOfDay };
  }

  if (opts.overseerDecision.intent === "propose_time") {
    if (
      !opts.hasOfferedSlots &&
      opts.overseerDecision.acceptance_specificity === "day_only" &&
      opts.overseerDecision.preferred_day_of_week
    ) {
      return { wantsToBook: true, route: "day_only", preferredDayOfWeek, preferredTimeOfDay };
    }
    return { wantsToBook: true, route: "proposed_time", preferredDayOfWeek, preferredTimeOfDay };
  }

  // Includes reschedule and any future intents; fail closed.
  return { wantsToBook: false, route: "none", preferredDayOfWeek, preferredTimeOfDay };
}

export function isLowRiskGenericAcceptance(opts: {
  offeredSlot: OfferedSlot | null | undefined;
  nowMs?: number;
}): boolean {
  const offeredAtRaw = (opts.offeredSlot?.offeredAt || "").trim();
  if (!offeredAtRaw) return false;
  const offeredAtMs = Date.parse(offeredAtRaw);
  if (!Number.isFinite(offeredAtMs)) return false;
  const nowMs = typeof opts.nowMs === "number" ? opts.nowMs : Date.now();
  const freshnessWindowMs = 7 * 24 * 60 * 60 * 1000;
  return nowMs - offeredAtMs <= freshnessWindowMs;
}

export function looksLikeTimeProposalText(messageText: string): boolean {
  const messageTrimmed = (messageText || "").trim();
  if (!messageTrimmed) return false;
  return (
    /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day)?\b/i.test(messageTrimmed) ||
    /\b(tomorrow|today|next week)\b/i.test(messageTrimmed) ||
    /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(messageTrimmed) ||
    /\b\d{1,2}\/\d{1,2}\b/.test(messageTrimmed) ||
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(messageTrimmed)
  );
}

export function buildAutoBookingConfirmationMessage(opts: {
  channel: "sms" | "email" | "linkedin";
  slotLabel: string;
  bookingLink: string | null;
}): string {
  const base = `You're booked for ${opts.slotLabel}.`;
  if (!opts.bookingLink) {
    return `${base} If the time doesn't work, let me know and we can find another time.`;
  }
  return `${base} If the time doesn't work, let me know or feel free to reschedule using the calendar invite: ${opts.bookingLink}`;
}

async function sendAutoBookingConfirmation(opts: {
  lead: LeadForAutoBookingConfirmation;
  channel: "sms" | "email" | "linkedin";
  slot: OfferedSlot;
  timeZone: string;
  leadTimeZone?: string | null;
  bookingLink: string | null;
}): Promise<{ success: boolean; error?: string }> {
  if (!opts.lead) return { success: false, error: "Lead not found" };

  const formatterTimeZone =
    opts.leadTimeZone && isValidIanaTimezone(opts.leadTimeZone) ? opts.leadTimeZone : opts.timeZone;

  const slotLabel = formatAvailabilitySlotLabel({
    datetimeUtcIso: opts.slot.datetime,
    timeZone: formatterTimeZone,
    mode: "explicit_tz",
  }).label;

  const message = buildAutoBookingConfirmationMessage({
    channel: opts.channel,
    slotLabel,
    bookingLink: opts.bookingLink,
  });

  if (opts.channel === "sms") {
    const result = await sendSmsSystem(opts.lead.id, message, { sentBy: "ai" });
    return { success: result.success, error: result.error };
  }

  if (opts.channel === "linkedin") {
    const result = await sendLinkedInMessageSystem(opts.lead.id, message, { sentBy: "ai" });
    return { success: result.success, error: result.error };
  }

  const provider = resolveEmailIntegrationProvider(opts.lead.client);
  if (!provider) {
    return { success: false, error: "No email provider configured" };
  }

  const result = await sendEmailReplySystem({
    lead: opts.lead,
    provider,
    messageContent: message,
    sentBy: "ai",
  });

  return { success: result.success, error: result.error };
}

/**
 * Process an incoming message for auto-booking
 * Called when a new inbound message is received
 */
export async function processMessageForAutoBooking(
  leadId: string,
  messageBody: string,
  meta?: { channel?: "sms" | "email" | "linkedin"; messageId?: string | null; sentimentTag?: string | null }
): Promise<AutoBookingResult> {
  try {
    const context = defaultAutoBookingContext();
    const makeResult = (
      payload: { booked: boolean; appointmentId?: string; error?: string },
      overrides?: Partial<AutoBookingContext>
    ): AutoBookingResult => ({
      ...payload,
      context: { ...context, ...(overrides || {}) },
    });
    const fail = (
      failureReason: AutoBookingFailureReason,
      payload?: { error?: string },
      overrides?: Partial<AutoBookingContext>
    ): AutoBookingResult =>
      makeResult({ booked: false, ...(payload || {}) }, { failureReason, ...(overrides || {}) });

    const markTaskCreated = (opts: {
      kind: AutoBookingTaskKind;
      suggestedMessage?: string | null;
      isClarification?: boolean;
    }) => {
      context.followUpTaskCreated = true;
      context.followUpTaskKind = opts.kind;
      if (opts.isClarification) {
        context.clarificationTaskCreated = true;
        context.clarificationMessage = (opts.suggestedMessage || "").trim() || null;
      }
    };

    // Defense-in-depth: block known non-scheduling sentiments from auto-booking before any DB/AI work.
    if (isAutoBookingBlockedSentiment(meta?.sentimentTag)) {
      return fail("blocked_sentiment");
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        client: {
          include: {
            emailBisonBaseHost: { select: { host: true } },
            settings: true,
          },
        },
      },
    });

    if (!lead) {
      return fail("overseer_error", { error: "Lead not found" });
    }

    if (lead.client.settings?.meetingOverseerEnabled === false) {
      await recordAiRouteSkip({
        clientId: lead.clientId,
        leadId: lead.id,
        route: "meeting_overseer_followup",
        channel: meta?.channel ?? null,
        triggerMessageId: meta?.messageId ?? null,
        reason: "disabled_by_workspace_settings",
        source: "lib:followup_engine.process_auto_booking",
      });
      return fail("disabled", { error: "Meeting overseer disabled in workspace settings" });
    }

    // Defense-in-depth for callers that don't pass sentimentTag via meta.
    if (isAutoBookingBlockedSentiment(lead.sentimentTag)) {
      return fail("blocked_sentiment");
    }

    // Check if lead should auto-book
    const autoBookResult = await shouldAutoBook(leadId);
    if (!autoBookResult.shouldBook) {
      return fail("disabled");
    }

    // Get offered slots for this lead
    const offeredSlots = await getOfferedSlots(leadId);
    const preferred = meta?.channel;
    const messageTrimmed = (messageBody || "").trim();
    const leadHasLinkedInProfile = Boolean(normalizeLinkedInUrl(lead.linkedinUrl));

    const pickTaskType = async (): Promise<"sms" | "email" | "linkedin" | "call"> => {
      const preferredSendable =
        preferred === "sms"
          ? Boolean(lead.phone)
          : preferred === "email"
            ? Boolean(lead.email)
            : preferred === "linkedin"
              ? leadHasLinkedInProfile
              : false;

      if (preferredSendable) return preferred!;
      if (lead.phone) return "sms";
      if (lead.email) return "email";
      if (leadHasLinkedInProfile) return "linkedin";
      return "call";
    };

    const resolveConfirmationChannel = async (): Promise<"sms" | "email" | "linkedin" | "call"> => {
      if (!preferred) return pickTaskType();

      const preferredSendable =
        preferred === "sms"
          ? Boolean(lead.phone)
          : preferred === "email"
            ? Boolean(lead.email)
            : preferred === "linkedin"
              ? leadHasLinkedInProfile
              : false;

      return preferredSendable ? preferred : "call";
    };

    let overseerDecision: MeetingOverseerExtractDecision | null = null;
    try {
      const [answerState, recentMessages, bundle] = await Promise.all([
        getLeadQualificationAnswerState({ leadId: lead.id, clientId: lead.clientId }).catch(() => null),
        prisma.message.findMany({
          where: { leadId: lead.id },
          orderBy: { sentAt: "desc" },
          take: 8,
          select: { direction: true, channel: true, body: true },
        }).catch(() => []),
        buildLeadContextBundle({
          clientId: lead.clientId,
          leadId: lead.id,
          profile: "followup_booking_gate",
          timeoutMs: 500,
          settings: lead.client.settings ?? null,
        }).catch(() => null),
      ]);
      const conversationContext = recentMessages
        .slice()
        .reverse()
        .map((m) => {
          const body = (m.body || "").trim();
          if (!body) return null;
          return `${m.direction.toUpperCase()} (${m.channel}): ${body.slice(0, 180)}`;
        })
        .filter(Boolean)
        .join("\n");

      const qualificationContext = answerState
        ? [
            `required_question_ids: ${(answerState.requiredQuestionIds || []).join(", ") || "none"}`,
            `missing_required_question_ids: ${(answerState.missingRequiredQuestionIds || []).join(", ") || "none"}`,
            `has_all_required_answers: ${answerState.hasAllRequiredAnswers ? "true" : "false"}`,
          ].join("\n")
        : "qualification state unavailable";

      const businessContext = [
        `service_description: ${((lead.client.settings?.serviceDescription || "").trim() || "none").slice(0, 500)}`,
        `lead_status: ${(lead.status || "").trim() || "unknown"}`,
        `lead_sentiment: ${(lead.sentimentTag || "").trim() || "unknown"}`,
        bundle?.leadMemoryContext ? `lead_memory_context: ${bundle.leadMemoryContext.slice(0, 500)}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      overseerDecision = await runMeetingOverseerExtraction({
        clientId: lead.clientId,
        leadId: lead.id,
        messageId: meta?.messageId,
        messageText: messageTrimmed,
        offeredSlots,
        qualificationContext,
        conversationContext,
        businessContext,
      });
    } catch (error) {
      console.warn("[FollowupEngine] Meeting overseer extraction failed; failing closed (no auto-book)", {
        clientId: lead.clientId,
        leadId: lead.id,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      overseerDecision = null;
    }

    // Fail closed if we can't get an overseer extraction (no heuristic fallbacks).
    if (!overseerDecision) {
      return fail("overseer_error");
    }

    if (overseerDecision.decision_contract_status === "decision_error") {
      return fail("overseer_error", {
        error: overseerDecision.decision_contract_error || "decision_contract_error",
      });
    }

    const decisionContract = overseerDecision.decision_contract_v1 ?? null;
    const contractHasBookingIntent =
      decisionContract?.hasBookingIntent === "yes" ? true : decisionContract?.hasBookingIntent === "no" ? false : null;
    const contractShouldBookNow =
      decisionContract?.shouldBookNow === "yes" ? true : decisionContract?.shouldBookNow === "no" ? false : null;
    const contractIsQualified =
      decisionContract?.isQualified === "yes" ? true : decisionContract?.isQualified === "no" ? false : null;

    const signal = deriveBookingSignal({ overseerDecision, hasOfferedSlots: offeredSlots.length > 0 });
    context.schedulingDetected = Boolean(overseerDecision.is_scheduling_related);
    context.schedulingIntent = overseerDecision.intent || null;
    context.route = signal.route;
    context.qualificationEvaluated = true;
    context.isQualifiedForBooking =
      contractIsQualified !== null
        ? contractIsQualified
        : overseerDecision.qualification_status === "qualified"
          ? true
          : overseerDecision.qualification_status === "unqualified"
            ? false
            : null;
    context.qualificationReason =
      (decisionContract?.evidence || [])[0] || (overseerDecision.qualification_evidence || [])[0] || null;

    const contractDetectedTimezone = (decisionContract?.leadTimezone || "").trim();
    const overseerDetectedTimezone = (overseerDecision.detected_timezone || "").trim();
    const detectedTimezone = contractDetectedTimezone || overseerDetectedTimezone;
    if (
      detectedTimezone &&
      isValidIanaTimezone(detectedTimezone) &&
      lead.timezone !== detectedTimezone
    ) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { timezone: detectedTimezone },
      });
      lead.timezone = detectedTimezone;
    }

    const tzResult = await ensureLeadTimezone(leadId, { conversationText: messageTrimmed });
    const timeZone = tzResult.timezone || lead.timezone || lead.client.settings?.timezone || "UTC";

    const leadContextBundleEnabled =
      Boolean(lead.client.settings?.leadContextBundleEnabled) && !isLeadContextBundleGloballyDisabled();
    const bookingGateEnabled =
      leadContextBundleEnabled &&
      Boolean(lead.client.settings?.autoBookMeetings) &&
      Boolean(lead.client.settings?.followupBookingGateEnabled);

    const createClarificationTask = async (suggestedMessage: string) => {
      const type = await pickTaskType();
      const task = await prisma.followUpTask.create({
        data: {
          leadId,
          type,
          dueDate: new Date(),
          status: "pending",
          suggestedMessage,
        },
        select: { id: true },
      });

      // Create an inbox-visible draft for the clarification task so this routing
      // doesn't result in "no draft created" operator confusion.
      const triggerMessageId = `followup_task:${task.id}`;
      const content = (suggestedMessage || "").trim() || "Quick question: what timeframe would be best to follow up?";
      await prisma.aIDraft
        .create({
          data: {
            leadId,
            triggerMessageId,
            content,
            channel: type,
            status: "pending",
          },
          select: { id: true },
        })
        .catch((error) => {
          if (!isPrismaUniqueConstraintError(error)) throw error;
        });

      markTaskCreated({
        kind: "clarification",
        suggestedMessage,
        isClarification: true,
      });

      if (lead.sentimentTag !== "Blacklist") {
        await prisma.lead.update({
          where: { id: leadId },
          data: { sentimentTag: "Follow Up" },
        });
      }
    };

    const route: BookingRoute = signal.route;
    context.route = route;

    if (route !== "none") {
      if ((contractHasBookingIntent ?? overseerDecision.intent_to_book) !== true) {
        await createClarificationTask("Just to confirm, would you like to book a meeting time now?");
        return fail("needs_clarification");
      }
      if (
        (contractShouldBookNow ?? !overseerDecision.needs_clarification) !== true &&
        decisionContract?.responseMode === "clarify_only"
      ) {
        await createClarificationTask("Before we schedule, can you confirm the key booking detail you want us to use?");
        return fail("needs_clarification");
      }
      if (route === "accept_offered" && !overseerDecision.time_from_body_only) {
        const bodyClarification = "Could you confirm which offered time works for you in your reply so I can schedule it correctly?";
        await createClarificationTask(bodyClarification);
        return fail("needs_clarification");
      }
      if ((contractIsQualified ?? (overseerDecision.qualification_status === "qualified")) !== true) {
        const qualificationClarification =
          (contractIsQualified === false || overseerDecision.qualification_status === "unqualified")
            ? "Before we schedule, I need to confirm a quick qualification detail. Could you share a bit more so we can make sure this is the right fit?"
            : "Before I schedule this, could you confirm a quick qualification detail so we can make sure this is the right fit?";
        await createClarificationTask(qualificationClarification);
        markTaskCreated({
          kind: "qualification_clarification",
          suggestedMessage: qualificationClarification,
          isClarification: true,
        });
        return fail("unqualified_or_unknown");
      }
    }

    // Scenario 1/2: lead accepts one of the offered slots.
    if (route === "accept_offered") {
      if (offeredSlots.length === 0) {
        return fail("no_match");
      }

      if (overseerDecision?.needs_clarification) {
        const clarification =
          overseerDecision.relative_preference && overseerDecision.relative_preference.includes("week")
            ? "Got it — which day and time later this week works best for you?"
            : "Got it — what day and time works best for you?";
        await createClarificationTask(clarification);
        return fail("needs_clarification");
      }

      let acceptedSlot: OfferedSlot | null = null;

      if (overseerDecision?.accepted_slot_index) {
        const index = Math.trunc(overseerDecision.accepted_slot_index) - 1;
        if (index >= 0 && index < offeredSlots.length) {
          acceptedSlot = offeredSlots[index]!;
        }
      }

      if (!acceptedSlot && overseerDecision?.acceptance_specificity === "specific") {
        acceptedSlot = await parseAcceptedTimeFromMessage(messageBody, offeredSlots, {
          clientId: lead.clientId,
          leadId: lead.id,
        });
      }

      if (!acceptedSlot && (overseerDecision?.preferred_day_of_week || overseerDecision?.preferred_time_of_day)) {
        acceptedSlot = selectOfferedSlotByPreference({
          offeredSlots,
          timeZone,
          preferredDayOfWeek: overseerDecision?.preferred_day_of_week ?? null,
          preferredTimeOfDay: overseerDecision?.preferred_time_of_day ?? null,
        });
      }

      if (!acceptedSlot && overseerDecision?.acceptance_specificity === "generic") {
        const slot = offeredSlots.length === 1 ? offeredSlots[0] : null;
        if (slot && isLowRiskGenericAcceptance({ offeredSlot: slot })) {
          acceptedSlot = slot;
        }
      }

      const weekdayTokenForAcceptance =
        overseerDecision?.preferred_day_of_week ||
        detectWeekdayTokenFromText(messageTrimmed) ||
        resolveRelativeDateToWeekdayToken(overseerDecision?.relative_preference, timeZone);

      // Day-only: if the lead indicates a weekday preference, try to map it to an offered slot first.
      // This covers cases where overseer didn't populate `preferred_day_of_week` but the message contains it.
      if (!acceptedSlot && weekdayTokenForAcceptance) {
        const offeredMatch = selectOfferedSlotByPreference({
          offeredSlots,
          timeZone,
          preferredDayOfWeek: weekdayTokenForAcceptance,
          preferredTimeOfDay: null,
        });
        if (offeredMatch) {
          acceptedSlot = offeredMatch;
        }
      }

      // If offered slots exist but the lead requests a weekday we didn't offer (e.g. "Thursday works"),
      // attempt to auto-book the earliest available slot on that weekday (gate-approved only).
      if (!acceptedSlot && weekdayTokenForAcceptance) {
        const bookingTarget = await selectBookingTargetForLead({
          clientId: lead.clientId,
          leadId: lead.id,
        });
        const requestedAvailabilitySource: AvailabilitySource =
          bookingTarget.target === "no_questions" ? "DIRECT_BOOK" : "DEFAULT";

        const availability = await getWorkspaceAvailabilitySlotsUtc(lead.clientId, {
          refreshIfStale: true,
          availabilitySource: requestedAvailabilitySource,
        });

        const weekdaySlotUtcIso = selectEarliestSlotForWeekday({
          slotsUtcIso: availability.slotsUtc,
          weekdayToken: weekdayTokenForAcceptance,
          timeZone,
          preferredTimeOfDay: overseerDecision?.preferred_time_of_day ?? null,
        });

        if (weekdaySlotUtcIso) {
          const weekdaySlotLabel = formatAvailabilitySlotLabel({
            datetimeUtcIso: weekdaySlotUtcIso,
            timeZone,
            mode: "explicit_tz",
          }).label;

          const weekdaySlot: OfferedSlot = {
            datetime: weekdaySlotUtcIso,
            label: weekdaySlotLabel,
            offeredAt: new Date().toISOString(),
            availabilitySource: availability.availabilitySource,
          };

          if (bookingGateEnabled) {
            const nowUtcIsoForGate = new Date().toISOString();
            const { gate, attempts } = await runFollowupBookingGateWithOneRetry({
              runAttempt: (retryCount) =>
                runFollowupBookingGate({
                  clientId: lead.clientId,
                  leadId: lead.id,
                  scenario: "day_only",
                  messageId: meta?.messageId ?? null,
                  messageText: messageTrimmed,
                  matchedSlotUtc: weekdaySlotUtcIso,
                  parseConfidence: undefined,
                  nowUtcIso: nowUtcIsoForGate,
                  leadTimezone: tzResult.timezone || null,
                  offeredSlots,
                  acceptedSlot: null,
                  overseerDecision,
                  retryCount,
                  retryContext:
                    retryCount === 1
                      ? `requested_weekday_token: ${weekdayTokenForAcceptance}\nmatched_slot_label_explicit_tz: ${weekdaySlotLabel}\noffered_slots_count: ${offeredSlots.length}`
                      : undefined,
                }),
            });

            if (!gate) {
              await createClarificationTask(`Just to confirm, does ${weekdaySlotLabel} work for you?`);
              await sendAutoBookingBlockedSlackAlert({
                leadId,
                scenario: "day_only",
                matchedSlotLabel: weekdaySlotLabel,
                gateDecision: "error",
                gateConfidence: null,
                issues: null,
                retryCount: attempts - 1,
              });
              return fail("gate_denied");
            }

            if (gate.decision === "needs_clarification") {
              await createClarificationTask(gate.clarificationMessage || "Got it — what time works best for you on that day?");
              await sendAutoBookingBlockedSlackAlert({
                leadId,
                scenario: "day_only",
                matchedSlotLabel: weekdaySlotLabel,
                gateDecision: gate.decision,
                gateConfidence: gate.confidence,
                issues: gate.issues,
                retryCount: attempts - 1,
              });
              return fail("needs_clarification");
            }

            if (gate.decision === "deny") {
              await createClarificationTask("Got it — what time works best for you on that day?");
              return fail("gate_denied");
            }
          }

          const bookingResult = await bookMeetingForLead(leadId, weekdaySlotUtcIso, {
            availabilitySource: availability.availabilitySource,
          });

          if (bookingResult.success) {
            await sendAutoBookingSlackNotification(leadId, weekdaySlot);

            const bookingLink = await getBookingLink(lead.clientId, lead.client.settings);
            const confirmationChannel = await resolveConfirmationChannel();
            if (confirmationChannel !== "call") {
              const confirmResult = await sendAutoBookingConfirmation({
                lead,
                channel: confirmationChannel,
                slot: weekdaySlot,
                timeZone,
                leadTimeZone: tzResult.timezone || null,
                bookingLink,
              });
              if (!confirmResult.success) {
                return makeResult({
                  booked: true,
                  appointmentId: bookingResult.appointmentId,
                  error: confirmResult.error || "Booked, but failed to send confirmation",
                });
              }
            } else if (preferred) {
              return makeResult({
                booked: true,
                appointmentId: bookingResult.appointmentId,
                error: "Booked, but inbound channel is unavailable for confirmation",
              });
            }

            return makeResult({ booked: true, appointmentId: bookingResult.appointmentId });
          }

          return fail("booking_api_error", { error: bookingResult.error });
        }
      }

      if (!acceptedSlot) {
        const options = offeredSlots.slice(0, 2);
        const weekdayLabel =
          weekdayTokenForAcceptance === "mon"
            ? "Monday"
            : weekdayTokenForAcceptance === "tue"
              ? "Tuesday"
              : weekdayTokenForAcceptance === "wed"
                ? "Wednesday"
                : weekdayTokenForAcceptance === "thu"
                  ? "Thursday"
                  : weekdayTokenForAcceptance === "fri"
                    ? "Friday"
                    : weekdayTokenForAcceptance === "sat"
                      ? "Saturday"
                      : weekdayTokenForAcceptance === "sun"
                        ? "Sunday"
                        : null;
        const suggestion =
          options.length === 2
            ? weekdayLabel
              ? `I don’t have any availability on ${weekdayLabel} — does (1) ${options[0]!.label} or (2) ${options[1]!.label} work instead?`
              : `Which works better for you: (1) ${options[0]!.label} or (2) ${options[1]!.label}?`
            : `Which of these works best for you: ${offeredSlots.map((s) => s.label).join(" or ")}?`;
        await createClarificationTask(suggestion);
        return fail("no_match");
      }

      if (bookingGateEnabled) {
        const nowUtcIsoForGate = new Date().toISOString();
        const acceptedSlotLabel = formatAvailabilitySlotLabel({
          datetimeUtcIso: acceptedSlot.datetime,
          timeZone,
          mode: "explicit_tz",
        }).label;

        const { gate, attempts } = await runFollowupBookingGateWithOneRetry({
          runAttempt: (retryCount) =>
            runFollowupBookingGate({
              clientId: lead.clientId,
              leadId: lead.id,
              scenario: "accept_offered",
              messageId: meta?.messageId ?? null,
              messageText: messageTrimmed,
              matchedSlotUtc: acceptedSlot.datetime,
              parseConfidence: undefined,
              nowUtcIso: nowUtcIsoForGate,
              leadTimezone: tzResult.timezone || null,
              offeredSlots,
              acceptedSlot,
              overseerDecision,
              retryCount,
              retryContext:
                retryCount === 1
                  ? `accepted_slot_label_explicit_tz: ${acceptedSlotLabel}\noffered_slots_count: ${offeredSlots.length}`
                  : undefined,
            }),
        });

        if (!gate) {
          await createClarificationTask(`Just to confirm, does ${acceptedSlot.label} work for you?`);
          await sendAutoBookingBlockedSlackAlert({
            leadId,
            scenario: "accept_offered",
            matchedSlotLabel: acceptedSlotLabel,
            gateDecision: "error",
            gateConfidence: null,
            issues: null,
            retryCount: attempts - 1,
          });
          return fail("gate_denied");
        }

        if (gate.decision === "needs_clarification") {
          await createClarificationTask(gate.clarificationMessage || "Got it — which time works best for you?");
          await sendAutoBookingBlockedSlackAlert({
            leadId,
            scenario: "accept_offered",
            matchedSlotLabel: acceptedSlotLabel,
            gateDecision: gate.decision,
            gateConfidence: gate.confidence,
            issues: gate.issues,
            retryCount: attempts - 1,
          });
          return fail("needs_clarification");
        }

        if (gate.decision === "deny") {
          await createClarificationTask(`Just to confirm, does ${acceptedSlot.label} work for you?`);
          return fail("gate_denied");
        }
      }

      const bookingResult = await bookMeetingForLead(leadId, acceptedSlot.datetime, {
        availabilitySource: acceptedSlot.availabilitySource,
      });

      if (bookingResult.success) {
        await sendAutoBookingSlackNotification(leadId, acceptedSlot);

        const bookingLink = await getBookingLink(lead.clientId, lead.client.settings);
        const confirmationChannel = await resolveConfirmationChannel();
        if (confirmationChannel !== "call") {
          const confirmResult = await sendAutoBookingConfirmation({
            lead,
            channel: confirmationChannel,
            slot: acceptedSlot,
            timeZone,
            leadTimeZone: tzResult.timezone || null,
            bookingLink,
          });
          if (!confirmResult.success) {
            return makeResult({
              booked: true,
              appointmentId: bookingResult.appointmentId,
              error: confirmResult.error || "Booked, but failed to send confirmation",
            });
          }
        } else if (preferred) {
          return makeResult({
            booked: true,
            appointmentId: bookingResult.appointmentId,
            error: "Booked, but inbound channel is unavailable for confirmation",
          });
        }

        return makeResult({
          booked: true,
          appointmentId: bookingResult.appointmentId,
        });
      }

      return fail("booking_api_error", { error: bookingResult.error });
    }

    // Scenario 3: lead proposes their own time (or a day-only preference).
    const shouldParseProposal =
      route === "proposed_time" || route === "day_only"
        ? true
        : overseerDecision.is_scheduling_related && overseerDecision.intent === "propose_time";

    if (!shouldParseProposal) {
      return fail("no_scheduling_intent");
    }

    if ((route === "proposed_time" || route === "day_only") && !overseerDecision.time_from_body_only) {
      const bodyClarification = "Could you confirm the exact day/time you want from your message body so I can schedule it correctly?";
      await createClarificationTask(bodyClarification);
      return fail("needs_clarification");
    }

    if (overseerDecision?.needs_clarification) {
      const clarification =
        overseerDecision.relative_preference && overseerDecision.relative_preference.includes("week")
          ? "Got it — which day and time works best for you?"
          : "Got it — what day and time works best for you?";
      await createClarificationTask(clarification);
      return fail("needs_clarification");
    }

    const nowUtcIsoForParse = new Date().toISOString();
    const proposed =
      route === "day_only"
        ? { proposedStartTimesUtc: [], confidence: 0, needsTimezoneClarification: false }
        : await parseProposedTimesFromMessage(messageTrimmed, {
            clientId: lead.clientId,
            leadId: lead.id,
            nowUtcIso: nowUtcIsoForParse,
            leadTimezone: tzResult.timezone || null,
          });

    if (!proposed) {
      await createClarificationTask("Got it — what day and time works best for you?");
      return fail("needs_clarification");
    }

    if (proposed.needsTimezoneClarification) {
      const type = await pickTaskType();
      const timezoneClarification = "What timezone are you in for that time?";
      const task = await prisma.followUpTask.create({
        data: {
          leadId,
          type,
          dueDate: new Date(),
          status: "pending",
          suggestedMessage: timezoneClarification,
        },
        select: { id: true },
      });

      const triggerMessageId = `followup_task:${task.id}`;
      await prisma.aIDraft
        .create({
          data: {
            leadId,
            triggerMessageId,
            content: timezoneClarification,
            channel: type,
            status: "pending",
          },
          select: { id: true },
        })
        .catch((error) => {
          if (!isPrismaUniqueConstraintError(error)) throw error;
        });

      markTaskCreated({
        kind: "timezone_clarification",
        suggestedMessage: timezoneClarification,
        isClarification: true,
      });
      return fail("needs_clarification");
    }

    const bookingTarget = await selectBookingTargetForLead({
      clientId: lead.clientId,
      leadId: lead.id,
    });
    const requestedAvailabilitySource: AvailabilitySource =
      bookingTarget.target === "no_questions" ? "DIRECT_BOOK" : "DEFAULT";

    const availability = await getWorkspaceAvailabilitySlotsUtc(lead.clientId, {
      refreshIfStale: true,
      availabilitySource: requestedAvailabilitySource,
    });
    const availabilitySet = new Set(availability.slotsUtc);

    const slotMatchWindowMsRaw = Number.parseInt(process.env.AUTO_BOOK_SLOT_MATCH_WINDOW_MS || "1800000", 10);
    const slotMatchWindowMs = Number.isFinite(slotMatchWindowMsRaw) && slotMatchWindowMsRaw >= 0
      ? slotMatchWindowMsRaw
      : 30 * 60 * 1000;
    const nearestAutoHoldMaxMinutesRaw = Number.parseInt(process.env.AUTO_BOOK_NEAREST_AUTO_HOLD_MAX_MINUTES || "15", 10);
    const nearestAutoHoldMaxMinutes = Number.isFinite(nearestAutoHoldMaxMinutesRaw) && nearestAutoHoldMaxMinutesRaw >= 0
      ? nearestAutoHoldMaxMinutesRaw
      : 15;
    const nearestOfferFallbackMinutesRaw = Number.parseInt(process.env.AUTO_BOOK_NEAREST_OFFER_FALLBACK_MINUTES || "25", 10);
    const nearestOfferFallbackMinutes =
      Number.isFinite(nearestOfferFallbackMinutesRaw) && nearestOfferFallbackMinutesRaw >= nearestAutoHoldMaxMinutes
        ? nearestOfferFallbackMinutesRaw
        : Math.max(25, nearestAutoHoldMaxMinutes);
    const nearestOfferFallbackWindowMs = nearestOfferFallbackMinutes * 60 * 1000;

    let match = proposed.proposedStartTimesUtc.find((iso) => availabilitySet.has(iso)) ?? null;
    let nearestMatch: ReturnType<typeof findNearestAvailableSlot> | null = null;
    const nearestFallbackCandidates = new Map<
      string,
      { slotUtcIso: string; deltaMinutes: number; direction: "before" | "after" | "exact" }
    >();

    if (match) {
      context.matchStrategy = "exact";
    } else if (slotMatchWindowMs > 0) {
      for (const proposedIso of proposed.proposedStartTimesUtc) {
        const nearest = findNearestAvailableSlot(proposedIso, availability.slotsUtc, slotMatchWindowMs);
        if (!nearest) continue;
        if (
          !nearestMatch ||
          nearest.deltaMinutes < nearestMatch.deltaMinutes ||
          (nearest.deltaMinutes === nearestMatch.deltaMinutes && nearest.direction === "after")
        ) {
          nearestMatch = nearest;
          match = nearest.slotUtcIso;
          context.matchStrategy = nearest.strategy;
        }
      }
    }

    if (nearestOfferFallbackWindowMs > 0) {
      for (const proposedIso of proposed.proposedStartTimesUtc) {
        const options = findNearestAvailableSlotOptions(
          proposedIso,
          availability.slotsUtc,
          Math.max(slotMatchWindowMs, nearestOfferFallbackWindowMs),
          3
        );
        for (const option of options) {
          const existing = nearestFallbackCandidates.get(option.slotUtcIso);
          if (!existing || option.deltaMinutes < existing.deltaMinutes) {
            nearestFallbackCandidates.set(option.slotUtcIso, option);
          }
        }
      }
    }

    let highConfidenceThreshold = 0.9;
    try {
      highConfidenceThreshold = await resolveThreshold(
        lead.clientId,
        CONFIDENCE_POLICY_KEYS.followupAutoBook,
        "proposed_times_match_threshold"
      );
    } catch (error) {
      console.warn("[FollowupEngine] Failed to resolve followup auto-book threshold; falling back to 0.9", {
        clientId: lead.clientId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      highConfidenceThreshold = 0.9;
    }

    let shouldAutoBookMatched = Boolean(match) && proposed.confidence >= highConfidenceThreshold;
    if (match && context.matchStrategy !== "exact" && nearestMatch) {
      const canAutoHoldNearest =
        nearestMatch.direction === "after" && nearestMatch.deltaMinutes <= nearestAutoHoldMaxMinutes;
      if (!canAutoHoldNearest) shouldAutoBookMatched = false;
    }
    const hasMatchButLowConfidence = Boolean(match) && proposed.confidence < highConfidenceThreshold;
    const nearestFallbackOptions = Array.from(nearestFallbackCandidates.values())
      .sort((a, b) => {
        if (a.deltaMinutes !== b.deltaMinutes) return a.deltaMinutes - b.deltaMinutes;
        if (a.direction === b.direction) return 0;
        if (a.direction === "after") return -1;
        if (b.direction === "after") return 1;
        return 0;
      })
      .slice(0, 2);

    if (shouldAutoBookMatched && bookingGateEnabled) {
      const matchLabel = formatAvailabilitySlotLabel({
        datetimeUtcIso: match!,
        timeZone,
        mode: "explicit_tz",
      }).label;

      const { gate, attempts } = await runFollowupBookingGateWithOneRetry({
        runAttempt: (retryCount) =>
          runFollowupBookingGate({
            clientId: lead.clientId,
            leadId: lead.id,
            scenario: "proposed_time_match",
            messageId: meta?.messageId ?? null,
            messageText: messageTrimmed,
            matchedSlotUtc: match!,
            parseConfidence: proposed.confidence,
            nowUtcIso: nowUtcIsoForParse,
            leadTimezone: tzResult.timezone || null,
            offeredSlots,
            acceptedSlot: null,
            overseerDecision,
            retryCount,
            retryContext:
              retryCount === 1
                ? `matched_slot_label_explicit_tz: ${matchLabel}\nparse_confidence: ${proposed.confidence.toFixed(3)}`
                : undefined,
          }),
      });

      if (!gate) {
        await createClarificationTask(`Just to confirm, does ${matchLabel} work for you?`);
        await sendAutoBookingBlockedSlackAlert({
          leadId,
          scenario: "proposed_time_match",
          matchedSlotLabel: matchLabel,
          gateDecision: "error",
          gateConfidence: null,
          issues: null,
          retryCount: attempts - 1,
        });
        return fail("gate_denied");
      }

      if (gate.decision === "needs_clarification") {
        await createClarificationTask(gate.clarificationMessage || "What timezone are you in for that time?");
        await sendAutoBookingBlockedSlackAlert({
          leadId,
          scenario: "proposed_time_match",
          matchedSlotLabel: matchLabel,
          gateDecision: gate.decision,
          gateConfidence: gate.confidence,
          issues: gate.issues,
          retryCount: attempts - 1,
        });
        return fail("needs_clarification");
      }

      if (gate.decision === "deny") {
        shouldAutoBookMatched = false;
      }
    }

    if (match && shouldAutoBookMatched) {
      const bookingResult = await bookMeetingForLead(leadId, match, {
        availabilitySource: availability.availabilitySource,
      });
      if (bookingResult.success) {
        const matchLabel = formatAvailabilitySlotLabel({
          datetimeUtcIso: match,
          timeZone,
          mode: "explicit_tz",
        }).label;

        await sendAutoBookingSlackNotification(leadId, {
          datetime: match,
          label: matchLabel,
          offeredAt: new Date().toISOString(),
          availabilitySource: availability.availabilitySource,
        });

        const bookingLink = await getBookingLink(lead.clientId, lead.client.settings);
        const confirmationChannel = await resolveConfirmationChannel();
        if (confirmationChannel !== "call") {
          const confirmResult = await sendAutoBookingConfirmation({
            lead,
            channel: confirmationChannel,
            slot: {
              datetime: match,
              label: matchLabel,
              offeredAt: new Date().toISOString(),
              availabilitySource: availability.availabilitySource,
            },
            timeZone,
            leadTimeZone: tzResult.timezone || null,
            bookingLink,
          });
          if (!confirmResult.success) {
            return makeResult({
              booked: true,
              appointmentId: bookingResult.appointmentId,
              error: confirmResult.error || "Booked, but failed to send confirmation",
            });
          }
        } else if (preferred) {
          return makeResult({
            booked: true,
            appointmentId: bookingResult.appointmentId,
            error: "Booked, but inbound channel is unavailable for confirmation",
          });
        }

        return makeResult({ booked: true, appointmentId: bookingResult.appointmentId });
      }
      return fail("booking_api_error", { error: bookingResult.error });
    }

    // Day-only fallback: lead gives a weekday preference without an exact time (e.g., "Thursday works").
    if (!match && proposed.proposedStartTimesUtc.length === 0) {
      const weekdayToken =
        overseerDecision?.preferred_day_of_week ||
        detectWeekdayTokenFromText(messageTrimmed) ||
        resolveRelativeDateToWeekdayToken(overseerDecision?.relative_preference, timeZone);
      if (weekdayToken) {
        const dayOnlyUtcIso = selectEarliestSlotForWeekday({
          slotsUtcIso: availability.slotsUtc,
          weekdayToken,
          timeZone,
          preferredTimeOfDay: overseerDecision?.preferred_time_of_day ?? null,
        });

        if (dayOnlyUtcIso) {
          const dayOnlyLabel = formatAvailabilitySlotLabel({
            datetimeUtcIso: dayOnlyUtcIso,
            timeZone,
            mode: "explicit_tz",
          }).label;

          const dayOnlySlot: OfferedSlot = {
            datetime: dayOnlyUtcIso,
            label: dayOnlyLabel,
            offeredAt: new Date().toISOString(),
            availabilitySource: availability.availabilitySource,
          };

          if (bookingGateEnabled) {
            const { gate, attempts } = await runFollowupBookingGateWithOneRetry({
              runAttempt: (retryCount) =>
                runFollowupBookingGate({
                  clientId: lead.clientId,
                  leadId: lead.id,
                  scenario: "day_only",
                  messageId: meta?.messageId ?? null,
                  messageText: messageTrimmed,
                  matchedSlotUtc: dayOnlyUtcIso,
                  parseConfidence: undefined,
                  nowUtcIso: nowUtcIsoForParse,
                  leadTimezone: tzResult.timezone || null,
                  offeredSlots,
                  acceptedSlot: null,
                  overseerDecision,
                  retryCount,
                  retryContext:
                    retryCount === 1
                      ? `requested_weekday_token: ${weekdayToken}\nmatched_slot_label_explicit_tz: ${dayOnlyLabel}`
                      : undefined,
                }),
            });

            if (!gate) {
              await createClarificationTask(`Just to confirm, does ${dayOnlyLabel} work for you?`);
              await sendAutoBookingBlockedSlackAlert({
                leadId,
                scenario: "day_only",
                matchedSlotLabel: dayOnlyLabel,
                gateDecision: "error",
                gateConfidence: null,
                issues: null,
                retryCount: attempts - 1,
              });
              return fail("gate_denied");
            }

            if (gate.decision === "needs_clarification") {
              await createClarificationTask(gate.clarificationMessage || "Got it — what time works best for you on that day?");
              await sendAutoBookingBlockedSlackAlert({
                leadId,
                scenario: "day_only",
                matchedSlotLabel: dayOnlyLabel,
                gateDecision: gate.decision,
                gateConfidence: gate.confidence,
                issues: gate.issues,
                retryCount: attempts - 1,
              });
              return fail("needs_clarification");
            }

            if (gate.decision === "deny") {
              await createClarificationTask("Got it — what time works best for you on that day?");
              return fail("gate_denied");
            }
          }

          const bookingResult = await bookMeetingForLead(leadId, dayOnlyUtcIso, {
            availabilitySource: availability.availabilitySource,
          });
          if (bookingResult.success) {
            await sendAutoBookingSlackNotification(leadId, dayOnlySlot);

            const bookingLink = await getBookingLink(lead.clientId, lead.client.settings);
            const confirmationChannel = await resolveConfirmationChannel();
            if (confirmationChannel !== "call") {
              const confirmResult = await sendAutoBookingConfirmation({
                lead,
                channel: confirmationChannel,
                slot: dayOnlySlot,
                timeZone,
                leadTimeZone: tzResult.timezone || null,
                bookingLink,
              });
              if (!confirmResult.success) {
                return makeResult({
                  booked: true,
                  appointmentId: bookingResult.appointmentId,
                  error: confirmResult.error || "Booked, but failed to send confirmation",
                });
              }
            } else if (preferred) {
              return makeResult({
                booked: true,
                appointmentId: bookingResult.appointmentId,
                error: "Booked, but inbound channel is unavailable for confirmation",
              });
            }

            return makeResult({ booked: true, appointmentId: bookingResult.appointmentId });
          }

          return fail("booking_api_error", { error: bookingResult.error });
        }
      }
    }

    // Not safe to auto-book (low confidence or no matching availability). Offer alternatives.
    const type = await pickTaskType();
    const mode = "explicit_tz"; // Always show explicit timezone (e.g., "EST", "PST")

    const anchor = new Date();
    let selectedUtcIso: string[] = [];
    if (nearestFallbackOptions.length > 0) {
      selectedUtcIso = nearestFallbackOptions.map((option) => option.slotUtcIso);
    } else {
      const rangeEnd = new Date(anchor.getTime() + 30 * 24 * 60 * 60 * 1000);
      const offerCounts = await getWorkspaceSlotOfferCountsForRange(lead.clientId, anchor, rangeEnd, {
        availabilitySource: availability.availabilitySource,
      });

      selectedUtcIso = selectDistributedAvailabilitySlots({
        slotsUtcIso: availability.slotsUtc,
        offeredCountBySlotUtcIso: offerCounts,
        timeZone,
        leadTimeZone: tzResult.timezone || null,
        preferWithinDays: 5,
        now: anchor,
      });
    }

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
        clientId: lead.clientId,
        slotUtcIsoList: offered.map((s) => s.datetime),
        offeredAt: new Date(offeredAtIso),
        availabilitySource: availability.availabilitySource,
      }).catch(() => undefined);

      const hasExactProposal = proposed.proposedStartTimesUtc.length > 0;
      const usingNearestFallback = nearestFallbackOptions.length > 0;
      const suggestion =
        offered.length === 2
          ? usingNearestFallback
            ? `Closest to your requested time, does (1) ${offered[0]!.label} or (2) ${offered[1]!.label} work instead?`
            : hasExactProposal
              ? `I don’t have that exact time available — does (1) ${offered[0]!.label} or (2) ${offered[1]!.label} work instead?`
              : `Does (1) ${offered[0]!.label} or (2) ${offered[1]!.label} work for you?`
          : usingNearestFallback
            ? `Closest to your requested time, does ${offered[0]!.label} work instead?`
            : hasExactProposal
              ? `I don’t have that exact time available — does ${offered[0]!.label} work instead?`
              : `Does ${offered[0]!.label} work for you?`;

      const task = await prisma.followUpTask.create({
        data: {
          leadId,
          type,
          dueDate: new Date(),
          status: "pending",
          suggestedMessage: suggestion,
        },
        select: { id: true },
      });
      const triggerMessageId = `followup_task:${task.id}`;
      await prisma.aIDraft
        .create({
          data: {
            leadId,
            triggerMessageId,
            content: suggestion,
            channel: type,
            status: "pending",
          },
          select: { id: true },
        })
        .catch((error) => {
          if (!isPrismaUniqueConstraintError(error)) throw error;
        });
      markTaskCreated({
        kind: "alternatives",
        suggestedMessage: suggestion,
        isClarification: false,
      });
    } else {
      const noAvailabilityMessage = "The lead proposed a time, but no availability match was found. Please propose alternative times.";
      const task = await prisma.followUpTask.create({
        data: {
          leadId,
          type,
          dueDate: new Date(),
          status: "pending",
          suggestedMessage: noAvailabilityMessage,
        },
        select: { id: true },
      });
      const triggerMessageId = `followup_task:${task.id}`;
      await prisma.aIDraft
        .create({
          data: {
            leadId,
            triggerMessageId,
            content: noAvailabilityMessage,
            channel: type,
            status: "pending",
          },
          select: { id: true },
        })
        .catch((error) => {
          if (!isPrismaUniqueConstraintError(error)) throw error;
        });
      markTaskCreated({
        kind: "alternatives",
        suggestedMessage: noAvailabilityMessage,
        isClarification: false,
      });
    }

    return fail(hasMatchButLowConfidence ? "low_confidence" : "no_match");
  } catch (error) {
    console.error("Failed to process message for auto-booking:", error);
    return {
      booked: false,
      error: error instanceof Error ? error.message : "Unknown error",
      context: defaultAutoBookingContext({ failureReason: "overseer_error" }),
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

async function sendAutoBookingBlockedSlackAlert(opts: {
  leadId: string;
  scenario: FollowupBookingGateScenario;
  matchedSlotLabel: string;
  gateDecision: "approve" | "needs_clarification" | "deny" | "error";
  gateConfidence: number | null;
  issues: string[] | null;
  retryCount: number;
}): Promise<void> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: opts.leadId },
      include: { client: { include: { settings: true } } },
    });

    if (!lead || !lead.client.settings?.slackAlerts) return;

    const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown Lead";

    await sendSlackNotification({
      text: `⚠️ Auto-Booking Blocked`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "⚠️ Auto-Booking Blocked",
            emoji: true,
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Lead:*\n${leadName}` },
            { type: "mrkdwn", text: `*Workspace:*\n${lead.client.name}` },
            { type: "mrkdwn", text: `*Scenario:*\n${opts.scenario}` },
            { type: "mrkdwn", text: `*Slot:*\n${opts.matchedSlotLabel}` },
            { type: "mrkdwn", text: `*Gate:*\n${opts.gateDecision}` },
            {
              type: "mrkdwn",
              text: `*Confidence:*\n${
                typeof opts.gateConfidence === "number" ? opts.gateConfidence.toFixed(2) : "N/A"
              }`,
            },
            { type: "mrkdwn", text: `*Retry Count:*\n${Math.max(0, Math.trunc(opts.retryCount))}` },
            {
              type: "mrkdwn",
              text: `*Issues:*\n${Array.isArray(opts.issues) && opts.issues.length > 0 ? opts.issues.join(", ").slice(0, 200) : "None"}`,
            },
          ],
        },
      ],
    });
  } catch (error) {
    console.error("Failed to send auto-booking blocked Slack alert:", error);
  }
}
