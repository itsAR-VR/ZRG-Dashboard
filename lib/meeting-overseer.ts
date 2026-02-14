import "server-only";

import { prisma } from "@/lib/prisma";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
import { coerceEmailDraftVerificationModel } from "@/lib/ai-drafts/config";
import {
  deriveAIDecisionContractV1FromExtraction,
  repairAIDecisionContractV1,
  validateAIDecisionContractV1,
  type AIDecisionContractV1,
} from "@/lib/ai/decision-contract";
import type { OfferedSlot } from "@/lib/booking";
import { isAutoBookingBlockedSentiment } from "@/lib/sentiment-shared";
import { isValidIanaTimezone } from "@/lib/timezone-inference";

export type MeetingOverseerStage = "extract" | "gate";
export type MeetingOverseerIntent =
  | "accept_offer"
  | "request_times"
  | "propose_time"
  | "reschedule"
  | "decline"
  | "other";

export type MeetingOverseerExtractDecision = {
  is_scheduling_related: boolean;
  intent: MeetingOverseerIntent;
  intent_to_book: boolean;
  intent_confidence: number;
  acceptance_specificity: "specific" | "day_only" | "generic" | "none";
  accepted_slot_index: number | null;
  preferred_day_of_week: string | null;
  preferred_time_of_day: string | null;
  relative_preference: string | null;
  relative_preference_detail: string | null;
  qualification_status: "qualified" | "unqualified" | "unknown";
  qualification_confidence: number;
  qualification_evidence: string[];
  time_from_body_only: boolean;
  detected_timezone: string | null;
  time_extraction_confidence: number;
  needs_clarification: boolean;
  clarification_reason: string | null;
  needs_pricing_answer: boolean;
  needs_community_details: boolean;
  confidence: number;
  evidence: string[];
  decision_contract_v1?: AIDecisionContractV1 | null;
  decision_contract_status?: "ok" | "decision_error";
  decision_contract_error?: string | null;
};

export type MeetingOverseerGateDecision = {
  decision: "approve" | "revise";
  final_draft: string | null;
  confidence: number;
  issues: string[];
  rationale: string;
};

export type MeetingOverseerGateResult = {
  finalDraft: string | null;
  decision: MeetingOverseerGateDecision | null;
  fromCache: boolean;
};

const MEETING_OVERSEER_EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    is_scheduling_related: { type: "boolean" },
    intent: { type: "string" },
    intent_to_book: { type: "boolean" },
    intent_confidence: { type: "number" },
    acceptance_specificity: { type: "string" },
    accepted_slot_index: { type: ["number", "null"] },
    preferred_day_of_week: { type: ["string", "null"] },
    preferred_time_of_day: { type: ["string", "null"] },
    relative_preference: { type: ["string", "null"] },
    relative_preference_detail: { type: ["string", "null"] },
    qualification_status: { type: "string" },
    qualification_confidence: { type: "number" },
    qualification_evidence: { type: "array", items: { type: "string" } },
    time_from_body_only: { type: "boolean" },
    detected_timezone: { type: ["string", "null"] },
    time_extraction_confidence: { type: "number" },
    needs_clarification: { type: "boolean" },
    clarification_reason: { type: ["string", "null"] },
    needs_pricing_answer: { type: "boolean" },
    needs_community_details: { type: "boolean" },
    confidence: { type: "number" },
    evidence: { type: "array", items: { type: "string" } },
  },
  required: [
    "is_scheduling_related",
    "intent",
    "intent_to_book",
    "intent_confidence",
    "acceptance_specificity",
    "accepted_slot_index",
    "preferred_day_of_week",
    "preferred_time_of_day",
    "relative_preference",
    "relative_preference_detail",
    "qualification_status",
    "qualification_confidence",
    "qualification_evidence",
    "time_from_body_only",
    "detected_timezone",
    "time_extraction_confidence",
    "needs_clarification",
    "clarification_reason",
    "needs_pricing_answer",
    "needs_community_details",
    "confidence",
    "evidence",
  ],
} as const;

const MEETING_OVERSEER_GATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string" },
    final_draft: { type: ["string", "null"] },
    confidence: { type: "number" },
    issues: { type: "array", items: { type: "string" } },
    rationale: { type: "string" },
  },
  required: ["decision", "final_draft", "confidence", "issues", "rationale"],
} as const;

