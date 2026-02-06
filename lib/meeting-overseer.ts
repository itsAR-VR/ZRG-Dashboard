import "server-only";

import { prisma } from "@/lib/prisma";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
import { coerceEmailDraftVerificationModel } from "@/lib/ai-drafts/config";
import type { OfferedSlot } from "@/lib/booking";

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
  acceptance_specificity: "specific" | "day_only" | "generic" | "none";
  accepted_slot_index: number | null;
  preferred_day_of_week: string | null;
  preferred_time_of_day: string | null;
  relative_preference: string | null;
  relative_preference_detail: string | null;
  needs_clarification: boolean;
  clarification_reason: string | null;
  confidence: number;
  evidence: string[];
};

export type MeetingOverseerGateDecision = {
  decision: "approve" | "revise";
  final_draft: string | null;
  confidence: number;
  issues: string[];
  rationale: string;
};

const MEETING_OVERSEER_EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    is_scheduling_related: { type: "boolean" },
    intent: { type: "string" },
    acceptance_specificity: { type: "string" },
    accepted_slot_index: { type: ["number", "null"] },
    preferred_day_of_week: { type: ["string", "null"] },
    preferred_time_of_day: { type: ["string", "null"] },
    relative_preference: { type: ["string", "null"] },
    relative_preference_detail: { type: ["string", "null"] },
    needs_clarification: { type: "boolean" },
    clarification_reason: { type: ["string", "null"] },
    confidence: { type: "number" },
    evidence: { type: "array", items: { type: "string" } },
  },
  required: [
    "is_scheduling_related",
    "intent",
    "acceptance_specificity",
    "accepted_slot_index",
    "preferred_day_of_week",
    "preferred_time_of_day",
    "relative_preference",
    "relative_preference_detail",
    "needs_clarification",
    "clarification_reason",
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

export function shouldRunMeetingOverseer(opts: {
  messageText: string;
  sentimentTag?: string | null;
  offeredSlotsCount?: number;
}): boolean {
  const message = (opts.messageText || "").toLowerCase();
  if (!message) return false;
  if (typeof opts.offeredSlotsCount === "number" && opts.offeredSlotsCount > 0) return true;
  if (opts.sentimentTag && ["Meeting Requested", "Call Requested", "Meeting Booked"].includes(opts.sentimentTag)) return true;
  return SCHEDULING_KEYWORDS.some((keyword) => message.includes(keyword));
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
  return loadExistingDecision(messageId, stage);
}

export async function runMeetingOverseerExtraction(opts: {
  clientId: string;
  leadId: string;
  messageId?: string | null;
  messageText: string;
  offeredSlots: OfferedSlot[];
}): Promise<MeetingOverseerExtractDecision | null> {
  const messageId = (opts.messageId || "").trim();
  if (messageId) {
    const existing = await loadExistingDecision(messageId, "extract");
    if (existing && typeof existing === "object") {
      return existing as MeetingOverseerExtractDecision;
    }
  }

  const offeredSlotsContext = opts.offeredSlots
    .map((slot, idx) => `${idx + 1}. ${slot.label} (${slot.datetime})`)
    .join("\n") || "None.";

  const promptKey = "meeting.overseer.extract.v1";

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

Rules:
- If NOT scheduling-related, set is_scheduling_related=false, intent="other", acceptance_specificity="none", needs_clarification=false.
- intent:
  - accept_offer: they accept one of the offered slots or confirm a proposed time.
  - request_times: they ask for availability or meeting options.
  - propose_time: they propose a time/date not explicitly tied to offered slots.
  - reschedule: they want to move an already scheduled time.
  - decline: they explicitly say no meeting.
- acceptance_specificity:
  - specific: clear selection of a specific offered slot or exact time.
  - day_only: they mention a day (e.g., "Thursday works") without a time.
  - generic: "yes", "sounds good", "works" with no time.
  - none: no acceptance detected.
- If they mention a weekday, set preferred_day_of_week to one of: mon, tue, wed, thu, fri, sat, sun.
- If they mention "morning", "afternoon", or "evening", set preferred_time_of_day accordingly.
- If they say a day-only acceptance ("Thursday works"), use acceptance_specificity="day_only" and set preferred_day_of_week.
- If they mention "later this week", "next week", or "sometime" without a specific day/time, set needs_clarification=true.
- If they mention relative timing ("later this week", "next week", "tomorrow"), set relative_preference + relative_preference_detail to the exact phrase.
- accepted_slot_index is 1-based and should ONLY be set when you are confident it matches the offered slots list. Otherwise null.
- Do NOT invent dates or times. Use only the message and offered slots list.
- Provide short evidence quotes from the message.

Output JSON only.`,
    input: opts.messageText,
    templateVars: { offeredSlots: offeredSlotsContext },
    schemaName: "meeting_overseer_extract",
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
  decision.preferred_day_of_week = normalizeDayToken(decision.preferred_day_of_week);
  decision.preferred_time_of_day = normalizeTimeOfDay(decision.preferred_time_of_day);
  decision.relative_preference = normalizeRelativePreference(decision.relative_preference);
  if (!Number.isFinite(decision.accepted_slot_index ?? NaN)) {
    decision.accepted_slot_index = null;
  }

  if (messageId) {
    await persistDecision({
      messageId,
      leadId: opts.leadId,
      clientId: opts.clientId,
      stage: "extract",
      promptKey,
      model: result.telemetry.model,
      confidence: decision.confidence,
      payload: decision,
    });
  }

  return decision;
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
  metadata?: unknown;
  leadSchedulerLink: string | null;
  timeoutMs: number;
}): Promise<string | null> {
  const messageId = (opts.messageId || "").trim();
  if (messageId) {
    const existing = await loadExistingDecision(messageId, "gate");
    if (existing && typeof existing === "object") {
      const decision = existing as MeetingOverseerGateDecision;
      if (decision.decision === "revise" && decision.final_draft) return decision.final_draft;
      return null;
    }
  }

  const promptKey = "meeting.overseer.gate.v1";
  const availability = opts.availability.length ? opts.availability.map((s) => `- ${s}`).join("\n") : "None.";
  const extractionJson = opts.extraction ? JSON.stringify(opts.extraction, null, 2) : "None.";
  const bookingLink = (opts.bookingLink || "").trim() || "None.";
  const leadSchedulerLink = (opts.leadSchedulerLink || "").trim() || "None.";
  const memoryContext = (opts.memoryContext || "").trim() || "None.";

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

RULES
- If the lead accepted a time, keep the reply short and acknowledgment-only. Do NOT ask new questions.
- Never imply a meeting is booked unless the lead explicitly confirmed a time or says they booked/accepted an invite.
- If extraction.needs_clarification is true, ask ONE concise clarifying question.
- If the lead requests times and availability is provided, offer exactly 2 options (verbatim) and ask which works.
- If availability is not provided, ask for their preferred windows.
- If the lead provided their own scheduling link, do NOT offer our times or our booking link; acknowledge their link.
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

  if (!result.success) return null;

  const decision = result.data;
  decision.confidence = clamp01(decision.confidence);

  if (messageId) {
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

  if (decision.decision === "revise" && decision.final_draft) {
    return decision.final_draft.trim() || null;
  }

  return null;
}
