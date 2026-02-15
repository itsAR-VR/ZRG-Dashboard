import { coerceEmailDraftVerificationModel } from "@/lib/ai-drafts/config";
import { getPromptWithOverrides } from "@/lib/ai/prompt-registry";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
import type { OfferedSlot } from "@/lib/booking";
import { runMeetingOverseerExtraction, type MeetingOverseerExtractDecision } from "@/lib/meeting-overseer";
import { prisma } from "@/lib/prisma";
import { estimateTokensFromText } from "@/lib/ai/token-estimate";
import type { ReplayJudgeInput, ReplayJudgeProfile, ReplayJudgeScore } from "@/lib/ai-replay/types";

export const REPLAY_JUDGE_PROMPT_KEY = "meeting.overseer.gate.v1";

const MEETING_OVERSEER_GATE_SYSTEM_FALLBACK = `You are a scheduling overseer reviewing a drafted reply. Decide whether to approve or revise it.

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
- If the lead explicitly states an exact time (e.g., "Tue Feb 17 10am PST"), do NOT counter with a different time from availability. Acknowledge/confirm their exact stated time (do not convert time zones).
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
- Do not fail solely because exact scripted phrasing from playbooks/knowledge assets is not verbatim. If meaning, safety, and factual constraints are satisfied, approve.
- If the draft already complies, decision="approve" and final_draft=null.
- Respect channel formatting:
  - sms: 1-2 short sentences, <= 3 parts of 160 chars max, no markdown.
  - linkedin: plain text, 1-3 short paragraphs.
  - email: no subject line, plain text, no markdown styling.

OUTPUT JSON ONLY.`;