const SCHEDULING_KEYWORDS = [
  "schedule",
  "scheduling",
  "book",
  "booking",
  "meeting",
  "call",
  "calendar",
  "availability",
  "available",
  "time",
  "tomorrow",
  "today",
  "next week",
  "later this week",
  "this week",
];

const PRICING_KEYWORDS = [
  "how much",
  "price",
  "pricing",
  "cost",
  "fee",
  "investment",
  "billing",
  "membership",
  "quote",
  "rates",
];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function normalizeDayToken(value: string | null | undefined): string | null {
  const raw = (value || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.startsWith("mon")) return "mon";
  if (raw.startsWith("tue")) return "tue";
  if (raw.startsWith("wed")) return "wed";
  if (raw.startsWith("thu")) return "thu";
  if (raw.startsWith("fri")) return "fri";
  if (raw.startsWith("sat")) return "sat";
  if (raw.startsWith("sun")) return "sun";
  return null;
}

function normalizeTimeOfDay(value: string | null | undefined): "morning" | "afternoon" | "evening" | null {
  const raw = (value || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.startsWith("morn")) return "morning";
  if (raw.startsWith("after")) return "afternoon";
  if (raw.startsWith("even")) return "evening";
  return null;
}

function normalizeRelativePreference(value: string | null | undefined): string | null {
  const raw = (value || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes("later") && raw.includes("week")) return "later_this_week";
  if (raw.includes("next") && raw.includes("week")) return "next_week";
  if (raw.includes("this") && raw.includes("week")) return "this_week";
  if (raw.includes("tomorrow")) return "tomorrow";
  if (raw.includes("today")) return "today";
  if (raw.includes("after")) return "after_date";
  return raw;
}

function normalizeQualificationStatus(
  value: string | null | undefined
): "qualified" | "unqualified" | "unknown" {
  const raw = (value || "").trim().toLowerCase();
  if (raw === "qualified") return "qualified";
  if (raw === "unqualified") return "unqualified";
  return "unknown";
}

function normalizeDetectedTimezone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !isValidIanaTimezone(trimmed)) return null;
  return trimmed;
}

function normalizeDecisionBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "yes" || normalized === "true") return true;
    if (normalized === "no" || normalized === "false") return false;
  }
  return false;
}

function attachDecisionContractV1(
  decision: MeetingOverseerExtractDecision
): MeetingOverseerExtractDecision {
  const derived = deriveAIDecisionContractV1FromExtraction({
    extraction: {
      is_scheduling_related: decision.is_scheduling_related,
      intent_to_book: decision.intent_to_book,
      qualification_status: decision.qualification_status,
      preferred_day_of_week: decision.preferred_day_of_week,
      preferred_time_of_day: decision.preferred_time_of_day,
      relative_preference: decision.relative_preference,
      relative_preference_detail: decision.relative_preference_detail,
      needs_clarification: decision.needs_clarification,
      detected_timezone: decision.detected_timezone,
      needs_pricing_answer: decision.needs_pricing_answer,
      needs_community_details: decision.needs_community_details,
      evidence: decision.evidence,
      qualification_evidence: decision.qualification_evidence,
    },
  });

  const validated = validateAIDecisionContractV1(derived);
  if (validated.success) {
    return {
      ...decision,
      decision_contract_v1: validated.data,
      decision_contract_status: "ok",
      decision_contract_error: null,
    };
  }

  const repaired = repairAIDecisionContractV1(derived);
  if (repaired) {
    const repairedValidation = validateAIDecisionContractV1(repaired);
    if (repairedValidation.success) {
      return {
        ...decision,
        decision_contract_v1: repairedValidation.data,
        decision_contract_status: "ok",
        decision_contract_error: null,
      };
    }
  }

  return {
    ...decision,
    decision_contract_v1: null,
    decision_contract_status: "decision_error",
    decision_contract_error: validated.success ? "contract_validation_failed" : validated.error,
  };
}

