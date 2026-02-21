import "server-only";

import { approveAndSendDraftSystem } from "@/actions/message-actions";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
import {
  getNextAutoSendWindow,
  isWithinAutoSendSchedule,
  resolveAutoSendScheduleConfig,
} from "@/lib/auto-send-schedule";
import { getPublicAppUrl } from "@/lib/app-url";
import { pauseFollowUpsUntil } from "@/lib/followup-engine";
import {
  extractFollowUpTimingFromMessage,
  type FollowUpTimingExtractionResult,
} from "@/lib/followup-timing-extractor";
import { getWorkspaceAvailabilitySlotsUtc, refreshWorkspaceAvailabilityCache } from "@/lib/availability-cache";
import { getBookingLink } from "@/lib/meeting-booking-provider";
import { isPrismaUniqueConstraintError, prisma } from "@/lib/prisma";
import { slackPostMessage } from "@/lib/slack-bot";
import { ensureLeadTimezone } from "@/lib/timezone-inference";

const FOLLOWUP_TASK_AUTO_CAMPAIGN = "Scheduled follow-up (auto)";
const FOLLOWUP_TASK_MANUAL_CAMPAIGN = "Scheduled follow-up (manual)";
const FOLLOWUP_TASK_TIMING_CLARIFY_AUTO_CAMPAIGN = "Follow-up timing clarification (auto)";
const FOLLOWUP_TASK_TIMING_CLARIFY_MANUAL_CAMPAIGN = "Follow-up timing clarification (manual)";
const FOLLOWUP_TASK_TIMING_CLARIFY_PREFIX = "Follow-up timing clarification";
const FOLLOWUP_TASK_FUTURE_WINDOW_DEFER_NOTICE_AUTO_CAMPAIGN = "Follow-up future-window deferral notice (auto)";
const FOLLOWUP_TASK_FUTURE_WINDOW_DEFER_NOTICE_MANUAL_CAMPAIGN = "Follow-up future-window deferral notice (manual)";
const FOLLOWUP_TASK_FUTURE_WINDOW_DEFER_NOTICE_PREFIX = "Follow-up future-window deferral notice";
const FOLLOWUP_TASK_FUTURE_WINDOW_RECONTACT_AUTO_CAMPAIGN = "Follow-up future-window recontact (auto)";
const FOLLOWUP_TASK_FUTURE_WINDOW_RECONTACT_MANUAL_CAMPAIGN = "Follow-up future-window recontact (manual)";
const FOLLOWUP_TASK_FUTURE_WINDOW_RECONTACT_PREFIX = "Follow-up future-window recontact";
const TIMING_CLARIFY_ATTEMPT_RE = /#\s*(\d+)\s*$/;
const DEFAULT_FOLLOWUP_SEND_HOUR_LOCAL = 9;
const DEFAULT_PROCESS_LIMIT = 25;

type SupportedTaskType = "email" | "sms" | "linkedin" | "call";
type InboundTaskChannel = "email" | "sms" | "linkedin" | "unknown";

function parseTimingClarifyAttempt(campaignName: string | null | undefined): 1 | 2 | null {
  const name = (campaignName || "").trim();
  if (!name) return null;
  if (!name.startsWith(FOLLOWUP_TASK_TIMING_CLARIFY_PREFIX)) return null;

  const match = name.match(TIMING_CLARIFY_ATTEMPT_RE);
  const parsed = match ? Number.parseInt(match[1] || "", 10) : 1;
  if (parsed === 1 || parsed === 2) return parsed;
  return null;
}

function buildTimingClarifyCampaignName(opts: { auto: boolean; attempt: 1 | 2 }): string {
  const base = opts.auto ? FOLLOWUP_TASK_TIMING_CLARIFY_AUTO_CAMPAIGN : FOLLOWUP_TASK_TIMING_CLARIFY_MANUAL_CAMPAIGN;
  return `${base} #${opts.attempt}`;
}

function parseBooleanEnv(value: string | undefined | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parsePositiveInt(value: string | undefined | null, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function isValidIanaTimezone(timeZone: string | null | undefined): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function normalizeInboundChannel(value: string | null | undefined): InboundTaskChannel {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "email") return "email";
  if (normalized === "sms") return "sms";
  if (normalized === "linkedin") return "linkedin";
  return "unknown";
}

function hasChannelCapability(
  type: SupportedTaskType,
  lead: {
    email: string | null;
    phone: string | null;
    linkedinId: string | null;
    linkedinUrl: string | null;
  }
): boolean {
  if (type === "email") return Boolean((lead.email || "").trim());
  if (type === "sms") return Boolean((lead.phone || "").trim());
  if (type === "linkedin") return Boolean((lead.linkedinId || "").trim() || (lead.linkedinUrl || "").trim());
  return true;
}

function pickScheduledFollowUpTaskType(opts: {
  inboundChannel: InboundTaskChannel;
  lead: {
    email: string | null;
    phone: string | null;
    linkedinId: string | null;
    linkedinUrl: string | null;
  };
}): SupportedTaskType {
  const preferred = opts.inboundChannel;
  if ((preferred === "email" || preferred === "sms" || preferred === "linkedin") && hasChannelCapability(preferred, opts.lead)) {
    return preferred;
  }

  const fallbackOrder: SupportedTaskType[] = ["sms", "email", "linkedin", "call"];
  for (const type of fallbackOrder) {
    if (hasChannelCapability(type, opts.lead)) return type;
  }
  return "call";
}

export function buildScheduledFollowUpMessage(firstName: string | null | undefined): string {
  const safeFirstName = (firstName || "").trim() || "there";
  return `Hey ${safeFirstName} - circling back like you suggested. Is now a better time to revisit this?`;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

type RawFollowUpTimingClarification = {
  message: string;
  subject: string | null;
  suggestedSnoozeDays: number | null;
  rationale: string | null;
};

type RawFutureWindowDeferralMessage = {
  message: string;
  subject: string | null;
  rationale: string | null;
};

type RawFollowUpTimingReengageGate = {
  decision: "deferral" | "hard_no" | "unclear";
  rationale: string | null;
};

export type FollowUpTimingReengageGateDecision = RawFollowUpTimingReengageGate["decision"];

export async function runFollowUpTimingReengageGate(opts: {
  clientId: string;
  leadId: string;
  messageText: string;
  now?: Date;
}): Promise<{ decision: FollowUpTimingReengageGateDecision; rationale: string | null }> {
  const input = JSON.stringify(
    {
      nowIso: (opts.now ?? new Date()).toISOString(),
      messageText: opts.messageText || "",
    },
    null,
    2
  );

  const result = await runStructuredJsonPrompt<RawFollowUpTimingReengageGate>({
    pattern: "structured_json",
    clientId: opts.clientId,
    leadId: opts.leadId,
    featureId: "followup.timing_reengage_gate",
    promptKey: "followup.timing_reengage_gate.v1",
    model: "gpt-5-mini",
    reasoningEffort: "low",
    systemFallback: `You are classifying an inbound reply that was labeled "Not Interested".

Decide whether this is actually a SOFT deferral (not now / maybe later / circle back later) or a HARD no (do not contact / no interest).

Return JSON only:
{
  "decision": "deferral" | "hard_no" | "unclear",
  "rationale": "short, operator-readable"
}

Decision rules:
- deferral: they are not available now but leave the door open to future contact (even vague).
- hard_no: clear rejection, no future contact desired ("no thanks", "not interested", "stop", "unsubscribe", hostile).
- unclear: ambiguous, auto-reply, or cannot determine. When unclear, fail closed (do not schedule any clarify).`,
    input,
    schemaName: "followup_timing_reengage_gate",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        decision: { type: "string", enum: ["deferral", "hard_no", "unclear"] },
        rationale: { type: ["string", "null"] },
      },
      required: ["decision", "rationale"],
    },
    budget: {
      min: 200,
      max: 320,
      retryMax: 800,
      overheadTokens: 128,
      outputScale: 0.2,
      preferApiCount: true,
    },
    validate: (value) => {
      const anyValue = value as any;
      if (!anyValue || typeof anyValue !== "object") return { success: false, error: "not_an_object" };

      const decisionRaw = typeof anyValue.decision === "string" ? anyValue.decision.trim() : "";
      if (decisionRaw !== "deferral" && decisionRaw !== "hard_no" && decisionRaw !== "unclear") {
        return { success: false, error: "invalid_decision" };
      }

      const rationaleRaw = anyValue.rationale;
      const rationale =
        typeof rationaleRaw === "string" ? (rationaleRaw.trim() || null) : rationaleRaw === null ? null : null;

      return {
        success: true,
        data: {
          decision: decisionRaw,
          rationale,
        },
      };
    },
  }).catch(() => null);

  if (!result || !result.success) {
    return { decision: "unclear", rationale: null };
  }

  return { decision: result.data.decision, rationale: result.data.rationale };
}