type OverseerGateJudgeOutput = {
  decision: "approve" | "revise";
  final_draft: string | null;
  confidence: number;
  issues: string[];
  rationale: string;
};

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function envFloat(name: string, fallback: number): number {
  const parsed = Number.parseFloat(process.env[name] || "");
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const OVERSEER_JUDGE_BUDGET_BASE = {
  min: envInt("AI_REPLAY_JUDGE_BUDGET_MIN", 1200),
  max: envInt("AI_REPLAY_JUDGE_BUDGET_MAX", 28000),
  retryMax: envInt("AI_REPLAY_JUDGE_BUDGET_RETRY_MAX", 56000),
  retryExtraTokens: envInt("AI_REPLAY_JUDGE_BUDGET_RETRY_EXTRA", 8000),
  overheadTokens: envInt("AI_REPLAY_JUDGE_BUDGET_OVERHEAD", 1400),
  outputScale: envFloat("AI_REPLAY_JUDGE_BUDGET_OUTPUT_SCALE", 2.8),
  preferApiCount: true,
} as const;

const OVERSEER_JUDGE_MAX_ATTEMPTS = envInt("AI_REPLAY_JUDGE_MAX_ATTEMPTS", 4);
const OVERSEER_JUDGE_RETRY_MULTIPLIER = envFloat("AI_REPLAY_JUDGE_RETRY_MULTIPLIER", 1.45);

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function clip(text: string, maxChars: number): string {
  const trimmed = (text || "").trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n...[truncated]`;
}

function buildAvailability(slots: OfferedSlot[]): string[] {
  if (!Array.isArray(slots)) return [];
  return slots
    .map((slot) => {
      const label = (slot?.label || "").trim();
      const datetime = (slot?.datetime || "").trim();
      if (label && datetime) return `${label} (${datetime})`;
      return label || datetime || "";
    })
    .filter(Boolean)
    .slice(0, 5);
}

function buildMemoryContext(input: ReplayJudgeInput): string | null {
  const blocks: string[] = [];
  if ((input.inboundSentAt || "").trim()) {
    blocks.push(`Inbound sent at (UTC): ${input.inboundSentAt}`);
  }
  if ((input.conversationTranscript || "").trim()) {
    blocks.push(`Conversation transcript:\n${clip(input.conversationTranscript, 6000)}`);
  }
  if (input.observedNextOutbound) {
    blocks.push(
      [
        "Observed next outbound:",
        input.observedNextOutbound.subject ? `Subject: ${input.observedNextOutbound.subject}` : "Subject: (none)",
        `Body: ${clip(input.observedNextOutbound.body || "", 1200)}`,
        `SentAt: ${input.observedNextOutbound.sentAt}`,
      ].join("\n")
    );
  }
  if (Array.isArray(input.historicalReplyExamples) && input.historicalReplyExamples.length > 0) {
    const examples = input.historicalReplyExamples
      .slice(0, 3)
      .map((example, idx) => {
        const subject = example.subject ? `Subject: ${example.subject}` : "Subject: (none)";
        return `Example ${idx + 1}\n${subject}\nBody: ${clip(example.body || "", 800)}\nSentiment: ${example.leadSentiment || "unknown"}`;
      })
      .join("\n\n");
    blocks.push(`Historical outbound examples:\n${examples}`);
  }

  const joined = blocks.join("\n\n---\n\n").trim();
  return joined ? clip(joined, 18000) : null;
}

function estimateJudgeInputTokens(input: {
  latestInbound: string;
  draft: string;
  extraction: MeetingOverseerExtractDecision | null;
  availability: string[];
  bookingLink: string | null;
  leadSchedulerLink: string | null;
  memoryContext: string | null;
}): number {
  try {
    return estimateTokensFromText(JSON.stringify(input));
  } catch {
    return 0;
  }
}

function computeOverseerJudgeBudget(input: {
  latestInbound: string;
  draft: string;
  extraction: MeetingOverseerExtractDecision | null;
  availability: string[];
  bookingLink: string | null;
  leadSchedulerLink: string | null;
  memoryContext: string | null;
}) {
  const estimatedInputTokens = estimateJudgeInputTokens(input);
  const dynamicMin = Math.ceil(estimatedInputTokens * 0.35) + OVERSEER_JUDGE_BUDGET_BASE.overheadTokens;
  const dynamicMax = Math.ceil(estimatedInputTokens * 0.9) + OVERSEER_JUDGE_BUDGET_BASE.overheadTokens * 2;

  return {
    min: Math.max(OVERSEER_JUDGE_BUDGET_BASE.min, dynamicMin),
    max: Math.max(OVERSEER_JUDGE_BUDGET_BASE.max, dynamicMax),
    retryMax: OVERSEER_JUDGE_BUDGET_BASE.retryMax,
    retryExtraTokens: OVERSEER_JUDGE_BUDGET_BASE.retryExtraTokens,
    overheadTokens: OVERSEER_JUDGE_BUDGET_BASE.overheadTokens,
    outputScale: OVERSEER_JUDGE_BUDGET_BASE.outputScale,
    preferApiCount: OVERSEER_JUDGE_BUDGET_BASE.preferApiCount,
    estimatedInputTokens,
  };
}

function deriveDimensionScores(pass: boolean, issues: string[]): ReplayJudgeScore["dimensions"] {
  const defaults = pass
    ? {
        pricingCadenceAccuracy: 92,
        factualAlignment: 92,
        safetyAndPolicy: 92,
        responseQuality: 92,
      }
    : {
        pricingCadenceAccuracy: 60,
        factualAlignment: 60,
        safetyAndPolicy: 60,
        responseQuality: 60,
      };

  for (const raw of issues || []) {
    const issue = (raw || "").toLowerCase();
    if (!issue) continue;

    if (/(pricing|price|cadence|monthly|annual|quarterly|billing)/.test(issue)) {
      defaults.pricingCadenceAccuracy = Math.max(15, defaults.pricingCadenceAccuracy - 25);
    }
    if (/(hallucinat|invent|mismatch|incorrect|timezone|time window|conflict|factual)/.test(issue)) {
      defaults.factualAlignment = Math.max(15, defaults.factualAlignment - 25);
    }
    if (/(opt-out|unsubscribe|unsafe|policy|sensitive|compliance|booked)/.test(issue)) {
      defaults.safetyAndPolicy = Math.max(15, defaults.safetyAndPolicy - 25);
    }
    if (/(tone|clarity|length|verbose|format)/.test(issue)) {
      defaults.responseQuality = Math.max(15, defaults.responseQuality - 20);
    }
  }

  return defaults;
}

function computeOverallScore(dims: ReplayJudgeScore["dimensions"]): number {
  return Math.round(
    (dims.pricingCadenceAccuracy + dims.factualAlignment + dims.safetyAndPolicy + dims.responseQuality) / 4
  );
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return Math.round(value);
}

function defaultThresholdForProfile(profile: ReplayJudgeProfile): number {
  if (profile === "strict") return 72;
  if (profile === "lenient") return 52;
  return 62;
}

function validateOverseerOutput(value: unknown): OverseerGateJudgeOutput {
  if (!value || typeof value !== "object") {
    throw new Error("overseer judge payload must be an object");
  }

  const record = value as Record<string, unknown>;
  const decision = record.decision === "approve" || record.decision === "revise" ? record.decision : null;
  if (!decision) throw new Error("decision must be approve|revise");

  const confidence = clamp01(Number(record.confidence));
  const finalDraft = typeof record.final_draft === "string" ? record.final_draft.trim() : null;
  const rationale = typeof record.rationale === "string" ? record.rationale.trim() : "";
  const issues = Array.isArray(record.issues)
    ? record.issues.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean)
    : [];

  return {
    decision,
    final_draft: finalDraft,
    confidence,
    issues,
    rationale,
  };
}

export function getReplayJudgeSystemPrompt(): string {
  return MEETING_OVERSEER_GATE_SYSTEM_FALLBACK;
}

export async function resolveReplayJudgeSystemPrompt(clientId: string | null | undefined): Promise<string> {
  const scopedClientId = (clientId || "").trim();
  if (!scopedClientId) return MEETING_OVERSEER_GATE_SYSTEM_FALLBACK;

  try {
    const resolved = await getPromptWithOverrides(REPLAY_JUDGE_PROMPT_KEY, scopedClientId);
    const systemMessage = resolved?.template?.messages
      ?.find((message: { role: string; content: string }) => message.role === "system")
      ?.content?.trim();
    if (systemMessage) return systemMessage;
  } catch {
    // ignore and use fallback
  }

  return MEETING_OVERSEER_GATE_SYSTEM_FALLBACK;
}

export async function runReplayJudge(opts: {
  clientId: string;
  judgeClientId?: string | null;
  leadId: string;
  model: string;
  judgeProfile?: ReplayJudgeProfile;
  judgeThreshold?: number;
  adjudicationBand?: {
    min: number;
    max: number;
  };
  adjudicateBorderline?: boolean;
  input: ReplayJudgeInput;
  offeredSlots: OfferedSlot[];
  bookingLink: string | null;
  leadSchedulerLink: string | null;
  extractionOverride?: MeetingOverseerExtractDecision | null;
  source: string;
  metadata?: unknown;
}): Promise<ReplayJudgeScore> {
  const effectiveClientId = (opts.judgeClientId || opts.clientId || "").trim() || opts.clientId;
  const judgeProfile = opts.judgeProfile || "balanced";
  const judgeThreshold = clampScore(
    typeof opts.judgeThreshold === "number" && Number.isFinite(opts.judgeThreshold)
      ? opts.judgeThreshold
      : defaultThresholdForProfile(judgeProfile)
  );
  const adjudicationBand = {
    min: clampScore(opts.adjudicationBand?.min ?? 40),
    max: clampScore(opts.adjudicationBand?.max ?? 80),
  };
  if (adjudicationBand.min > adjudicationBand.max) {
    adjudicationBand.min = adjudicationBand.max;
  }
  const adjudicateBorderline = opts.adjudicateBorderline !== false;
  const memoryContext = buildMemoryContext(opts.input);
  const availability = buildAvailability(opts.offeredSlots);
  const latestInboundWithSubject = [
    opts.input.inboundSubject ? `Subject: ${opts.input.inboundSubject}` : "",
    opts.input.inboundBody || "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  let leadTimezone: string | null = null;
  try {
    leadTimezone =
      (
        await prisma.lead.findUnique({
          where: { id: opts.leadId },
          select: { timezone: true },
        })
      )?.timezone || null;
  } catch {
    // Best-effort only; replay judge should still run without DB timezone.
  }

  const extraction =
    opts.extractionOverride ??
    (await runMeetingOverseerExtraction({
      clientId: opts.clientId,
      leadId: opts.leadId,
      messageText: latestInboundWithSubject || opts.input.inboundBody,
      leadTimezone,
      referenceDate: opts.input.inboundSentAt || null,
      offeredSlots: opts.offeredSlots,
      qualificationContext: `Lead sentiment: ${opts.input.leadSentiment || "unknown"}`,
      conversationContext: clip(opts.input.conversationTranscript || "", 7000),
      businessContext: [opts.input.companyName, opts.input.serviceDescription, opts.input.targetResult].filter(Boolean).join(" | "),
    }));

  const promptPayload = {
    latestInbound: latestInboundWithSubject || opts.input.inboundBody || "",
    draft: opts.input.generatedDraft || "",
    extraction,
    availability,
    bookingLink: opts.bookingLink,
    leadSchedulerLink: opts.leadSchedulerLink,
    memoryContext,
  };

  const budget = computeOverseerJudgeBudget(promptPayload);
  const workspaceModel = (
    await prisma.workspaceSettings.findUnique({
      where: { clientId: effectiveClientId },
      select: { emailDraftVerificationModel: true },
    })
  )?.emailDraftVerificationModel;
  const model = coerceEmailDraftVerificationModel(workspaceModel || opts.model || null);

  const runGate = async (mode: "primary" | "adjudicator") =>
    runStructuredJsonPrompt<OverseerGateJudgeOutput>({
    pattern: "structured_json",
    promptKey: REPLAY_JUDGE_PROMPT_KEY,
    featureId: "ai.replay.judge",
    clientId: effectiveClientId,
    leadId: opts.leadId,
    source: opts.source,
    metadata: {
      ...(opts.metadata && typeof opts.metadata === "object" ? (opts.metadata as Record<string, unknown>) : {}),
      judgeClientId: effectiveClientId,
      judgeEstimatedInputTokens: budget.estimatedInputTokens,
      judgeBudgetMin: budget.min,
      judgeBudgetMax: budget.max,
      judgeMode: mode === "adjudicator" ? "meeting_overseer_gate_adjudicator" : "meeting_overseer_gate",
    },
    model,
    reasoningEffort: "low",
    temperature: 0,
    maxAttempts: OVERSEER_JUDGE_MAX_ATTEMPTS,
    retryOutputTokensMultiplier: OVERSEER_JUDGE_RETRY_MULTIPLIER,
    systemFallback: MEETING_OVERSEER_GATE_SYSTEM_FALLBACK,
    input:
      mode === "adjudicator"
        ? "Second-pass adjudication: independently review borderline prior judgment and return the best grounded decision."
        : "Review the draft and decide if changes are needed.",
    templateVars: {
      channel: opts.input.channel,
      latestInbound: latestInboundWithSubject || opts.input.inboundBody || "None.",
      draft: opts.input.generatedDraft || "None.",
      extraction: extraction ? JSON.stringify(extraction, null, 2) : "None.",
      availability: availability.length > 0 ? availability.map((slot) => `- ${slot}`).join("\n") : "None.",
      bookingLink: (opts.bookingLink || "").trim() || "None.",
      leadSchedulerLink: (opts.leadSchedulerLink || "").trim() || "None.",
      memoryContext: memoryContext || "None.",
      serviceDescription: (opts.input.serviceDescription || "").trim() || "None.",
      knowledgeContext: (opts.input.knowledgeContext || "").trim() || "None.",
    },
    schemaName: "meeting_overseer_gate",
    strict: true,
    schema: {
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
    },
    budget,
    validate: (value: unknown) => {
      try {
        return { success: true, data: validateOverseerOutput(value) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Invalid overseer judge output" };
      }
    },
  });

  const primaryResult = await runGate("primary");
  if (!primaryResult.success) {
    throw new Error(`[Replay Overseer Judge] ${primaryResult.error.message}`);
  }
  const primary = primaryResult.data;
  const primaryDimensions = deriveDimensionScores(primary.decision === "approve", primary.issues);
  const primaryScore = computeOverallScore(primaryDimensions);
  const primaryPass = primary.decision === "approve" || primaryScore >= judgeThreshold;

  let finalDimensions = primaryDimensions;
  let llmOverallScore = primaryScore;
  let llmConfidence = clamp01(primary.confidence);
  let llmPass = primaryPass;
  let llmIssues = primaryPass ? [] : primary.issues;
  let llmSummary = primary.rationale || (primaryPass ? "Overseer approved draft." : "Overseer requested revision.");
  let llmSuggestedFixes = primary.final_draft
    ? ["Apply overseer-revised draft output.", clip(primary.final_draft, 800)]
    : primary.issues.slice(0, 5);

  const isBorderline = llmOverallScore >= adjudicationBand.min && llmOverallScore <= adjudicationBand.max;
  let adjudicated = false;
  if (adjudicateBorderline && isBorderline) {
    const adjudicatorResult = await runGate("adjudicator");
    if (adjudicatorResult.success) {
      const adjudicator = adjudicatorResult.data;
      const adjudicatorDimensions = deriveDimensionScores(adjudicator.decision === "approve", adjudicator.issues);
      const adjudicatorScore = computeOverallScore(adjudicatorDimensions);
      const adjudicatorPass = adjudicator.decision === "approve" || adjudicatorScore >= judgeThreshold;
      const combinedIssues = Array.from(new Set([...(primary.issues || []), ...(adjudicator.issues || [])]));
      finalDimensions = {
        pricingCadenceAccuracy: clampScore((primaryDimensions.pricingCadenceAccuracy + adjudicatorDimensions.pricingCadenceAccuracy) / 2),
        factualAlignment: clampScore((primaryDimensions.factualAlignment + adjudicatorDimensions.factualAlignment) / 2),
        safetyAndPolicy: clampScore((primaryDimensions.safetyAndPolicy + adjudicatorDimensions.safetyAndPolicy) / 2),
        responseQuality: clampScore((primaryDimensions.responseQuality + adjudicatorDimensions.responseQuality) / 2),
      };
      llmOverallScore = clampScore((primaryScore + adjudicatorScore) / 2);
      llmConfidence = clamp01((clamp01(primary.confidence) + clamp01(adjudicator.confidence)) / 2);
      llmPass = primaryPass || adjudicatorPass || llmOverallScore >= judgeThreshold;
      llmIssues = llmPass ? [] : combinedIssues;
      llmSummary =
        llmPass
          ? "Adjudicated borderline draft as acceptable quality."
          : adjudicator.rationale || primary.rationale || "Adjudicated draft requires revision.";
      llmSuggestedFixes = adjudicator.final_draft
        ? ["Apply adjudicator-revised draft output.", clip(adjudicator.final_draft, 800)]
        : combinedIssues.slice(0, 5);
      adjudicated = true;
    }
  }

  const systemPrompt = await resolveReplayJudgeSystemPrompt(effectiveClientId);
  const overallScore = llmOverallScore;

  return {
    pass: llmPass,
    judgeMode: "hybrid_v1",
    judgeProfile,
    judgeThreshold,
    confidence: llmConfidence,
    llmPass,
    llmOverallScore,
    objectivePass: true,
    objectiveOverallScore: 100,
    objectiveCriticalReasons: [],
    blendedScore: llmOverallScore,
    adjudicated,
    adjudicationBand,
    overallScore,
    promptKey: REPLAY_JUDGE_PROMPT_KEY,
    promptClientId: effectiveClientId || null,
    systemPrompt,
    decisionContract:
      extraction?.decision_contract_v1 && typeof extraction.decision_contract_v1 === "object"
        ? (extraction.decision_contract_v1 as Record<string, unknown>)
        : null,
    dimensions: finalDimensions,
    failureReasons: llmIssues,
    suggestedFixes: llmSuggestedFixes,
    summary: llmSummary,
  };
}