export function shouldRunMeetingOverseer(opts: {
  messageText: string;
  sentimentTag?: string | null;
  offeredSlotsCount?: number;
}): boolean {
  if (isAutoBookingBlockedSentiment(opts.sentimentTag)) return false;
  const message = (opts.messageText || "").toLowerCase();
  if (!message) return false;
  if (typeof opts.offeredSlotsCount === "number" && opts.offeredSlotsCount > 0) return true;
  if (opts.sentimentTag && ["Meeting Requested", "Call Requested", "Meeting Booked"].includes(opts.sentimentTag)) return true;
  if (SCHEDULING_KEYWORDS.some((keyword) => message.includes(keyword))) return true;
  return PRICING_KEYWORDS.some((keyword) => message.includes(keyword));
}

export function selectOfferedSlotByPreference(opts: {
  offeredSlots: OfferedSlot[];
  timeZone: string;
  preferredDayOfWeek?: string | null;
  preferredTimeOfDay?: string | null;
}): OfferedSlot | null {
  const offeredSlots = Array.isArray(opts.offeredSlots) ? opts.offeredSlots : [];
  if (offeredSlots.length === 0) return null;

  const dayPreference = normalizeDayToken(opts.preferredDayOfWeek || null);
  const timePreference = normalizeTimeOfDay(opts.preferredTimeOfDay || null);

  if (!dayPreference && !timePreference) return null;

  const matches = offeredSlots.filter((slot) => {
    const date = new Date(slot.datetime);
    if (Number.isNaN(date.getTime())) return false;
    const dayToken = normalizeDayToken(
      new Intl.DateTimeFormat("en-US", { timeZone: opts.timeZone, weekday: "short" }).format(date)
    );
    if (dayPreference && dayToken !== dayPreference) return false;
    if (timePreference) {
      const hourRaw = new Intl.DateTimeFormat("en-US", { timeZone: opts.timeZone, hour: "numeric", hour12: false }).format(date);
      const hour = Number.parseInt(hourRaw, 10);
      if (!Number.isFinite(hour)) return false;
      if (timePreference === "morning" && (hour < 5 || hour >= 12)) return false;
      if (timePreference === "afternoon" && (hour < 12 || hour >= 17)) return false;
      if (timePreference === "evening" && (hour < 17 || hour >= 21)) return false;
    }
    return true;
  });

  if (matches.length === 0) return null;

  return matches.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())[0] ?? null;
}

async function loadExistingDecision(messageId: string, stage: MeetingOverseerStage): Promise<MeetingOverseerExtractDecision | MeetingOverseerGateDecision | null> {
  const existing = await prisma.meetingOverseerDecision.findUnique({
    where: { messageId_stage: { messageId, stage } },
    select: { payload: true },
  });
  if (!existing?.payload || typeof existing.payload !== "object") return null;
  return existing.payload as MeetingOverseerExtractDecision | MeetingOverseerGateDecision;
}

async function persistDecision(opts: {
  messageId: string;
  leadId: string;
  clientId: string;
  stage: MeetingOverseerStage;
  promptKey: string;
  model: string;
  confidence: number | null;
  payload: MeetingOverseerExtractDecision | MeetingOverseerGateDecision;
}): Promise<void> {
  await prisma.meetingOverseerDecision.upsert({
    where: { messageId_stage: { messageId: opts.messageId, stage: opts.stage } },
    create: {
      messageId: opts.messageId,
      leadId: opts.leadId,
      clientId: opts.clientId,
      stage: opts.stage,
      promptKey: opts.promptKey,
      model: opts.model,
      confidence: typeof opts.confidence === "number" ? opts.confidence : null,
      payload: opts.payload as unknown as object,
    },
    update: {
      promptKey: opts.promptKey,
      model: opts.model,
      confidence: typeof opts.confidence === "number" ? opts.confidence : null,
      payload: opts.payload as unknown as object,
    },
  });
}