async function generateFollowUpTimingClarification(opts: {
  clientId: string;
  leadId: string;
  channel: "email" | "sms" | "linkedin";
  messageText: string;
  leadFirstName: string | null;
  normalizedText: string | null;
  extractionRationale: string | null;
  nowIso: string;
}): Promise<{ message: string; subject: string | null; snoozeDays: number } | null> {
  const input = JSON.stringify(
    {
      nowIso: opts.nowIso,
      channel: opts.channel,
      leadFirstName: opts.leadFirstName,
      messageText: opts.messageText,
      normalizedText: opts.normalizedText,
      extractionRationale: opts.extractionRationale,
    },
    null,
    2
  );

  const result = await runStructuredJsonPrompt<RawFollowUpTimingClarification>({
    pattern: "structured_json",
    clientId: opts.clientId,
    leadId: opts.leadId,
    featureId: "followup.timing_clarify",
    promptKey: "followup.timing_clarify.v1",
    model: "gpt-5-mini",
    reasoningEffort: "low",
    systemFallback: `You are replying to a lead who said "maybe later" / "not right now" but did NOT give a concrete follow-up date.

Goal: ask a single, polite clarification question that gets a concrete timeframe (month/quarter/date), without being pushy.

Rules:
- Do NOT choose a specific date yourself.
- If the lead mentioned an event (e.g. "this gig"), ask when that wraps or what month is better.
- If the lead gave a range (e.g. "2-3 years"), ask for a specific month/year in that range.
- Keep it short (1-2 sentences). No links. No emojis. No mention of AI.
- For SMS: keep under 320 characters.
- Return JSON only.

Also return suggestedSnoozeDays (integer, may be null) for how long we should pause follow-ups while waiting for a reply (use your best judgement based on the message; longer for "years", shorter for "weeks").`,
    input,
    schemaName: "followup_timing_clarification",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        message: { type: "string" },
        subject: { type: ["string", "null"] },
        suggestedSnoozeDays: { type: ["number", "null"] },
        rationale: { type: ["string", "null"] },
      },
      required: ["message", "subject", "suggestedSnoozeDays", "rationale"],
    },
    budget: {
      min: 1050,
      max: 1650,
      retryMax: 3300,
      overheadTokens: 128,
      outputScale: 0.2,
      preferApiCount: true,
    },
    validate: (value) => {
      const anyValue = value as any;
      if (!anyValue || typeof anyValue !== "object") return { success: false, error: "not_an_object" };
      if (typeof anyValue.message !== "string") return { success: false, error: "message_must_be_string" };
      if (!(typeof anyValue.subject === "string" || anyValue.subject === null)) {
        return { success: false, error: "subject_must_be_string_or_null" };
      }
      if (!(typeof anyValue.suggestedSnoozeDays === "number" || anyValue.suggestedSnoozeDays === null)) {
        return { success: false, error: "suggestedSnoozeDays_must_be_number_or_null" };
      }
      if (!(typeof anyValue.rationale === "string" || anyValue.rationale === null)) {
        return { success: false, error: "rationale_must_be_string_or_null" };
      }

      const message = String(anyValue.message || "").trim();
      if (!message) return { success: false, error: "message_empty" };
      if (opts.channel === "sms" && message.length > 320) {
        return { success: false, error: "sms_message_too_long" };
      }

      const snoozeDaysRaw = anyValue.suggestedSnoozeDays;
      const snoozeDays =
        typeof snoozeDaysRaw === "number" && Number.isFinite(snoozeDaysRaw)
          ? clampInt(snoozeDaysRaw, 1, 3650)
          : 30;

      return {
        success: true,
        data: {
          message,
          subject: typeof anyValue.subject === "string" ? anyValue.subject.trim() || null : null,
          suggestedSnoozeDays: snoozeDays,
          rationale: typeof anyValue.rationale === "string" ? anyValue.rationale.trim() || null : null,
        },
      };
    },
  });

  if (!result.success) return null;

  const message = (result.data.message || "").trim();
  const snoozeDays =
    typeof result.data.suggestedSnoozeDays === "number" && Number.isFinite(result.data.suggestedSnoozeDays)
      ? clampInt(result.data.suggestedSnoozeDays, 1, 3650)
      : 30;

  return {
    message,
    subject: (result.data.subject || "").trim() || null,
    snoozeDays,
  };
}

async function generateFutureWindowDeferralMessage(opts: {
  clientId: string;
  leadId: string;
  channel: "email" | "linkedin";
  messageText: string;
  leadFirstName: string | null;
  windowLabel: string;
  bookingLink: string | null;
  nowIso: string;
}): Promise<{ message: string; subject: string | null } | null> {
  const input = JSON.stringify(
    {
      nowIso: opts.nowIso,
      channel: opts.channel,
      leadFirstName: opts.leadFirstName,
      messageText: opts.messageText,
      windowLabel: opts.windowLabel,
      bookingLink: opts.bookingLink,
    },
    null,
    2
  );

  const result = await runStructuredJsonPrompt<RawFutureWindowDeferralMessage>({
    pattern: "structured_json",
    clientId: opts.clientId,
    leadId: opts.leadId,
    featureId: "followup.future_window_deferral",
    promptKey: "followup.future_window_deferral.v1",
    model: "gpt-5-mini",
    reasoningEffort: "low",
    systemFallback: `You are replying to a lead who proposed a broad future window.

Goal: acknowledge the window and explain availability is not published for that timeframe yet.

Required:
- Explicitly state we do not have availability published yet for the requested window.
- State we will reach back out about one week before that window.
- Include the booking link when provided.
- Keep tone concise and professional.
- Return JSON only.`,
    input,
    schemaName: "followup_future_window_deferral",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        message: { type: "string" },
        subject: { type: ["string", "null"] },
        rationale: { type: ["string", "null"] },
      },
      required: ["message", "subject", "rationale"],
    },
    budget: {
      min: 750,
      max: 1300,
      retryMax: 2600,
      overheadTokens: 128,
      outputScale: 0.2,
      preferApiCount: true,
    },
    validate: (value) => {
      const anyValue = value as any;
      if (!anyValue || typeof anyValue !== "object") return { success: false, error: "not_an_object" };
      if (typeof anyValue.message !== "string") return { success: false, error: "message_must_be_string" };
      if (!(typeof anyValue.subject === "string" || anyValue.subject === null)) {
        return { success: false, error: "subject_must_be_string_or_null" };
      }
      if (!(typeof anyValue.rationale === "string" || anyValue.rationale === null)) {
        return { success: false, error: "rationale_must_be_string_or_null" };
      }

      const message = anyValue.message.trim();
      if (!message) return { success: false, error: "message_empty" };
      if (opts.bookingLink && !message.includes(opts.bookingLink)) {
        return { success: false, error: "booking_link_missing" };
      }

      return {
        success: true,
        data: {
          message,
          subject: typeof anyValue.subject === "string" ? anyValue.subject.trim() || null : null,
          rationale: typeof anyValue.rationale === "string" ? anyValue.rationale.trim() || null : null,
        },
      };
    },
  }).catch(() => null);

  if (!result || !result.success) return null;
  return {
    message: result.data.message.trim(),
    subject: (result.data.subject || "").trim() || null,
  };
}

function parseYmd(value: string | null): { year: number; month: number; day: number } | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [yearRaw, monthRaw, dayRaw] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw) || !Number.isFinite(dayRaw)) return null;
  const check = new Date(Date.UTC(yearRaw, monthRaw - 1, dayRaw));
  if (
    check.getUTCFullYear() !== yearRaw ||
    check.getUTCMonth() + 1 !== monthRaw ||
    check.getUTCDate() !== dayRaw
  ) {
    return null;
  }
  return { year: yearRaw, month: monthRaw, day: dayRaw };
}

function parseHm(value: string | null): { hour: number; minute: number } | null {
  if (!value) return null;
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(":").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function shiftToPreviousBusinessDay(date: Date, timeZone: string): Date {
  const shifted = new Date(date.getTime());
  for (let i = 0; i < 3; i += 1) {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
    }).format(shifted);
    if (weekday !== "Sat" && weekday !== "Sun") return shifted;
    shifted.setUTCDate(shifted.getUTCDate() - 1);
  }
  return shifted;
}

function computeFutureWindowRecontactDueDateUtc(opts: {
  windowStartDate: string;
  timeZone: string;
  now: Date;
}): Date | null {
  const parts = parseYmd(opts.windowStartDate);
  if (!parts) return null;
  const localWindowStart = zonedLocalDateTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: DEFAULT_FOLLOWUP_SEND_HOUR_LOCAL,
    minute: 0,
    timeZone: opts.timeZone,
  });
  if (!localWindowStart) return null;

  const weekBefore = addDaysUtc(localWindowStart, -7);
  const businessAdjusted = shiftToPreviousBusinessDay(weekBefore, opts.timeZone);
  const minDue = new Date(opts.now.getTime() + 5 * 60 * 1000);
  return businessAdjusted.getTime() < minDue.getTime() ? minDue : businessAdjusted;
}

function toFutureWindowLabel(opts: {
  label: string | null;
  startDate: string | null;
  endDate: string | null;
}): string {
  const label = (opts.label || "").trim();
  if (label) return label;
  if (opts.startDate && opts.endDate && opts.startDate !== opts.endDate) {
    return `${opts.startDate} to ${opts.endDate}`;
  }
  return opts.startDate || "that timeframe";
}

function buildDeterministicFutureWindowDeferralMessage(opts: {
  firstName: string | null;
  windowLabel: string;
  bookingLink: string | null;
}): string {
  const name = (opts.firstName || "").trim() || "there";
  const link = (opts.bookingLink || "").trim();
  if (link) {
    return `Hey ${name} - thanks for the note. We don't have availability published for ${opts.windowLabel} yet, but we'll reach out about a week before with options. You can also book here anytime: ${link}`;
  }
  return `Hey ${name} - thanks for the note. We don't have availability published for ${opts.windowLabel} yet, but we'll reach out about a week before with options.`;
}

function buildFutureWindowRecontactMessage(opts: {
  firstName: string | null;
  windowLabel: string;
  bookingLink: string | null;
  hasFreshAvailability: boolean;
}): string {
  const name = (opts.firstName || "").trim() || "there";
  const link = (opts.bookingLink || "").trim();
  if (opts.hasFreshAvailability && link) {
    return `Hey ${name} - following up like promised ahead of ${opts.windowLabel}. We now have openings and you can grab a time that works here: ${link}`;
  }
  if (link) {
    return `Hey ${name} - following up like promised ahead of ${opts.windowLabel}. We do not have finalized openings yet, but you can check the latest calendar here: ${link}`;
  }
  return `Hey ${name} - following up like promised ahead of ${opts.windowLabel}. Reply with a preferred day next week and we'll coordinate from there.`;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  const year = Number.parseInt(get("year") || "", 10);
  const month = Number.parseInt(get("month") || "", 10);
  const day = Number.parseInt(get("day") || "", 10);
  const hour = Number.parseInt(get("hour") || "", 10);
  const minute = Number.parseInt(get("minute") || "", 10);
  const second = Number.parseInt(get("second") || "", 10);

  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return asUtc - date.getTime();
}

export function zonedLocalDateTimeToUtc(opts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}): Date | null {
  const guess = new Date(Date.UTC(opts.year, opts.month - 1, opts.day, opts.hour, opts.minute, 0));
  if (Number.isNaN(guess.getTime())) return null;

  try {
    const offset1 = getTimeZoneOffsetMs(guess, opts.timeZone);
    const utc1 = new Date(guess.getTime() - offset1);
    const offset2 = getTimeZoneOffsetMs(utc1, opts.timeZone);
    return new Date(guess.getTime() - offset2);
  } catch {
    return null;
  }
}

function resolveSchedulingTimezone(opts: {
  extractedTimezone: string | null;
  leadTimezone: string | null;
  workspaceTimezone: string | null;
}): string {
  if (isValidIanaTimezone(opts.extractedTimezone)) return opts.extractedTimezone!;
  if (isValidIanaTimezone(opts.leadTimezone)) return opts.leadTimezone!;
  if (isValidIanaTimezone(opts.workspaceTimezone)) return opts.workspaceTimezone!;
  return "UTC";
}

export function isFollowUpTaskAutoSendEnabled(): boolean {
  return parseBooleanEnv(process.env.FOLLOWUP_TASK_AUTO_SEND_ENABLED);
}

export function isFollowUpTimingClarifyAutoSendEnabled(): boolean {
  return parseBooleanEnv(process.env.FOLLOWUP_TIMING_CLARIFY_AUTO_SEND_ENABLED);
}

function buildLeadInboxUrl(leadId: string): string {
  return `${getPublicAppUrl()}/?view=inbox&leadId=${encodeURIComponent(leadId)}`;
}