export async function getMeetingOverseerDecision(
  messageId: string,
  stage: MeetingOverseerStage
): Promise<MeetingOverseerExtractDecision | MeetingOverseerGateDecision | null> {
  if (!messageId) return null;
  const existing = await loadExistingDecision(messageId, stage);
  if (
    stage === "extract" &&
    existing &&
    typeof existing === "object" &&
    "intent_to_book" in existing &&
    "time_from_body_only" in existing
  ) {
    const extract = existing as MeetingOverseerExtractDecision & { detected_timezone?: unknown };
    return attachDecisionContractV1(
      {
      ...extract,
      detected_timezone: normalizeDetectedTimezone(extract.detected_timezone),
      needs_pricing_answer: normalizeDecisionBoolean((extract as { needs_pricing_answer?: unknown }).needs_pricing_answer),
      needs_community_details: normalizeDecisionBoolean((extract as { needs_community_details?: unknown }).needs_community_details),
      }
    );
  }
  return existing;
}

export async function runMeetingOverseerExtraction(opts: {
  clientId: string;
  leadId: string;
  messageId?: string | null;
  messageText: string;
  leadTimezone?: string | null;
  offeredSlots: OfferedSlot[];
  qualificationContext?: string | null;
  conversationContext?: string | null;
  businessContext?: string | null;
  reuseExistingDecision?: boolean;
  persistDecision?: boolean;
}): Promise<MeetingOverseerExtractDecision | null> {
  const reuseExistingDecision = opts.reuseExistingDecision !== false;
  const shouldPersistDecision = opts.persistDecision !== false;
  const messageId = (opts.messageId || "").trim();
  if (messageId && reuseExistingDecision) {
    const existing = await loadExistingDecision(messageId, "extract");
    if (
      existing &&
      typeof existing === "object" &&
      "intent_to_book" in existing &&
      "qualification_status" in existing &&
      "time_from_body_only" in existing
    ) {
      const existingDecision = existing as MeetingOverseerExtractDecision & { detected_timezone?: unknown };
      return attachDecisionContractV1(
        {
        ...existingDecision,
        detected_timezone: normalizeDetectedTimezone(existingDecision.detected_timezone),
        needs_pricing_answer: normalizeDecisionBoolean((existingDecision as { needs_pricing_answer?: unknown }).needs_pricing_answer),
        needs_community_details: normalizeDecisionBoolean((existingDecision as { needs_community_details?: unknown }).needs_community_details),
        }
      );
    }
  }

  const offeredSlotsContext = opts.offeredSlots
    .map((slot, idx) => `${idx + 1}. ${slot.label} (${slot.datetime})`)
    .join("\n") || "None.";
  const qualificationContext = (opts.qualificationContext || "").trim() || "None.";
  const conversationContext = (opts.conversationContext || "").trim() || "None.";
  const businessContext = (opts.businessContext || "").trim() || "None.";
  const leadTimezoneHint = isValidIanaTimezone((opts.leadTimezone || "").trim())
    ? (opts.leadTimezone || "").trim()
    : "None.";

  const promptKey = "meeting.overseer.extract.v2";

  const result = await runStructuredJsonPrompt<MeetingOverseerExtractDecision>({
    pattern: "structured_json",
    clientId: opts.clientId,
    leadId: opts.leadId,
    featureId: "meeting.overseer.extract",
    promptKey,
    model: "gpt-5.2",
    reasoningEffort: "low",
    temperature: 0,
    systemFallback: `You are a scheduling overseer. Determine whether the inbound message is about scheduling, and extract timing preferences.

Offered slots (if any):
{{offeredSlots}}

Qualification context:
{{qualificationContext}}

Business context:
{{businessContext}}

Conversation context (recent thread summary):
{{conversationContext}}

Known lead timezone hint (if available):
{{leadTimezoneHint}}

Rules:
- If NOT scheduling-related, set is_scheduling_related=false, intent="other", acceptance_specificity="none", needs_clarification=false.
- intent:
  - accept_offer: they accept one of the offered slots or confirm a proposed time.
  - request_times: they ask for availability or meeting options.
  - propose_time: they propose a time/date not explicitly tied to offered slots.
  - reschedule: they want to move an already scheduled time.
  - decline: they explicitly say no meeting (e.g., "not interested", "no thanks", "stop", "cancel").
- acceptance_specificity:
  - specific: clear selection of a specific offered slot or exact time.
  - day_only: they mention a day (e.g., "Thursday works") without a time.
  - generic: standalone scheduling acknowledgement with no time (e.g., "yes", "sounds good", "that works") in response to offered slots.
  - none: no acceptance detected.
- Do NOT set acceptance_specificity="generic" for:
  - Non-scheduling replies ("Thanks", "I'll review this", "Send details")
  - Requests for more information ("Can you send details?")
  - Long messages that are not clearly accepting a meeting time
- If they mention a weekday, set preferred_day_of_week to one of: mon, tue, wed, thu, fri, sat, sun.
- If they mention "morning", "afternoon", or "evening", set preferred_time_of_day accordingly.
- If they say a day-only acceptance ("Thursday works"), use acceptance_specificity="day_only" and set preferred_day_of_week.
- If offered slots are "None." and they give a weekday-only preference ("Thursday works"), set intent="propose_time" and acceptance_specificity="day_only".
- If they mention "later this week", "next week", or "sometime" without a specific day/time, set needs_clarification=true.
- If they mention relative timing ("later this week", "next week", "tomorrow"), set relative_preference + relative_preference_detail to the exact phrase.
- accepted_slot_index is 1-based and should ONLY be set when you are confident it matches the offered slots list. Otherwise null.
- intent_to_book:
  - true when the lead is clearly trying to schedule/confirm a meeting time now.
  - false when they are not trying to schedule now (even if scheduling is discussed generally).
- qualification_status must be one of: qualified, unqualified, unknown.
  - Use qualification context first, then conversation context.
  - If evidence is insufficient or conflicting, return unknown.
  - Add concise supporting quotes to qualification_evidence.
- time_from_body_only:
  - true only if timing details come from the inbound message body itself.
  - false when timing appears to come from signature/footer/contact lines or cannot be grounded.
- detected_timezone:
  - return a valid IANA timezone when the message includes explicit timezone/location scheduling signal (e.g., "PST", "Miami", "Dubai").
  - if message text is ambiguous but a valid lead timezone hint is provided, use that hint.
  - otherwise return null.
- confidence fields (intent_confidence, qualification_confidence, time_extraction_confidence) must be 0..1.
- needs_pricing_answer:
  - true only when the lead explicitly asks about cost/price/pricing/fees/billing/cadence for the offer.
  - false for qualification-only mentions (for example "$1M annual revenue" or growth metrics) when they are not asking for membership pricing.
- needs_community_details:
  - true when the lead explicitly asks what is included, benefits, how the community works, or similar details.
  - false otherwise.
- If the message is ambiguous about scheduling intent, prefer is_scheduling_related=false and intent="other" (fail closed).
- Do NOT invent dates or times. Use only the message and offered slots list.
- Provide short evidence quotes from the message.

Output JSON only.`,
    input: opts.messageText,
    templateVars: {
      offeredSlots: offeredSlotsContext,
      qualificationContext,
      conversationContext,
      businessContext,
      leadTimezoneHint,
    },
    schemaName: "meeting_overseer_extract_v2",
    strict: true,
    schema: MEETING_OVERSEER_EXTRACT_SCHEMA,
    budget: {
      min: 900,
      max: 1400,
      retryMax: 1800,
      overheadTokens: 128,
      outputScale: 0.2,
      preferApiCount: true,
    },
  });

  if (!result.success) return null;

  const decision = result.data;
  decision.confidence = clamp01(decision.confidence);
  decision.intent_confidence = clamp01(decision.intent_confidence);
  decision.qualification_confidence = clamp01(decision.qualification_confidence);
  decision.time_extraction_confidence = clamp01(decision.time_extraction_confidence);
  decision.preferred_day_of_week = normalizeDayToken(decision.preferred_day_of_week);
  decision.preferred_time_of_day = normalizeTimeOfDay(decision.preferred_time_of_day);
  decision.relative_preference = normalizeRelativePreference(decision.relative_preference);
  decision.qualification_status = normalizeQualificationStatus(decision.qualification_status);
  decision.detected_timezone = normalizeDetectedTimezone(decision.detected_timezone);
  decision.needs_pricing_answer = normalizeDecisionBoolean(decision.needs_pricing_answer);
  decision.needs_community_details = normalizeDecisionBoolean(decision.needs_community_details);
  if (!decision.detected_timezone) {
    const knownLeadTimezone = (opts.leadTimezone || "").trim();
    if (isValidIanaTimezone(knownLeadTimezone)) {
      decision.detected_timezone = knownLeadTimezone;
    }
  }
  if (!Number.isFinite(decision.accepted_slot_index ?? NaN)) {
    decision.accepted_slot_index = null;
  }

  const decisionWithContract = attachDecisionContractV1(decision);

  if (messageId && shouldPersistDecision) {
    await persistDecision({
      messageId,
      leadId: opts.leadId,
      clientId: opts.clientId,
      stage: "extract",
      promptKey,
      model: result.telemetry.model,
      confidence: decisionWithContract.confidence,
      payload: decisionWithContract,
    });
  }

  return decisionWithContract;
}