export async function cancelPendingTimingClarifyAttempt2OnInbound(opts: {
  leadId: string;
}): Promise<{ cancelled: boolean; cancelledTaskIds: string[] }> {
  const tasks = await prisma.followUpTask
    .findMany({
      where: {
        leadId: opts.leadId,
        status: "pending",
        campaignName: {
          startsWith: FOLLOWUP_TASK_TIMING_CLARIFY_PREFIX,
          endsWith: "#2",
        },
      },
      select: { id: true, type: true },
    })
    .catch(() => []);

  if (tasks.length === 0) {
    return { cancelled: false, cancelledTaskIds: [] };
  }

  await prisma.followUpTask
    .updateMany({
      where: {
        id: { in: tasks.map((t) => t.id) },
        status: "pending",
      },
      data: { status: "cancelled" },
    })
    .catch(() => undefined);

  await prisma.aIDraft
    .updateMany({
      where: {
        leadId: opts.leadId,
        status: "pending",
        OR: tasks.map((t) => ({
          triggerMessageId: `followup_task:${t.id}`,
          channel: t.type,
        })),
      },
      data: { status: "rejected" },
    })
    .catch(() => undefined);

  return { cancelled: true, cancelledTaskIds: tasks.map((t) => t.id) };
}

async function notifyTimingExtractionMissForOps(opts: {
  clientId: string;
  leadId: string;
  messageId: string;
  inboundChannel: InboundTaskChannel;
  reason: string;
  messageSnippet: string;
}): Promise<boolean> {
  const [client, lead, settings] = await Promise.all([
    prisma.client.findUnique({
      where: { id: opts.clientId },
      select: { id: true, name: true, slackBotToken: true },
    }),
    prisma.lead.findUnique({
      where: { id: opts.leadId },
      select: { id: true, firstName: true, lastName: true, email: true },
    }),
    prisma.workspaceSettings.findUnique({
      where: { clientId: opts.clientId },
      select: { slackAlerts: true, notificationSlackChannelIds: true },
    }),
  ]);

  if (!client || !lead || !settings) return false;
  if (settings.slackAlerts === false) return false;
  if (!client.slackBotToken || settings.notificationSlackChannelIds.length === 0) return false;

  const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || lead.email || "Lead";
  const leadUrl = buildLeadInboxUrl(opts.leadId);
  const snippet = opts.messageSnippet.trim().slice(0, 220);

  let sentAny = false;

  for (const channelId of settings.notificationSlackChannelIds) {
    const trimmed = (channelId || "").trim();
    if (!trimmed) continue;

    const dedupeKey = `followup_timing_miss:${opts.clientId}:${opts.leadId}:${opts.messageId}:${opts.reason}:slack:${trimmed}`;
    try {
      await prisma.notificationSendLog.create({
        data: {
          clientId: opts.clientId,
          leadId: opts.leadId,
          kind: "followup_timing_miss",
          destination: "slack",
          sentimentTag: "Follow Up",
          dedupeKey,
        },
      });
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) continue;
      continue;
    }

    const text = [
      "⚠️ *Follow-Up Timing Not Scheduled*",
      `Lead: ${leadName}`,
      `Workspace: ${client.name}`,
      `Channel: ${opts.inboundChannel}`,
      `Reason: ${opts.reason}`,
      snippet ? `Message snippet: "${snippet}"` : null,
      `<${leadUrl}|View in Dashboard>`,
    ]
      .filter(Boolean)
      .join("\n");

    const sendResult = await slackPostMessage({
      token: client.slackBotToken,
      channelId: trimmed,
      text,
    });

    if (!sendResult.success) {
      await prisma.notificationSendLog.deleteMany({ where: { dedupeKey } }).catch(() => undefined);
      continue;
    }
    sentAny = true;
  }

  return sentAny;
}

async function queueAvailabilityRefreshRetry(clientId: string): Promise<void> {
  const staleAt = new Date(Date.now() - 1_000);
  const updated = await prisma.workspaceAvailabilityCache
    .updateMany({
      where: {
        clientId,
        availabilitySource: "DEFAULT",
      },
      data: { staleAt },
    })
    .catch(() => ({ count: 0 }));

  if ((updated?.count ?? 0) > 0) return;
  await refreshWorkspaceAvailabilityCache(clientId, {
    availabilitySource: "DEFAULT",
  }).catch(() => undefined);
}

async function cancelPendingTimingClarifyTasks(leadId: string): Promise<void> {
  const pendingClarifyTasks = await prisma.followUpTask
    .findMany({
      where: {
        leadId,
        status: "pending",
        campaignName: { startsWith: FOLLOWUP_TASK_TIMING_CLARIFY_PREFIX },
      },
      select: { id: true, type: true },
    })
    .catch(() => []);

  if (pendingClarifyTasks.length === 0) return;

  await prisma.followUpTask
    .updateMany({
      where: {
        id: { in: pendingClarifyTasks.map((t) => t.id) },
        status: "pending",
      },
      data: { status: "cancelled" },
    })
    .catch(() => undefined);

  await prisma.aIDraft
    .updateMany({
      where: {
        leadId,
        status: "pending",
        OR: pendingClarifyTasks.map((t) => ({
          triggerMessageId: `followup_task:${t.id}`,
          channel: t.type,
        })),
      },
      data: { status: "rejected" },
    })
    .catch(() => undefined);
}

export type ScheduleFollowUpTimingInboundResult = {
  evaluated: boolean;
  extractionSuccess: boolean;
  scheduled: boolean;
  taskId: string | null;
  taskType: SupportedTaskType | null;
  dueDateUtc: Date | null;
  campaignName: string | null;
  reason: string;
  alertSent: boolean;
};

export async function scheduleFollowUpTimingFromInbound(opts: {
  clientId: string;
  leadId: string;
  messageId: string;
  messageText: string;
  sentimentTag: string | null;
  inboundChannel: string | null | undefined;
}): Promise<ScheduleFollowUpTimingInboundResult> {
  const sentiment = (opts.sentimentTag || "").trim().toLowerCase();
  if (sentiment !== "follow up") {
    return {
      evaluated: false,
      extractionSuccess: false,
      scheduled: false,
      taskId: null,
      taskType: null,
      dueDateUtc: null,
      campaignName: null,
      reason: "sentiment_not_follow_up",
      alertSent: false,
    };
  }

  const inboundChannel = normalizeInboundChannel(opts.inboundChannel);
  const messageText = (opts.messageText || "").trim();
  if (!messageText) {
    return {
      evaluated: true,
      extractionSuccess: false,
      scheduled: false,
      taskId: null,
      taskType: null,
      dueDateUtc: null,
      campaignName: null,
      reason: "empty_message",
      alertSent: false,
    };
  }

  const lead = await prisma.lead.findUnique({
    where: { id: opts.leadId },
    select: {
      id: true,
      clientId: true,
      firstName: true,
      email: true,
      phone: true,
      linkedinId: true,
      linkedinUrl: true,
      timezone: true,
      client: {
        select: {
          settings: {
            select: {
              timezone: true,
              meetingBookingProvider: true,
              calendlyEventTypeLink: true,
            },
          },
        },
      },
    },
  });

  if (!lead) {
    return {
      evaluated: true,
      extractionSuccess: false,
      scheduled: false,
      taskId: null,
      taskType: null,
      dueDateUtc: null,
      campaignName: null,
      reason: "lead_not_found",
      alertSent: false,
    };
  }

  const timezoneResult = await ensureLeadTimezone(lead.id, { conversationText: messageText }).catch(() => ({
    timezone: null as string | null,
  }));
  const extracted: FollowUpTimingExtractionResult = await extractFollowUpTimingFromMessage({
    clientId: opts.clientId,
    leadId: lead.id,
    messageText,
    leadTimezone: timezoneResult.timezone || lead.timezone,
    workspaceTimezone: lead.client.settings?.timezone || null,
  });
  const resolvedTimezone = resolveSchedulingTimezone({
    extractedTimezone: extracted.data.timezone,
    leadTimezone: timezoneResult.timezone || lead.timezone,
    workspaceTimezone: lead.client.settings?.timezone || null,
  });

  const extractionDate = extracted.data.localDate;
  if (!extracted.success || !extracted.data.hasConcreteDate || !extractionDate) {
    const reason = extracted.error?.message || "no_concrete_date_detected";
    const taskType = pickScheduledFollowUpTaskType({
      inboundChannel,
      lead,
    });

    const futureWindowStart = extracted.data.futureWindowStartDate;
    const futureWindowParse = parseYmd(futureWindowStart);
    if (extracted.data.hasFutureWindow && futureWindowStart && futureWindowParse) {
      const windowStartForCoverage =
        zonedLocalDateTimeToUtc({
          year: futureWindowParse.year,
          month: futureWindowParse.month,
          day: futureWindowParse.day,
          hour: 12,
          minute: 0,
          timeZone: resolvedTimezone,
        }) || new Date(Date.UTC(futureWindowParse.year, futureWindowParse.month - 1, futureWindowParse.day, 12, 0, 0));

      let coverageMaxMs: number | null = null;
      let availabilityFailureReason: string | null = null;
      let bookingLink = await getBookingLink(lead.clientId, lead.client.settings || null).catch(() => null);

      try {
        const availability = await getWorkspaceAvailabilitySlotsUtc(opts.clientId, {
          refreshIfStale: true,
          availabilitySource: "DEFAULT",
        });
        if (availability.slotsUtc.length > 0) {
          coverageMaxMs = availability.slotsUtc
            .map((iso) => new Date(iso).getTime())
            .filter((ms) => Number.isFinite(ms))
            .reduce((max, value) => (value > max ? value : max), Number.NEGATIVE_INFINITY);
          if (!Number.isFinite(coverageMaxMs)) coverageMaxMs = null;
        }
        if (!bookingLink) {
          bookingLink = (availability.calendarUrl || "").trim() || null;
        }
        if (availability.lastError) {
          availabilityFailureReason = availability.lastError;
          await queueAvailabilityRefreshRetry(opts.clientId);
        }
      } catch (error) {
        availabilityFailureReason = error instanceof Error ? error.message : "availability_fetch_failed";
        await queueAvailabilityRefreshRetry(opts.clientId);
      }

      const beyondCoverage =
        coverageMaxMs === null ? true : windowStartForCoverage.getTime() > Number(coverageMaxMs);

      if (beyondCoverage) {
        if (taskType === "call") {
          const alertSent = await notifyTimingExtractionMissForOps({
            clientId: opts.clientId,
            leadId: lead.id,
            messageId: opts.messageId,
            inboundChannel,
            reason: `future_window_requires_message_channel:${reason}`,
            messageSnippet: messageText,
          });
          return {
            evaluated: true,
            extractionSuccess: extracted.success,
            scheduled: false,
            taskId: null,
            taskType: null,
            dueDateUtc: null,
            campaignName: null,
            reason: `future_window_requires_message_channel:${reason}`,
            alertSent,
          };
        }

        const windowLabel = toFutureWindowLabel({
          label: extracted.data.futureWindowLabel,
          startDate: extracted.data.futureWindowStartDate,
          endDate: extracted.data.futureWindowEndDate,
        });
        const now = new Date();
        const recontactDueUtc = computeFutureWindowRecontactDueDateUtc({
          windowStartDate: futureWindowStart,
          timeZone: resolvedTimezone,
          now,
        });
        if (!recontactDueUtc) {
          const alertSent = await notifyTimingExtractionMissForOps({
            clientId: opts.clientId,
            leadId: lead.id,
            messageId: opts.messageId,
            inboundChannel,
            reason: `future_window_recontact_due_invalid:${reason}`,
            messageSnippet: messageText,
          });
          return {
            evaluated: true,
            extractionSuccess: extracted.success,
            scheduled: false,
            taskId: null,
            taskType: null,
            dueDateUtc: null,
            campaignName: null,
            reason: `future_window_recontact_due_invalid:${reason}`,
            alertSent,
          };
        }

        const autoEnabled =
          isFollowUpTaskAutoSendEnabled() && (taskType === "email" || taskType === "sms" || taskType === "linkedin");
        const noticeCampaignName = autoEnabled
          ? FOLLOWUP_TASK_FUTURE_WINDOW_DEFER_NOTICE_AUTO_CAMPAIGN
          : FOLLOWUP_TASK_FUTURE_WINDOW_DEFER_NOTICE_MANUAL_CAMPAIGN;
        const recontactCampaignName = autoEnabled
          ? FOLLOWUP_TASK_FUTURE_WINDOW_RECONTACT_AUTO_CAMPAIGN
          : FOLLOWUP_TASK_FUTURE_WINDOW_RECONTACT_MANUAL_CAMPAIGN;

        const deterministicNotice = buildDeterministicFutureWindowDeferralMessage({
          firstName: lead.firstName,
          windowLabel,
          bookingLink,
        });

        let noticeMessage = deterministicNotice;
        let noticeSubject = taskType === "email" ? "Scheduling update" : null;
        if ((taskType === "email" || taskType === "linkedin") && bookingLink) {
          const aiNotice = await generateFutureWindowDeferralMessage({
            clientId: opts.clientId,
            leadId: lead.id,
            channel: taskType,
            messageText,
            leadFirstName: lead.firstName,
            windowLabel,
            bookingLink,
            nowIso: now.toISOString(),
          }).catch(() => null);
          if (aiNotice?.message) noticeMessage = aiNotice.message;
          if (taskType === "email") noticeSubject = aiNotice?.subject || noticeSubject;
        }

        const recontactMessage = buildFutureWindowRecontactMessage({
          firstName: lead.firstName,
          windowLabel,
          bookingLink,
          hasFreshAvailability: coverageMaxMs !== null,
        });

        try {
          const [existingNoticeTask, existingRecontactTask] = await Promise.all([
            prisma.followUpTask.findFirst({
              where: {
                leadId: lead.id,
                status: "pending",
                campaignName: { startsWith: FOLLOWUP_TASK_FUTURE_WINDOW_DEFER_NOTICE_PREFIX },
              },
              orderBy: { createdAt: "desc" },
              select: { id: true },
            }),
            prisma.followUpTask.findFirst({
              where: {
                leadId: lead.id,
                status: "pending",
                campaignName: { startsWith: FOLLOWUP_TASK_FUTURE_WINDOW_RECONTACT_PREFIX },
              },
              orderBy: { createdAt: "desc" },
              select: { id: true },
            }),
          ]);

          let noticeTaskId: string | null = null;
          if (existingNoticeTask) {
            const updated = await prisma.followUpTask.updateMany({
              where: { id: existingNoticeTask.id },
              data: {
                type: taskType,
                dueDate: now,
                status: "pending",
                campaignName: noticeCampaignName,
                suggestedMessage: noticeMessage,
                subject: taskType === "email" ? noticeSubject : null,
              },
            });
            if (updated.count > 0) noticeTaskId = existingNoticeTask.id;
          }
          if (!noticeTaskId) {
            const created = await prisma.followUpTask.create({
              data: {
                leadId: lead.id,
                type: taskType,
                dueDate: now,
                status: "pending",
                campaignName: noticeCampaignName,
                suggestedMessage: noticeMessage,
                subject: taskType === "email" ? noticeSubject : null,
              },
              select: { id: true },
            });
            noticeTaskId = created.id;
          }

          let recontactTaskId: string | null = null;
          if (existingRecontactTask) {
            const updated = await prisma.followUpTask.updateMany({
              where: { id: existingRecontactTask.id },
              data: {
                type: taskType,
                dueDate: recontactDueUtc,
                status: "pending",
                campaignName: recontactCampaignName,
                suggestedMessage: recontactMessage,
                subject: taskType === "email" ? "Checking in before your window" : null,
              },
            });
            if (updated.count > 0) recontactTaskId = existingRecontactTask.id;
          }
          if (!recontactTaskId) {
            const created = await prisma.followUpTask.create({
              data: {
                leadId: lead.id,
                type: taskType,
                dueDate: recontactDueUtc,
                status: "pending",
                campaignName: recontactCampaignName,
                suggestedMessage: recontactMessage,
                subject: taskType === "email" ? "Checking in before your window" : null,
              },
              select: { id: true },
            });
            recontactTaskId = created.id;
          }

          await Promise.all([
            prisma.aIDraft
              .upsert({
                where: {
                  triggerMessageId_channel: {
                    triggerMessageId: `followup_task:${noticeTaskId}`,
                    channel: taskType,
                  },
                },
                update: {
                  content: noticeMessage,
                  status: "pending",
                },
                create: {
                  leadId: lead.id,
                  triggerMessageId: `followup_task:${noticeTaskId}`,
                  content: noticeMessage,
                  channel: taskType,
                  status: "pending",
                },
                select: { id: true },
              })
              .catch((error) => {
                if (!isPrismaUniqueConstraintError(error)) throw error;
              }),
            prisma.aIDraft
              .upsert({
                where: {
                  triggerMessageId_channel: {
                    triggerMessageId: `followup_task:${recontactTaskId}`,
                    channel: taskType,
                  },
                },
                update: {
                  content: recontactMessage,
                  status: "pending",
                },
                create: {
                  leadId: lead.id,
                  triggerMessageId: `followup_task:${recontactTaskId}`,
                  content: recontactMessage,
                  channel: taskType,
                  status: "pending",
                },
                select: { id: true },
              })
              .catch((error) => {
                if (!isPrismaUniqueConstraintError(error)) throw error;
              }),
          ]);

          await prisma.lead.update({
            where: { id: lead.id },
            data: { snoozedUntil: recontactDueUtc },
          });
          await pauseFollowUpsUntil(lead.id, recontactDueUtc);
          await cancelPendingTimingClarifyTasks(lead.id);

          let alertSent = false;
          if (availabilityFailureReason) {
            alertSent = await notifyTimingExtractionMissForOps({
              clientId: opts.clientId,
              leadId: lead.id,
              messageId: opts.messageId,
              inboundChannel,
              reason: `future_window_availability_fetch_failed:${availabilityFailureReason}`,
              messageSnippet: messageText,
            });
          }

          return {
            evaluated: true,
            extractionSuccess: extracted.success,
            scheduled: true,
            taskId: noticeTaskId,
            taskType,
            dueDateUtc: now,
            campaignName: noticeCampaignName,
            reason: `defer_until_window:${futureWindowStart}`,
            alertSent,
          };
        } catch {
          const alertSent = await notifyTimingExtractionMissForOps({
            clientId: opts.clientId,
            leadId: lead.id,
            messageId: opts.messageId,
            inboundChannel,
            reason: `future_window_task_upsert_failed:${reason}`,
            messageSnippet: messageText,
          });
          return {
            evaluated: true,
            extractionSuccess: extracted.success,
            scheduled: false,
            taskId: null,
            taskType: null,
            dueDateUtc: null,
            campaignName: null,
            reason: `future_window_task_upsert_failed:${reason}`,
            alertSent,
          };
        }
      }
    }

    if (taskType === "call") {
      const alertSent = await notifyTimingExtractionMissForOps({
        clientId: opts.clientId,
        leadId: lead.id,
        messageId: opts.messageId,
        inboundChannel,
        reason: `cannot_clarify_by_call:${reason}`,
        messageSnippet: messageText,
      });
      return {
        evaluated: true,
        extractionSuccess: extracted.success,
        scheduled: false,
        taskId: null,
        taskType: null,
        dueDateUtc: null,
        campaignName: null,
        reason: `cannot_clarify_by_call:${reason}`,
        alertSent,
      };
    }

    const existingClarifyTask = await prisma.followUpTask.findFirst({
      where: {
        leadId: lead.id,
        status: "pending",
        OR: [
          {
            campaignName: {
              startsWith: FOLLOWUP_TASK_TIMING_CLARIFY_PREFIX,
              endsWith: "#1",
            },
          },
          { campaignName: FOLLOWUP_TASK_TIMING_CLARIFY_AUTO_CAMPAIGN },
          { campaignName: FOLLOWUP_TASK_TIMING_CLARIFY_MANUAL_CAMPAIGN },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const nowIso = new Date().toISOString();
    const clarification =
      (await generateFollowUpTimingClarification({
        clientId: opts.clientId,
        leadId: lead.id,
        channel: taskType,
        messageText,
        leadFirstName: lead.firstName ?? null,
        normalizedText: extracted.data.normalizedText,
        extractionRationale: extracted.data.rationale,
        nowIso,
      }).catch(() => null)) ?? null;

    const suggestedMessage =
      (clarification?.message || "").trim() ||
      `Totally understand. What timeframe would be better to reconnect (a specific month/quarter/date works)?`;

    const clarifyAutoEnabled =
      isFollowUpTaskAutoSendEnabled() &&
      isFollowUpTimingClarifyAutoSendEnabled() &&
      (taskType === "email" || taskType === "sms" || taskType === "linkedin");
    const campaignName = buildTimingClarifyCampaignName({ auto: clarifyAutoEnabled, attempt: 1 });

    try {
      const baseTaskUpdate = {
        type: taskType,
        dueDate: new Date(),
        status: "pending" as const,
        campaignName,
        suggestedMessage,
        subject: taskType === "email" ? (clarification?.subject || "Quick question") : null,
      };

      let taskId: string | null = null;
      if (existingClarifyTask) {
        const updated = await prisma.followUpTask.updateMany({
          where: { id: existingClarifyTask.id },
          data: baseTaskUpdate,
        });
        if (updated.count > 0) taskId = existingClarifyTask.id;
      }

      if (!taskId) {
        const created = await prisma.followUpTask.create({
          data: {
            leadId: lead.id,
            ...baseTaskUpdate,
          },
          select: { id: true },
        });
        taskId = created.id;
      }

      const triggerMessageId = `followup_task:${taskId}`;
      const draftContent =
        (suggestedMessage || "").trim() ||
        `Totally understand. What timeframe would be better to reconnect (a specific month/quarter/date works)?`;

      await prisma.aIDraft
        .upsert({
          where: {
            triggerMessageId_channel: {
              triggerMessageId,
              channel: taskType,
            },
          },
          update: {
            content: draftContent,
            status: "pending",
          },
          create: {
            leadId: lead.id,
            triggerMessageId,
            content: draftContent,
            channel: taskType,
            status: "pending",
          },
          select: { id: true },
        })
        .catch((error) => {
          if (!isPrismaUniqueConstraintError(error)) throw error;
        });

      return {
        evaluated: true,
        extractionSuccess: extracted.success,
        scheduled: true,
        taskId,
        taskType,
        dueDateUtc: new Date(),
        campaignName,
        reason: `clarify_missing_date:${reason}`,
        alertSent: false,
      };
    } catch {
      const alertSent = await notifyTimingExtractionMissForOps({
        clientId: opts.clientId,
        leadId: lead.id,
        messageId: opts.messageId,
        inboundChannel,
        reason,
        messageSnippet: messageText,
      });
      return {
        evaluated: true,
        extractionSuccess: extracted.success,
        scheduled: false,
        taskId: null,
        taskType: null,
        dueDateUtc: null,
        campaignName: null,
        reason,
        alertSent,
      };
    }
  }

  const dateParts = parseYmd(extractionDate);
  const timeParts = parseHm(extracted.data.localTime) || {
    hour: DEFAULT_FOLLOWUP_SEND_HOUR_LOCAL,
    minute: 0,
  };

  if (!dateParts) {
    const alertSent = await notifyTimingExtractionMissForOps({
      clientId: opts.clientId,
      leadId: lead.id,
      messageId: opts.messageId,
      inboundChannel,
      reason: "invalid_local_date",
      messageSnippet: messageText,
    });
    return {
      evaluated: true,
      extractionSuccess: true,
      scheduled: false,
      taskId: null,
      taskType: null,
      dueDateUtc: null,
      campaignName: null,
      reason: "invalid_local_date",
      alertSent,
    };
  }

  const dueDateUtc = zonedLocalDateTimeToUtc({
    year: dateParts.year,
    month: dateParts.month,
    day: dateParts.day,
    hour: timeParts.hour,
    minute: timeParts.minute,
    timeZone: resolvedTimezone,
  });

  if (!dueDateUtc || Number.isNaN(dueDateUtc.getTime())) {
    const alertSent = await notifyTimingExtractionMissForOps({
      clientId: opts.clientId,
      leadId: lead.id,
      messageId: opts.messageId,
      inboundChannel,
      reason: "utc_conversion_failed",
      messageSnippet: messageText,
    });
    return {
      evaluated: true,
      extractionSuccess: true,
      scheduled: false,
      taskId: null,
      taskType: null,
      dueDateUtc: null,
      campaignName: null,
      reason: "utc_conversion_failed",
      alertSent,
    };
  }

  const now = new Date();
  if (dueDateUtc.getTime() <= now.getTime() + 60 * 60 * 1000) {
    const alertSent = await notifyTimingExtractionMissForOps({
      clientId: opts.clientId,
      leadId: lead.id,
      messageId: opts.messageId,
      inboundChannel,
      reason: "non_future_due_date",
      messageSnippet: messageText,
    });
    return {
      evaluated: true,
      extractionSuccess: true,
      scheduled: false,
      taskId: null,
      taskType: null,
      dueDateUtc: null,
      campaignName: null,
      reason: "non_future_due_date",
      alertSent,
    };
  }

  const taskType = pickScheduledFollowUpTaskType({
    inboundChannel,
    lead,
  });
  const suggestedMessage = buildScheduledFollowUpMessage(lead.firstName);
  const subject = taskType === "email" ? "Circling back" : null;
  const autoCampaign =
    isFollowUpTaskAutoSendEnabled() && (taskType === "email" || taskType === "sms")
      ? FOLLOWUP_TASK_AUTO_CAMPAIGN
      : FOLLOWUP_TASK_MANUAL_CAMPAIGN;

  const existingPendingTask = await prisma.followUpTask.findFirst({
    where: {
      leadId: lead.id,
      status: "pending",
      campaignName: {
        startsWith: "Scheduled follow-up",
      },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  let taskId: string;
  if (existingPendingTask) {
    const updated = await prisma.followUpTask.update({
      where: { id: existingPendingTask.id },
      data: {
        type: taskType,
        dueDate: dueDateUtc,
        status: "pending",
        campaignName: autoCampaign,
        suggestedMessage,
        subject,
      },
      select: { id: true },
    });
    taskId = updated.id;
  } else {
    const created = await prisma.followUpTask.create({
      data: {
        leadId: lead.id,
        type: taskType,
        dueDate: dueDateUtc,
        status: "pending",
        campaignName: autoCampaign,
        suggestedMessage,
        subject,
      },
      select: { id: true },
    });
    taskId = created.id;
  }

  await prisma.lead.update({
    where: { id: lead.id },
    data: { snoozedUntil: dueDateUtc },
  });
  await pauseFollowUpsUntil(lead.id, dueDateUtc);

  // If we previously asked for a concrete follow-up timeframe, cancel that pending task.
  await cancelPendingTimingClarifyTasks(lead.id);

  return {
    evaluated: true,
    extractionSuccess: true,
    scheduled: true,
    taskId,
    taskType,
    dueDateUtc,
    campaignName: autoCampaign,
    reason: "scheduled",
    alertSent: false,
  };
}

function deriveManualCampaignName(currentCampaignName: string | null | undefined): string {
  const campaign = (currentCampaignName || "").trim();
  if (campaign.startsWith(FOLLOWUP_TASK_TIMING_CLARIFY_PREFIX)) {
    const attempt = parseTimingClarifyAttempt(campaign) ?? 1;
    return buildTimingClarifyCampaignName({ auto: false, attempt });
  }
  if (campaign.startsWith(FOLLOWUP_TASK_FUTURE_WINDOW_DEFER_NOTICE_PREFIX)) {
    return FOLLOWUP_TASK_FUTURE_WINDOW_DEFER_NOTICE_MANUAL_CAMPAIGN;
  }
  if (campaign.startsWith(FOLLOWUP_TASK_FUTURE_WINDOW_RECONTACT_PREFIX)) {
    return FOLLOWUP_TASK_FUTURE_WINDOW_RECONTACT_MANUAL_CAMPAIGN;
  }
  return FOLLOWUP_TASK_MANUAL_CAMPAIGN;
}

async function markScheduledTaskManual(taskId: string, currentCampaignName: string | null | undefined): Promise<void> {
  await prisma.followUpTask.update({
    where: { id: taskId },
    data: {
      campaignName: deriveManualCampaignName(currentCampaignName),
      status: "pending",
    },
  });
}

export type ProcessScheduledTimingFollowUpTasksResult = {
  enabled: boolean;
  processed: number;
  sent: number;
  completedAlready: number;
  rescheduled: number;
  convertedToManual: number;
  skipped: number;
  errors: string[];
};

export async function processScheduledTimingFollowUpTasksDue(opts?: {
  now?: Date;
  limit?: number;
}): Promise<ProcessScheduledTimingFollowUpTasksResult> {
  const now = opts?.now ?? new Date();
  const enabled = isFollowUpTaskAutoSendEnabled();
  if (!enabled) {
    return {
      enabled: false,
      processed: 0,
      sent: 0,
      completedAlready: 0,
      rescheduled: 0,
      convertedToManual: 0,
      skipped: 0,
      errors: [],
    };
  }

  const clarifyEnabled = isFollowUpTimingClarifyAutoSendEnabled();
  const timingClarifyCampaignWhere = clarifyEnabled
    ? {
        OR: [
          { campaignName: FOLLOWUP_TASK_AUTO_CAMPAIGN },
          { campaignName: { startsWith: FOLLOWUP_TASK_TIMING_CLARIFY_AUTO_CAMPAIGN } },
          { campaignName: FOLLOWUP_TASK_FUTURE_WINDOW_DEFER_NOTICE_AUTO_CAMPAIGN },
          { campaignName: FOLLOWUP_TASK_FUTURE_WINDOW_RECONTACT_AUTO_CAMPAIGN },
        ],
      }
    : {
        OR: [
          { campaignName: FOLLOWUP_TASK_AUTO_CAMPAIGN },
          { campaignName: FOLLOWUP_TASK_FUTURE_WINDOW_DEFER_NOTICE_AUTO_CAMPAIGN },
          { campaignName: FOLLOWUP_TASK_FUTURE_WINDOW_RECONTACT_AUTO_CAMPAIGN },
        ],
      };

  const limit = opts?.limit ?? parsePositiveInt(process.env.FOLLOWUP_TASK_AUTO_SEND_LIMIT, DEFAULT_PROCESS_LIMIT);
  const tasks = await prisma.followUpTask.findMany({
    where: {
      status: "pending",
      ...timingClarifyCampaignWhere,
      dueDate: { lte: now },
    },
    orderBy: { dueDate: "asc" },
    take: limit,
    include: {
      lead: {
        select: {
          id: true,
          clientId: true,
          firstName: true,
          email: true,
          phone: true,
          status: true,
          sentimentTag: true,
          timezone: true,
          emailCampaign: {
            select: {
              responseMode: true,
              autoSendScheduleMode: true,
              autoSendCustomSchedule: true,
            },
          },
          client: {
            select: {
              settings: {
                select: {
                  followUpsPausedUntil: true,
                  timezone: true,
                  workStartTime: true,
                  workEndTime: true,
                  autoSendScheduleMode: true,
                  autoSendCustomSchedule: true,
                  meetingBookingProvider: true,
                  calendlyEventTypeLink: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const result: ProcessScheduledTimingFollowUpTasksResult = {
    enabled: true,
    processed: 0,
    sent: 0,
    completedAlready: 0,
    rescheduled: 0,
    convertedToManual: 0,
    skipped: 0,
    errors: [],
  };

  for (const task of tasks) {
    result.processed += 1;
    try {
      if (task.type !== "email" && task.type !== "sms" && task.type !== "linkedin") {
        await markScheduledTaskManual(task.id, task.campaignName);
        result.convertedToManual += 1;
        continue;
      }

      const leadStatus = (task.lead.status || "").trim().toLowerCase();
      const leadSentiment = (task.lead.sentimentTag || "").trim().toLowerCase();
      if (leadStatus === "blacklisted" || leadSentiment === "blacklist") {
        await markScheduledTaskManual(task.id, task.campaignName);
        result.convertedToManual += 1;
        continue;
      }

      const pausedUntil = task.lead.client.settings?.followUpsPausedUntil ?? null;
      if (pausedUntil && pausedUntil.getTime() > now.getTime()) {
        await markScheduledTaskManual(task.id, task.campaignName);
        result.convertedToManual += 1;
        continue;
      }

      const responseMode = (task.lead.emailCampaign?.responseMode || "").trim();
      if (responseMode !== "AI_AUTO_SEND") {
        await markScheduledTaskManual(task.id, task.campaignName);
        result.convertedToManual += 1;
        continue;
      }

      const hasMeaningfulConversationActivity = await prisma.message.findFirst({
        where: {
          leadId: task.leadId,
          sentAt: { gt: task.createdAt },
          OR: [{ direction: "inbound" }, { direction: "outbound", sentBy: "setter" }],
        },
        select: { id: true },
      });
      if (hasMeaningfulConversationActivity) {
        await markScheduledTaskManual(task.id, task.campaignName);
        result.convertedToManual += 1;
        continue;
      }

      const scheduleConfig = resolveAutoSendScheduleConfig(
        task.lead.client.settings ?? null,
        task.lead.emailCampaign ?? null,
        task.lead.timezone ?? null
      );
      const scheduleCheck = isWithinAutoSendSchedule(scheduleConfig, now);
      if (!scheduleCheck.withinSchedule) {
        const nextWindow = scheduleCheck.nextWindowStart || getNextAutoSendWindow(scheduleConfig, now);
        await prisma.followUpTask.update({
          where: { id: task.id },
          data: { dueDate: nextWindow },
        });
        result.rescheduled += 1;
        continue;
      }

      const triggerMessageId = `followup_task:${task.id}`;
      let draft = await prisma.aIDraft.findUnique({
        where: {
          triggerMessageId_channel: {
            triggerMessageId,
            channel: task.type,
          },
        },
        select: {
          id: true,
          status: true,
        },
      });

      if (draft?.status === "approved") {
        await prisma.followUpTask.update({
          where: { id: task.id },
          data: {
            status: "completed",
          },
        });
        result.completedAlready += 1;
        continue;
      }

      if (draft?.status === "rejected") {
        await markScheduledTaskManual(task.id, task.campaignName);
        result.convertedToManual += 1;
        continue;
      }

      let refreshedRecontactContent: string | null = null;
      const isFutureWindowRecontact = (task.campaignName || "").startsWith(FOLLOWUP_TASK_FUTURE_WINDOW_RECONTACT_PREFIX);
      if (isFutureWindowRecontact) {
        try {
          const [availability, bookingLink] = await Promise.all([
            getWorkspaceAvailabilitySlotsUtc(task.lead.clientId, {
              refreshIfStale: true,
              availabilitySource: "DEFAULT",
            }),
            getBookingLink(task.lead.clientId, task.lead.client.settings || null),
          ]);
          const message = buildFutureWindowRecontactMessage({
            firstName: task.lead.firstName,
            windowLabel: "your requested timeframe",
            bookingLink: bookingLink || availability.calendarUrl || null,
            hasFreshAvailability: availability.slotsUtc.length > 0,
          });
          refreshedRecontactContent = message;

          await prisma.followUpTask.update({
            where: { id: task.id },
            data: {
              suggestedMessage: message,
              subject: task.type === "email" ? "Checking in before your window" : null,
            },
          });

          if (draft && draft.status === "pending") {
            await prisma.aIDraft.update({
              where: { id: draft.id },
              data: { content: message },
            });
          }
        } catch (error) {
          await queueAvailabilityRefreshRetry(task.lead.clientId).catch(() => undefined);
          result.errors.push(
            `task:${task.id}:future_window_recontact_refresh_failed:${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      if (!draft) {
        const content =
          (refreshedRecontactContent || "").trim() ||
          (task.suggestedMessage || "").trim() ||
          buildScheduledFollowUpMessage(task.lead.firstName);
        draft = await prisma.aIDraft.create({
          data: {
            leadId: task.leadId,
            triggerMessageId,
            content,
            channel: task.type,
            status: "pending",
          },
          select: {
            id: true,
            status: true,
          },
        });
      }

      const sendResult = await approveAndSendDraftSystem(draft.id, { sentBy: "ai" });
      if (!sendResult.success) {
        await markScheduledTaskManual(task.id, task.campaignName);
        result.convertedToManual += 1;
        result.errors.push(`task:${task.id}:${sendResult.error || "send_failed"}`);
        continue;
      }

      await prisma.followUpTask.update({
        where: { id: task.id },
        data: {
          status: "completed",
        },
      });
      result.sent += 1;
    } catch (error) {
      result.errors.push(`task:${task.id}:${error instanceof Error ? error.message : String(error)}`);
      await markScheduledTaskManual(task.id, task.campaignName).catch(() => undefined);
      result.convertedToManual += 1;
    }
  }

  return result;
}