export async function runMeetingOverseerGateDecision(opts: {
  clientId: string;
  leadId: string;
  messageId?: string | null;
  channel: "sms" | "email" | "linkedin";
  latestInbound: string;
  draft: string;
  availability: string[];
  bookingLink: string | null;
  extraction: MeetingOverseerExtractDecision | null;
  memoryContext?: string | null;
  serviceDescription?: string | null;
  knowledgeContext?: string | null;
  metadata?: unknown;
  leadSchedulerLink: string | null;
  timeoutMs: number;
  reuseExistingDecision?: boolean;
  persistDecision?: boolean;
}): Promise<MeetingOverseerGateResult> {
  const reuseExistingDecision = opts.reuseExistingDecision !== false;
  const shouldPersistDecision = opts.persistDecision !== false;
  const messageId = (opts.messageId || "").trim();
  if (messageId && reuseExistingDecision) {
    const existing = await loadExistingDecision(messageId, "gate");
    if (existing && typeof existing === "object") {
      const decision = existing as MeetingOverseerGateDecision;
      return {
        finalDraft: decision.decision === "revise" && decision.final_draft ? decision.final_draft : null,
        decision,
        fromCache: true,
      };
    }
  }

  const promptKey = "meeting.overseer.gate.v1";
  const availability = opts.availability.length ? opts.availability.map((s) => `- ${s}`).join("\n") : "None.";
  const extractionJson = opts.extraction ? JSON.stringify(opts.extraction, null, 2) : "None.";
  const bookingLink = (opts.bookingLink || "").trim() || "None.";
  const leadSchedulerLink = (opts.leadSchedulerLink || "").trim() || "None.";
  const memoryContext = (opts.memoryContext || "").trim() || "None.";
  const serviceDescription = (opts.serviceDescription || "").trim() || "None.";
  const knowledgeContext = (opts.knowledgeContext || "").trim() || "None.";

  const verifierModel = coerceEmailDraftVerificationModel(
    (
      await prisma.workspaceSettings.findUnique({
        where: { clientId: opts.clientId },
        select: { emailDraftVerificationModel: true },
      })
    )?.emailDraftVerificationModel || null
  );

  const result = await runStructuredJsonPrompt<MeetingOverseerGateDecision>({
    pattern: "structured_json",
    clientId: opts.clientId,
    leadId: opts.leadId,
    featureId: "meeting.overseer.gate",
    promptKey,
    metadata: opts.metadata,
    model: verifierModel,
    reasoningEffort: "low",
    temperature: 0,
    systemFallback: `You are a scheduling overseer reviewing a drafted reply. Decide whether to approve or revise it.

INPUTS
Channel: {{channel}}
Latest inbound:
{{latestInbound}}

Draft reply:
{{draft}}

Overseer extraction:
{{extraction}}

Availability (if any):
{{availability}}

Booking link:
{{bookingLink}}

Lead scheduler link (if provided):
{{leadSchedulerLink}}

Memory context (if any):
{{memoryContext}}

Service description:
{{serviceDescription}}

Knowledge context:
{{knowledgeContext}}

RULES
- If the lead accepted a time, keep the reply short and acknowledgment-only. Do NOT ask new questions.
- Never imply a meeting is booked unless either:
  - the lead explicitly confirmed/accepted a time, or
  - extraction.decision_contract_v1.shouldBookNow is "yes" and the selected slot comes directly from provided availability.
- If extraction.needs_clarification is true, ask ONE concise clarifying question.
- Exception: if leadSchedulerLink is provided and the latest inbound explicitly instructs you to use their scheduler link (e.g., "use my Calendly", "book via my link"), you may approve an acknowledgement-only reply that confirms you'll use their scheduler and send a confirmation. Do NOT require a clarifying question solely because extraction.needs_clarification is true.
- If extraction.decision_contract_v1.shouldBookNow is "yes":
  - Keep the reply booking-first and concise.
  - Do NOT add new qualification questions.
  - Do NOT add extra selling/community/pitch content.
- If the lead already confirmed qualification thresholds in the latest inbound, do NOT ask repeat qualification questions.
- When extraction.decision_contract_v1.needsPricingAnswer is "yes", the draft must answer pricing directly using only provided context (no invented numbers or cadence).
- Never introduce numeric pricing unless that amount and cadence are explicitly supported by service description or knowledge context.
- If a price amount is uncertain/unsupported, ask one concise pricing clarifier instead of guessing.
- If the lead asked explicit questions (pricing, frequency, location, scheduling), ensure each explicit question is answered before extra context.
- If extraction.decision_contract_v1.shouldBookNow is "yes" and the lead provided a day/window preference (for example, "Friday between 12-3"), choose exactly ONE best-matching slot from availability (verbatim) and send a concise booked-confirmation style reply. Do not add fallback options or extra selling content.
- If the lead requests times and availability is provided (without a day/window constraint), offer exactly 2 options (verbatim) and ask which works.
- If availability is not provided, ask for their preferred windows.
- If the lead provided their own scheduling link, do NOT offer our times or our booking link; acknowledge their link.
- If extraction.decision_contract_v1.needsPricingAnswer is "no", avoid introducing pricing details not explicitly requested.
- When times are offered and extraction.detected_timezone exists, keep displayed options in that timezone context only.
- Do not request revision solely for first-person voice ("I") or a personal sign-off if the message is otherwise compliant.
- If the draft already complies, decision="approve" and final_draft=null.
- Respect channel formatting:
  - sms: 1-2 short sentences, <= 3 parts of 160 chars max, no markdown.
  - linkedin: plain text, 1-3 short paragraphs.
  - email: no subject line, plain text, no markdown styling.

OUTPUT JSON ONLY.`,
    input: "Review the draft and decide if changes are needed.",
    templateVars: {
      channel: opts.channel,
      latestInbound: opts.latestInbound || "None.",
      draft: opts.draft || "None.",
      extraction: extractionJson,
      availability,
      bookingLink,
      memoryContext,
      leadSchedulerLink,
      serviceDescription,
      knowledgeContext,
    },
    schemaName: "meeting_overseer_gate",
    strict: true,
    schema: MEETING_OVERSEER_GATE_SCHEMA,
    budget: {
      min: 1200,
      max: 2000,
      retryMax: 2600,
      overheadTokens: 192,
      outputScale: 0.25,
      preferApiCount: true,
    },
    timeoutMs: Math.max(5000, opts.timeoutMs),
  });

  if (!result.success) {
    return {
      finalDraft: null,
      decision: null,
      fromCache: false,
    };
  }

  const decision = result.data;
  decision.confidence = clamp01(decision.confidence);

  if (messageId && shouldPersistDecision) {
    await persistDecision({
      messageId,
      leadId: opts.leadId,
      clientId: opts.clientId,
      stage: "gate",
      promptKey,
      model: result.telemetry.model,
      confidence: decision.confidence,
      payload: decision,
    });
  }

  return {
    finalDraft: decision.decision === "revise" && decision.final_draft ? decision.final_draft.trim() || null : null,
    decision,
    fromCache: false,
  };
}

export async function runMeetingOverseerGate(opts: {
  clientId: string;
  leadId: string;
  messageId?: string | null;
  channel: "sms" | "email" | "linkedin";
  latestInbound: string;
  draft: string;
  availability: string[];
  bookingLink: string | null;
  extraction: MeetingOverseerExtractDecision | null;
  memoryContext?: string | null;
  serviceDescription?: string | null;
  knowledgeContext?: string | null;
  metadata?: unknown;
  leadSchedulerLink: string | null;
  timeoutMs: number;
  reuseExistingDecision?: boolean;
  persistDecision?: boolean;
}): Promise<string | null> {
  const result = await runMeetingOverseerGateDecision(opts);
  return result.finalDraft;
}
