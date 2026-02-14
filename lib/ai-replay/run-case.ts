import { detectPricingHallucinations, extractPricingAmounts, generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { evaluateReplayInvariantFailures } from "@/lib/ai-replay/invariants";
import { getReplayJudgeSystemPrompt, REPLAY_JUDGE_PROMPT_KEY, runReplayJudge } from "@/lib/ai-replay/judge";
import { AUTO_SEND_CONSTANTS } from "@/lib/auto-send/types";
import { evaluateAutoSend, type AutoSendEvaluation } from "@/lib/auto-send-evaluator";
import { maybeReviseAutoSendDraft } from "@/lib/auto-send/revision-agent";
import { buildRevisionHardConstraints, validateRevisionAgainstHardConstraints } from "@/lib/auto-send/revision-constraints";
import type { OfferedSlot } from "@/lib/booking";
import { resolveBookingLink } from "@/lib/meeting-booking-provider";
import type {
  ReplayCaseResult,
  ReplayEvidencePacket,
  ReplayFailureType,
  ReplayInvariantFailure,
  ReplayJudgeInput,
  ReplayJudgeProfile,
  ReplayOverseerDecisionMode,
  ReplayRevisionLoopMode,
  ReplaySelectionCase,
} from "@/lib/ai-replay/types";
import { prisma } from "@/lib/prisma";
import { extractSchedulerLinkFromText } from "@/lib/scheduling-link";
import { buildSentimentTranscriptFromMessages } from "@/lib/sentiment";

type WorkspaceContext = {
  serviceDescription: string | null;
  knowledgeContext: string | null;
  companyName: string | null;
  targetResult: string | null;
};

type HistoricalReplyExample = ReplayJudgeInput["historicalReplyExamples"][number];
type ReplayAutoSendContext = {
  draftId: string;
  draftRunId: string | null;
  draftContent: string;
  channel: ReplaySelectionCase["channel"];
  clientId: string;
  leadId: string;
  latestInbound: string;
  subject: string | null;
  conversationHistory: string;
  sentimentTag: string;
  emailCampaignId: string | null;
  threshold: number;
  revisionModel: string | null;
  maxIterations: number;
  offeredSlots: OfferedSlot[];
  bookingLink: string | null;
  leadSchedulerLink: string | null;
  leadTimezone: string | null;
  currentDayIso: string;
};
type ReplayRevisionStopReason = NonNullable<ReplayCaseResult["revisionLoop"]>["stopReason"];

type ReplayRevisionLoopRuntime = {
  draftContent: string;
  startConfidence: number | null;
  endConfidence: number | null;
  stopReason: ReplayRevisionStopReason;
  finalReason: string | null;
  iterationsUsed: number;
  attempted: boolean;
  applied: boolean;
  iterations?: NonNullable<ReplayCaseResult["revisionLoop"]>["iterations"];
};

function normalizeOfferedSlots(value: unknown): OfferedSlot[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const label = typeof (entry as { label?: unknown }).label === "string" ? (entry as { label: string }).label.trim() : "";
      const datetime =
        typeof (entry as { datetime?: unknown }).datetime === "string"
          ? (entry as { datetime: string }).datetime.trim()
          : "";
      const offeredAt =
        typeof (entry as { offeredAt?: unknown }).offeredAt === "string"
          ? (entry as { offeredAt: string }).offeredAt.trim()
          : "";
      if (!label || !datetime) return null;
      return { label, datetime, offeredAt };
    })
    .filter((entry): entry is OfferedSlot => Boolean(entry));
}

function parseOfferedSlotsJson(value: string | null | undefined): OfferedSlot[] {
  if (!value) return [];
  try {
    return normalizeOfferedSlots(JSON.parse(value));
  } catch {
    return [];
  }
}

function classifyReplayFailure(errorMessage: string): ReplayFailureType {
  const message = (errorMessage || "").toLowerCase();
  if (!message) return "execution_error";

  if (/replay judge|max_output_tokens|judge/.test(message)) {
    return "judge_error";
  }

  if (
    /\bp1001\b|\bp2022\b|column .* does not exist|connection|connect|enotfound|etimedout|timeout|dns|api key|unauthorized|401/.test(
      message
    )
  ) {
    return "infra_error";
  }

  if (/draft generation failed|generatedraft|failed to generate draft|failed creating draft/.test(message)) {
    return "draft_generation_error";
  }

  if (/no replay cases selected|selection/.test(message)) {
    return "selection_error";
  }

  if (/decision/.test(message)) {
    return "decision_error";
  }

  return "execution_error";
}

function buildEvidencePacket(opts: {
  caseId: string;
  channel: ReplaySelectionCase["channel"];
  failureType: ReplayFailureType;
  leadSentiment: string;
  inboundSubject: string | null;
  inboundBody: string;
  transcript: string | null;
  generationStatus: "generated" | "skipped" | "failed";
  draftId: string | null;
  generatedDraft: string | null;
  generationError: string | null;
  judge: ReplayCaseResult["judge"];
  decisionContract?: Record<string, unknown> | null;
  invariants?: ReplayInvariantFailure[];
  notes?: string | null;
}): ReplayEvidencePacket {
  return {
    caseId: opts.caseId,
    channel: opts.channel,
    failureType: opts.failureType,
    inbound: {
      leadSentiment: opts.leadSentiment,
      subject: opts.inboundSubject,
      body: opts.inboundBody,
      transcript: opts.transcript,
    },
    decisionContract: opts.decisionContract || null,
    generation: {
      status: opts.generationStatus,
      draftId: opts.draftId,
      content: opts.generatedDraft,
      error: opts.generationError,
    },
    judge: {
      promptKey: REPLAY_JUDGE_PROMPT_KEY,
      systemPrompt: opts.judge?.systemPrompt || getReplayJudgeSystemPrompt(),
      promptClientId: opts.judge?.promptClientId || null,
      pass: opts.judge?.pass ?? null,
      overallScore: opts.judge?.overallScore ?? null,
      failureReasons: opts.judge?.failureReasons || [],
    },
    invariants: opts.invariants || [],
    references: {
      artifactPath: null,
      historicalOutbound: null,
      notes: opts.notes || null,
    },
  };
}

function normalizeSentiment(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function clip(text: string, maxChars: number): string {
  const trimmed = (text || "").trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n...[truncated]`;
}

const PRICING_TERMS_REGEX =
  /\b(price|pricing|cost|fee|membership|billing|monthly|annual|annually|quarterly|per\s+month|per\s+year|per\s+quarter)\b/i;
const ORPHAN_PRICING_CADENCE_LINE_REGEX =
  /(^|\n)[^\n$]*(?:membership\s+(?:fee|price|cost)|fee|price|pricing|cost|billing|billed|payment|pay)[^\n$]*(?:\/\s?(?:mo|month|yr|year|qtr|quarter)|per\s+(?:month|year|quarter))[^\n]*(\n|$)/i;
const NON_BLOCKING_JUDGE_REASON_REGEX =
  /\b(exact|verbatim|required phrasing|required wording|prescribed phrasing|preferred phrasing|preferred wording|supported phrasing|scripted|playbook|approved phrasing|standard phrasing|minor|slight|tone|wording|style|second sentence|list-heavy|bullet|bullets|bullet list|over-explains|conversational|equivalent|booking intent|qualify first|unrequested qualification|qualification detail|single-question format|single required alignment question|extra alternative criteria|longer than needed|adds friction|not needed|isn't needed|wasn't asked|wasn’t asked|keep it clean|extra framing|tighten|tighter|can be tightened|cta could be clearer|cta can better match|high[- ]?signal framing|high[- ]?signal fit check|low-friction|vague call ask|booking link \(available\)|clear next step)\b/i;
const BLOCKING_JUDGE_REASON_REGEX =
  /\b(hallucinat|mismatch|wrong recipient|wrong timezone|fabricated|missing answer|no supported pricing|unsupported pricing|no dollar amount|in the past|banned phrase|discovery call|opt-out|unsubscribe|unsafe|policy|slot|date|booked|confirmed|contradiction|invented|conflict)\b/i;

function hasOrphanPricingCadenceLine(text: string): boolean {
  return ORPHAN_PRICING_CADENCE_LINE_REGEX.test(text || "");
}

function isBlockingJudgeReason(reason: string): boolean {
  const normalized = (reason || "").trim().toLowerCase();
  if (!normalized) return false;
  if (NON_BLOCKING_JUDGE_REASON_REGEX.test(normalized)) return false;
  if (BLOCKING_JUDGE_REASON_REGEX.test(normalized)) return true;
  // Unknown judge reasons should not block replay pass; only explicitly "blocking" patterns do.
  return false;
}

const DRAFT_TIMEZONE_TOKEN_REGEX =
  /\b(pst|pdt|pt|mst|mdt|mt|cst|cdt|ct|est|edt|et|utc|gmt|[a-z_]+\/[a-z_]+(?:\/[a-z_]+)?)\b/i;
const DRAFT_MONTH_TOKEN_REGEX =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;

function countLinkOccurrences(text: string, link: string | null): number {
  const draft = (text || "").trim();
  const normalizedLink = (link || "").trim();
  if (!draft || !normalizedLink) return 0;
  const lower = draft.toLowerCase();
  const needle = normalizedLink.toLowerCase();
  let idx = 0;
  let count = 0;
  while (true) {
    const found = lower.indexOf(needle, idx);
    if (found < 0) break;
    count += 1;
    idx = found + needle.length;
  }
  return count;
}

function extractDecisionContractScalar(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const raw = record[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function computeBlockingJudgeReasons(opts: {
  failureReasons: string[];
  draft: string;
  availability: string[];
  bookingLink: string | null;
  leadSchedulerLink: string | null;
  decisionContract: unknown;
}): string[] {
  const draft = (opts.draft || "").trim();
  const availability = Array.isArray(opts.availability) ? opts.availability : [];
  const link = opts.leadSchedulerLink || opts.bookingLink || null;
  const responseMode = extractDecisionContractScalar(opts.decisionContract, "responseMode");
  const hasBookingIntent = extractDecisionContractScalar(opts.decisionContract, "hasBookingIntent");
  const shouldBookNow = extractDecisionContractScalar(opts.decisionContract, "shouldBookNow");

  const blocking: string[] = [];
  for (const reason of opts.failureReasons || []) {
    if (!isBlockingJudgeReason(reason)) continue;
    const normalized = (reason || "").trim().toLowerCase();
    if (!normalized) continue;

    // Drop obviously unsupported complaints where the draft contains the required signal.
    if (normalized.includes("omits the timezone") || normalized.includes("timezone") && normalized.includes("omit")) {
      if (DRAFT_TIMEZONE_TOKEN_REGEX.test(draft)) continue;
    }
    if (normalized.includes("timezone") && (normalized.includes("should include") || normalized.includes("should explicitly include"))) {
      const tokenMatch =
        reason.match(/\b(pacific|eastern|central|mountain)\b/i) ||
        reason.match(/\b(pt|pst|pdt|et|est|edt|ct|cst|cdt|mt|mst|mdt|utc|gmt)\b/i);
      if (tokenMatch?.[1] && draft.toLowerCase().includes(tokenMatch[1].toLowerCase())) continue;
    }
    if (normalized.includes("omits the date") || normalized.includes("date context")) {
      if (DRAFT_MONTH_TOKEN_REGEX.test(draft)) continue;
    }
    if (normalized.includes("duplicate calendly link") || normalized.includes("repeats the calendly link")) {
      if (countLinkOccurrences(draft, link) <= 1) continue;
    }
    if (
      normalized.includes("doesn’t use provided availability") ||
      normalized.includes("didn’t use provided availability") ||
      normalized.includes("doesn't use provided availability") ||
      normalized.includes("didn't use provided availability")
    ) {
      // If we're in info_then_booking with no booking intent, availability usage is optional.
      if (responseMode === "info_then_booking" && hasBookingIntent === "no") continue;
      if (availability.length === 0) continue;
      const usesAnySlot = availability.some((slot) => slot && draft.includes(slot));
      if (usesAnySlot) continue;
    }

    if (
      (normalized.includes("matches provided availability") ||
        normalized.includes("match provided availability") ||
        normalized.includes("booked time matches") ||
        normalized.includes("booked slot matches")) &&
      normalized.includes("availability")
    ) {
      if (availability.length === 0) continue;
      const usesAnySlot = availability.some((slot) => slot && draft.includes(slot));
      if (usesAnySlot) continue;
    }

    if (
      (normalized.includes("implies a booking") || normalized.includes("implies booking")) &&
      normalized.includes("provided availability")
    ) {
      if (shouldBookNow !== "yes") continue;
      if (availability.length === 0) continue;
      const usesAnySlot = availability.some((slot) => slot && draft.includes(slot));
      if (usesAnySlot) continue;
    }

    if (
      normalized.includes("prior thread") ||
      normalized.includes("earlier outbound booking") ||
      normalized.includes("earlier booking") ||
      normalized.includes("previous booking")
    ) {
      if (availability.length === 0) continue;
      const usesAnySlot = availability.some((slot) => slot && draft.includes(slot));
      if (usesAnySlot) continue;
    }

    blocking.push(reason);
  }

  return blocking;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return Math.round(value);
}

function clampRevisionIterations(value: number | null | undefined): number {
  const raw = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 3;
  return Math.max(1, Math.min(3, raw));
}

function resolveRevisionEnabled(opts: {
  mode: ReplayRevisionLoopMode;
  channel: ReplaySelectionCase["channel"];
  workspaceSettingEnabled: boolean;
}): { enabled: boolean; stopReason: ReplayRevisionStopReason } {
  if (opts.channel !== "email") return { enabled: false, stopReason: "not_applicable" };
  if (opts.mode === "off") return { enabled: false, stopReason: "disabled" };
  if (opts.mode === "force" || opts.mode === "overseer") return { enabled: true, stopReason: "exhausted" };
  if (opts.workspaceSettingEnabled) return { enabled: true, stopReason: "exhausted" };
  return { enabled: false, stopReason: "disabled" };
}

function joinKnowledgeContext(chunks: Array<string | null | undefined>, maxChars: number): string | null {
  const cleaned = chunks
    .map((value) => (value || "").trim())
    .filter(Boolean)
    .join("\n\n---\n\n")
    .trim();

  if (!cleaned) return null;
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars)}\n...[truncated]`;
}

async function loadWorkspaceContext(clientId: string): Promise<WorkspaceContext> {
  const settings = await prisma.workspaceSettings.findUnique({
    where: { clientId },
    select: {
      serviceDescription: true,
      companyName: true,
      targetResult: true,
      knowledgeAssets: {
        orderBy: { updatedAt: "desc" },
        take: 6,
        select: { name: true, textContent: true, rawContent: true },
      },
    },
  });

  const knowledgeChunks = (settings?.knowledgeAssets || []).map((asset) => {
    const text = (asset.textContent || asset.rawContent || "").trim();
    if (!text) return null;
    const labeled = `Asset: ${asset.name || "Untitled"}\n${text}`;
    return labeled.length > 5000 ? `${labeled.slice(0, 5000)}\n...[truncated]` : labeled;
  });

  return {
    serviceDescription: settings?.serviceDescription || null,
    knowledgeContext: joinKnowledgeContext(knowledgeChunks, 20000),
    companyName: settings?.companyName || null,
    targetResult: settings?.targetResult || null,
  };
}

async function buildReplayTranscript(leadId: string): Promise<string> {
  const messages = await prisma.message.findMany({
    where: { leadId },
    orderBy: { sentAt: "desc" },
    take: 80,
    select: {
      sentAt: true,
      channel: true,
      direction: true,
      body: true,
      subject: true,
    },
  });

  return buildSentimentTranscriptFromMessages(messages.reverse());
}

async function findObservedNextOutbound(opts: {
  leadId: string;
  channel: ReplayJudgeInput["channel"];
  inboundSentAt: Date;
}): Promise<ReplayJudgeInput["observedNextOutbound"]> {
  const upperBound = new Date(opts.inboundSentAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  const nextOutbound = await prisma.message.findFirst({
    where: {
      leadId: opts.leadId,
      channel: opts.channel,
      direction: "outbound",
      sentAt: {
        gte: opts.inboundSentAt,
        lte: upperBound,
      },
    },
    orderBy: [{ sentAt: "asc" }, { createdAt: "asc" }],
    select: {
      subject: true,
      body: true,
      sentAt: true,
      source: true,
    },
  });

  if (!nextOutbound) return null;
  return {
    subject: nextOutbound.subject,
    body: clip(nextOutbound.body, 1200),
    sentAt: nextOutbound.sentAt.toISOString(),
    source: nextOutbound.source || null,
  };
}

async function loadHistoricalReplyExamples(opts: {
  clientId: string;
  channel: ReplayJudgeInput["channel"];
  targetSentiment: string;
  excludeLeadId: string;
}): Promise<HistoricalReplyExample[]> {
  const commonWhere = {
    direction: "outbound" as const,
    channel: opts.channel,
    body: { not: "" },
    lead: { clientId: opts.clientId },
  };
  const select = {
    id: true,
    subject: true,
    body: true,
    sentAt: true,
    source: true,
    leadId: true,
    lead: {
      select: {
        sentimentTag: true,
      },
    },
  };

  const preferred = await prisma.message.findMany({
    where: {
      ...commonWhere,
      OR: [{ sentByUserId: { not: null } }, { sentBy: "setter" }],
    },
    orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
    take: 120,
    select,
  });

  const pool = [...preferred];
  if (pool.length < 12) {
    const fallback = await prisma.message.findMany({
      where: commonWhere,
      orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
      take: 120,
      select,
    });
    const seenIds = new Set(pool.map((value) => value.id));
    for (const value of fallback) {
      if (!seenIds.has(value.id)) pool.push(value);
    }
  }

  const targetSentiment = normalizeSentiment(opts.targetSentiment);
  const scored = pool
    .filter((value) => value.leadId !== opts.excludeLeadId)
    .map((value, index) => {
      let score = 0;
      if (targetSentiment && normalizeSentiment(value.lead.sentimentTag) === targetSentiment) score += 100;
      if ((value.source || "").toLowerCase() === "zrg") score += 10;
      score += Math.max(0, 200 - index); // recency bias
      return { value, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.value.sentAt.getTime() - a.value.sentAt.getTime();
    });

  const examples: HistoricalReplyExample[] = [];
  const seenBodies = new Set<string>();
  for (const entry of scored) {
    const normalizedBody = entry.value.body.trim().toLowerCase().replace(/\s+/g, " ");
    if (!normalizedBody || seenBodies.has(normalizedBody)) continue;
    seenBodies.add(normalizedBody);
    examples.push({
      subject: entry.value.subject,
      body: clip(entry.value.body, 1200),
      sentAt: entry.value.sentAt.toISOString(),
      leadSentiment: entry.value.lead.sentimentTag,
    });
    if (examples.length >= 3) break;
  }

  return examples;
}

async function applyReplayRevisionLoop(opts: ReplayAutoSendContext): Promise<ReplayRevisionLoopRuntime> {
  let draftContent = (opts.draftContent || "").trim();
  if (!draftContent) {
    return {
      draftContent: "",
      startConfidence: null,
      endConfidence: null,
      stopReason: "error",
      finalReason: "missing_draft_content",
      iterationsUsed: 0,
      attempted: false,
      applied: false,
    };
  }

  const evaluateCurrentDraft = async (candidateDraft: string) =>
    evaluateAutoSend({
      clientId: opts.clientId,
      leadId: opts.leadId,
      channel: opts.channel,
      latestInbound: opts.latestInbound,
      subject: opts.subject,
      conversationHistory: opts.conversationHistory,
      categorization: opts.sentimentTag,
      automatedReply: null,
      replyReceivedAt: null,
      draft: candidateDraft,
    });

  const baselineEvaluation = await evaluateCurrentDraft(draftContent);
  const startConfidence = clamp01(Number(baselineEvaluation.confidence));

  if ((baselineEvaluation.source ?? "model") === "hard_block" || baselineEvaluation.hardBlockCode) {
    return {
      draftContent,
      startConfidence,
      endConfidence: startConfidence,
      stopReason: "hard_block",
      finalReason: baselineEvaluation.reason || null,
      iterationsUsed: 0,
      attempted: false,
      applied: false,
    };
  }

  if (startConfidence >= opts.threshold) {
    return {
      draftContent,
      startConfidence,
      endConfidence: startConfidence,
      stopReason: "threshold_met",
      finalReason: baselineEvaluation.reason || null,
      iterationsUsed: 0,
      attempted: false,
      applied: false,
    };
  }

  let currentEvaluation = baselineEvaluation;
  let applied = false;
  let attempted = false;
  let iterationsUsed = 0;
  let stopReason: ReplayRevisionStopReason = "exhausted";

  for (let iteration = 1; iteration <= opts.maxIterations; iteration += 1) {
    iterationsUsed = iteration;
    const revisionConstraints = buildRevisionHardConstraints({
      inboundBody: opts.latestInbound,
      offeredSlots: opts.offeredSlots,
      bookingLink: opts.bookingLink,
      leadSchedulerLink: opts.leadSchedulerLink,
      currentDraft: draftContent,
    });

    const revision = await maybeReviseAutoSendDraft({
      clientId: opts.clientId,
      leadId: opts.leadId,
      emailCampaignId: opts.emailCampaignId,
      draftId: opts.draftId,
      channel: opts.channel,
      draftPipelineRunId: opts.draftRunId,
      iteration,
      subject: opts.subject,
      latestInbound: opts.latestInbound,
      conversationHistory: opts.conversationHistory,
      draft: draftContent,
      evaluation: currentEvaluation,
      threshold: opts.threshold,
      model: opts.revisionModel || undefined,
      hardRequirements: revisionConstraints.hardRequirements,
      hardForbidden: revisionConstraints.hardForbidden,
      currentDayIso: opts.currentDayIso,
      leadTimezone: opts.leadTimezone,
      offeredSlots: opts.offeredSlots,
      bookingLink: opts.bookingLink,
      leadSchedulerLink: opts.leadSchedulerLink,
      validateRevisedDraft: async (candidateDraft) =>
        validateRevisionAgainstHardConstraints({
          inboundBody: opts.latestInbound,
          offeredSlots: opts.offeredSlots,
          bookingLink: opts.bookingLink,
          leadSchedulerLink: opts.leadSchedulerLink,
          draft: candidateDraft,
        }),
      reEvaluate: async (candidate) =>
        evaluateAutoSend({
          clientId: opts.clientId,
          leadId: opts.leadId,
          channel: opts.channel,
          latestInbound: opts.latestInbound,
          subject: opts.subject,
          conversationHistory: opts.conversationHistory,
          categorization: opts.sentimentTag,
          automatedReply: null,
          replyReceivedAt: null,
          draft: candidate,
        }),
    });

    attempted = attempted || revision.telemetry.attempted === true;

    if (revision.revisedDraft && revision.revisedEvaluation) {
      applied = true;
      draftContent = revision.revisedDraft;
      currentEvaluation = revision.revisedEvaluation;
      const currentSource = currentEvaluation.source ?? "model";
      const currentConfidence = clamp01(Number(currentEvaluation.confidence));
      if (currentSource === "hard_block" || currentEvaluation.hardBlockCode) {
        stopReason = "hard_block";
        break;
      }
      if (currentConfidence >= opts.threshold) {
        stopReason = "threshold_met";
        break;
      }
      continue;
    }

    stopReason = "no_improvement";
    break;
  }

  const endConfidence = clamp01(Number(currentEvaluation.confidence));
  const finalReason = currentEvaluation.reason || null;
  return {
    draftContent,
    startConfidence,
    endConfidence,
    stopReason,
    finalReason,
    iterationsUsed,
    attempted,
    applied,
  };
}

function mapJudgeToAutoSendEvaluation(judge: {
  pass: boolean;
  confidence: number;
  summary: string;
  failureReasons: string[];
}): AutoSendEvaluation {
  const confidence = clamp01(Number(judge.confidence));
  const safeToSend = judge.pass === true && confidence >= 0.01;
  const failureReason = (judge.failureReasons || []).slice(0, 3).join(" | ");
  return {
    confidence,
    safeToSend,
    requiresHumanReview: !safeToSend,
    reason: failureReason || judge.summary || (safeToSend ? "Overseer approved draft" : "Overseer requested revision"),
    source: "model",
  };
}

async function applyReplayOverseerRevisionLoop(opts:
  ReplayAutoSendContext & {
    judgeClientId: string | null;
    judgeModel: string;
    judgeProfile: ReplayJudgeProfile;
    judgeThreshold: number;
    adjudicationBand: {
      min: number;
      max: number;
    };
    adjudicateBorderline: boolean;
    source: string;
    caseId: string;
    messageId: string;
    baseJudgeInput: Omit<ReplayJudgeInput, "generatedDraft">;
  }
): Promise<ReplayRevisionLoopRuntime> {
  let draftContent = (opts.draftContent || "").trim();
  if (!draftContent) {
    return {
      draftContent: "",
      startConfidence: null,
      endConfidence: null,
      stopReason: "error",
      finalReason: "missing_draft_content",
      iterationsUsed: 0,
      attempted: false,
      applied: false,
      iterations: [],
    };
  }

  const iterations: NonNullable<ReplayCaseResult["revisionLoop"]>["iterations"] = [];

  const runJudgeForDraft = async (candidateDraft: string) =>
    runReplayJudge({
      clientId: opts.clientId,
      judgeClientId: opts.judgeClientId,
      leadId: opts.leadId,
      model: opts.judgeModel,
      judgeProfile: opts.judgeProfile,
      judgeThreshold: opts.judgeThreshold,
      adjudicationBand: opts.adjudicationBand,
      adjudicateBorderline: opts.adjudicateBorderline,
      input: {
        ...opts.baseJudgeInput,
        generatedDraft: candidateDraft,
      },
      offeredSlots: opts.offeredSlots,
      bookingLink: opts.bookingLink,
      leadSchedulerLink: opts.leadSchedulerLink,
      source: opts.source,
      metadata: {
        replay: true,
        caseId: opts.caseId,
        messageId: opts.messageId,
        revisionLoop: "overseer",
      },
    });

  let currentJudge = await runJudgeForDraft(draftContent);
  let currentEvaluation = mapJudgeToAutoSendEvaluation({
    pass: currentJudge.pass,
    confidence: currentJudge.confidence,
    summary: currentJudge.summary,
    failureReasons: currentJudge.failureReasons || [],
  });

  const startConfidence = clamp01(Number(currentEvaluation.confidence));
  if (currentJudge.pass) {
    return {
      draftContent,
      startConfidence,
      endConfidence: startConfidence,
      stopReason: "threshold_met",
      finalReason: currentJudge.summary || null,
      iterationsUsed: 0,
      attempted: false,
      applied: false,
      iterations,
    };
  }

  let applied = false;
  let attempted = false;
  let iterationsUsed = 0;
  let stopReason: ReplayRevisionStopReason = "exhausted";
  let previousScore = clampScore(currentJudge.overallScore ?? currentJudge.llmOverallScore);

  for (let iteration = 1; iteration <= opts.maxIterations; iteration += 1) {
    iterationsUsed = iteration;
    const revisionConstraints = buildRevisionHardConstraints({
      inboundBody: opts.latestInbound,
      offeredSlots: opts.offeredSlots,
      bookingLink: opts.bookingLink,
      leadSchedulerLink: opts.leadSchedulerLink,
      currentDraft: draftContent,
    });

    const revision = await maybeReviseAutoSendDraft({
      clientId: opts.clientId,
      leadId: opts.leadId,
      emailCampaignId: opts.emailCampaignId,
      draftId: opts.draftId,
      channel: opts.channel,
      draftPipelineRunId: opts.draftRunId,
      iteration,
      subject: opts.subject,
      latestInbound: opts.latestInbound,
      conversationHistory: opts.conversationHistory,
      draft: draftContent,
      evaluation: currentEvaluation,
      threshold: opts.threshold,
      model: opts.revisionModel || undefined,
      hardRequirements: revisionConstraints.hardRequirements,
      hardForbidden: revisionConstraints.hardForbidden,
      currentDayIso: opts.currentDayIso,
      leadTimezone: opts.leadTimezone,
      offeredSlots: opts.offeredSlots,
      bookingLink: opts.bookingLink,
      leadSchedulerLink: opts.leadSchedulerLink,
      validateRevisedDraft: async (candidateDraft) =>
        validateRevisionAgainstHardConstraints({
          inboundBody: opts.latestInbound,
          offeredSlots: opts.offeredSlots,
          bookingLink: opts.bookingLink,
          leadSchedulerLink: opts.leadSchedulerLink,
          draft: candidateDraft,
        }),
      reEvaluate: async (candidateDraft) => {
        const judge = await runJudgeForDraft(candidateDraft);
        return mapJudgeToAutoSendEvaluation({
          pass: judge.pass,
          confidence: judge.confidence,
          summary: judge.summary,
          failureReasons: judge.failureReasons || [],
        });
      },
    });

    attempted = attempted || revision.telemetry.attempted === true;

    if (!revision.revisedDraft) {
      stopReason = "no_improvement";
      break;
    }

    applied = true;
    draftContent = revision.revisedDraft;
    currentJudge = await runJudgeForDraft(draftContent);
    currentEvaluation = mapJudgeToAutoSendEvaluation({
      pass: currentJudge.pass,
      confidence: currentJudge.confidence,
      summary: currentJudge.summary,
      failureReasons: currentJudge.failureReasons || [],
    });

    const currentScore = clampScore(currentJudge.overallScore ?? currentJudge.llmOverallScore);
    const improved = currentScore > previousScore;
    previousScore = currentScore;

    iterations.push({
      iteration,
      judgePass: currentJudge.pass,
      judgeScore: currentScore,
      judgeConfidence: clamp01(currentJudge.confidence),
      judgeFailureReasons: [...(currentJudge.failureReasons || [])],
      judgeSummary: currentJudge.summary || "",
      revisionAttempted: revision.telemetry.attempted === true,
      revisionApplied: revision.revisedDraft != null,
      revisionImproved: improved,
      validationPassed:
        typeof revision.telemetry.validationPassed === "boolean"
          ? revision.telemetry.validationPassed
          : null,
      validationReasons: revision.telemetry.validationReasons || [],
    });

    if (currentJudge.pass) {
      stopReason = "threshold_met";
      break;
    }

    if (!improved) {
      stopReason = "no_improvement";
      break;
    }
  }

  const endConfidence = clamp01(Number(currentEvaluation.confidence));
  const finalReason =
    currentJudge.summary ||
    (currentJudge.failureReasons && currentJudge.failureReasons.length > 0 ? currentJudge.failureReasons[0] || null : null);

  return {
    draftContent,
    startConfidence,
    endConfidence,
    stopReason,
    finalReason,
    iterationsUsed,
    attempted,
    applied,
    iterations,
  };
}

export async function runReplayCase(opts: {
  selectionCase: ReplaySelectionCase;
  judgeModel: string;
  judgeClientId: string | null;
  judgeProfile: ReplayJudgeProfile;
  judgeThreshold: number;
  adjudicationBand: {
    min: number;
    max: number;
  };
  adjudicateBorderline: boolean;
  cleanupDrafts: boolean;
  revisionLoopMode: ReplayRevisionLoopMode;
  overseerDecisionMode: ReplayOverseerDecisionMode;
  source: string;
  workspaceContextCache: Map<string, WorkspaceContext>;
  historicalReplyCache: Map<string, HistoricalReplyExample[]>;
}): Promise<ReplayCaseResult> {
  const startedAt = new Date();
  const baseRevisionLoop: NonNullable<ReplayCaseResult["revisionLoop"]> = {
    mode: opts.revisionLoopMode,
    enabled: false,
    attempted: false,
    applied: false,
    iterationsUsed: 0,
    threshold: null,
    startConfidence: null,
    endConfidence: null,
    stopReason: "disabled",
    finalReason: null,
  };
  const resultBase: Omit<
    ReplayCaseResult,
    "status" | "skipReason" | "error" | "generation" | "generatedDraft" | "judge" | "evidencePacket"
  > = {
    caseId: opts.selectionCase.caseId,
    messageId: opts.selectionCase.messageId,
    leadId: opts.selectionCase.leadId,
    clientId: opts.selectionCase.clientId,
    channel: opts.selectionCase.channel,
    attempts: 1,
    startedAt: startedAt.toISOString(),
    completedAt: startedAt.toISOString(),
    durationMs: 0,
    leadSentiment: opts.selectionCase.leadSentiment,
    inboundSubject: opts.selectionCase.inboundSubject,
    inboundBody: opts.selectionCase.inboundBody,
    transcript: null,
    revisionLoop: baseRevisionLoop,
    invariants: [],
    failureType: null,
    warnings: [],
  };

  try {
    const lead = await prisma.lead.findUnique({
      where: { id: opts.selectionCase.leadId },
      select: {
        id: true,
        email: true,
        timezone: true,
        sentimentTag: true,
        offeredSlots: true,
        externalSchedulingLink: true,
        client: {
          select: {
            settings: {
              select: {
                meetingBookingProvider: true,
                calendlyEventTypeLink: true,
              },
            },
          },
        },
        emailCampaign: {
          select: {
            id: true,
            autoSendConfidenceThreshold: true,
          },
        },
      },
    });

    if (!lead) {
      throw new Error(`Lead not found: ${opts.selectionCase.leadId}`);
    }

    const sentimentTag = lead.sentimentTag || "Neutral";
    const triggerMessage = await prisma.message.findUnique({
      where: { id: opts.selectionCase.messageId },
      select: { body: true, rawText: true },
    });
    const inferredSchedulerLink = (() => {
      const bodyText = (triggerMessage?.body || "").trim();
      const rawText = (triggerMessage?.rawText || "").trim();
      const candidate = extractSchedulerLinkFromText(`${bodyText}\n${rawText}`);
      if (!candidate) return null;
      if (!/\b(schedule|scheduling|book|booking|calendar|availability|slot|time|works?)\b/i.test(bodyText)) {
        return null;
      }
      return candidate;
    })();
    const leadSchedulerLink = inferredSchedulerLink || lead.externalSchedulingLink || null;
    const { bookingLink: workspaceBookingLink } = await resolveBookingLink(
      opts.selectionCase.clientId,
      lead.client?.settings || null
    );

    if (!shouldGenerateDraft(sentimentTag, lead.email)) {
      const completedAt = new Date();
      return {
        ...resultBase,
        status: "skipped",
        skipReason: `Draft generation disabled for sentiment "${sentimentTag}"`,
        error: null,
        generation: null,
        generatedDraft: null,
        judge: null,
        failureType: null,
        evidencePacket: buildEvidencePacket({
          caseId: opts.selectionCase.caseId,
          channel: opts.selectionCase.channel,
          failureType: null,
          leadSentiment: sentimentTag,
          inboundSubject: opts.selectionCase.inboundSubject,
          inboundBody: opts.selectionCase.inboundBody,
          transcript: null,
          generationStatus: "skipped",
          draftId: null,
          generatedDraft: null,
          generationError: null,
          judge: null,
          notes: "Draft generation disabled by gating rules.",
        }),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
      };
    }

    const transcript = await buildReplayTranscript(opts.selectionCase.leadId);
    const generation = await generateResponseDraft(
      opts.selectionCase.leadId,
      transcript,
      sentimentTag,
      opts.selectionCase.channel,
      {
        triggerMessageId: opts.selectionCase.messageId,
        reuseExistingDraft: false,
        leadSchedulerLinkOverride: leadSchedulerLink,
        meetingOverseerMode: opts.overseerDecisionMode,
        persistMeetingOverseerDecisions: opts.overseerDecisionMode === "persisted",
      }
    );

    if (!generation.success || !generation.content) {
      throw new Error(generation.error || "Draft generation failed");
    }

    let generatedDraft = generation.content;
    const draftId = generation.draftId || null;
    const bookingEscalationReason =
      typeof generation.bookingEscalationReason === "string" && generation.bookingEscalationReason.trim()
        ? generation.bookingEscalationReason.trim()
        : null;
    const generationOfferedSlots = normalizeOfferedSlots(generation.offeredSlots);
    let offeredSlots: OfferedSlot[] =
      bookingEscalationReason
        ? []
        : generationOfferedSlots.length > 0
          ? generationOfferedSlots
          : parseOfferedSlotsJson(lead.offeredSlots);

    // Prefer in-memory generation slots. If unavailable (reused drafts / legacy path),
    // refresh from DB to pick up any slots generated during this pass.
	    if (!bookingEscalationReason && generationOfferedSlots.length === 0) {
	      try {
	        const refreshedLead = await prisma.lead.findUnique({
	          where: { id: opts.selectionCase.leadId },
	          select: { offeredSlots: true },
	        });
	        if (refreshedLead) {
	          offeredSlots = parseOfferedSlotsJson(refreshedLead.offeredSlots);
	        }
	      } catch {
	        // Best-effort only.
	      }
	    }

	    // Match platform behavior: booking escalation suppresses the workspace booking link.
	    const effectiveBookingLink = bookingEscalationReason ? null : workspaceBookingLink || null;

	    let workspaceContext = opts.workspaceContextCache.get(opts.selectionCase.clientId);
	    if (!workspaceContext) {
	      workspaceContext = await loadWorkspaceContext(opts.selectionCase.clientId);
	      opts.workspaceContextCache.set(opts.selectionCase.clientId, workspaceContext);
	    }

    const observedNextOutbound = await findObservedNextOutbound({
      leadId: opts.selectionCase.leadId,
      channel: opts.selectionCase.channel,
      inboundSentAt: new Date(opts.selectionCase.sentAt),
    });
    const historicalCacheKey = [
      opts.selectionCase.clientId,
      opts.selectionCase.channel,
      normalizeSentiment(sentimentTag) || "neutral",
    ].join(":");
    let historicalReplyExamples = opts.historicalReplyCache.get(historicalCacheKey);
    if (!historicalReplyExamples) {
      historicalReplyExamples = await loadHistoricalReplyExamples({
        clientId: opts.selectionCase.clientId,
        channel: opts.selectionCase.channel,
        targetSentiment: sentimentTag,
        excludeLeadId: opts.selectionCase.leadId,
      });
      opts.historicalReplyCache.set(historicalCacheKey, historicalReplyExamples);
    }

    const baseJudgeInput: Omit<ReplayJudgeInput, "generatedDraft"> = {
      channel: opts.selectionCase.channel,
      leadSentiment: sentimentTag,
      inboundSubject: opts.selectionCase.inboundSubject,
      inboundBody: opts.selectionCase.inboundBody,
      conversationTranscript: transcript,
      serviceDescription: workspaceContext.serviceDescription,
      knowledgeContext: workspaceContext.knowledgeContext,
      companyName: workspaceContext.companyName,
      targetResult: workspaceContext.targetResult,
      observedNextOutbound,
      historicalReplyExamples,
    };
    const threshold =
      typeof lead.emailCampaign?.autoSendConfidenceThreshold === "number" &&
      Number.isFinite(lead.emailCampaign.autoSendConfidenceThreshold)
        ? lead.emailCampaign.autoSendConfidenceThreshold
        : AUTO_SEND_CONSTANTS.DEFAULT_CONFIDENCE_THRESHOLD;
    const workspaceRevision = await prisma.workspaceSettings.findUnique({
      where: { clientId: opts.selectionCase.clientId },
      select: {
        autoSendRevisionEnabled: true,
        autoSendRevisionMaxIterations: true,
        autoSendRevisionModel: true,
        meetingBookingProvider: true,
        calendlyEventTypeLink: true,
      },
    });
    const enabledResolution = resolveRevisionEnabled({
      mode: opts.revisionLoopMode,
      channel: opts.selectionCase.channel,
      workspaceSettingEnabled: workspaceRevision?.autoSendRevisionEnabled === true,
    });
    let revisionLoop: NonNullable<ReplayCaseResult["revisionLoop"]> = {
      ...baseRevisionLoop,
      enabled: enabledResolution.enabled,
      stopReason: enabledResolution.stopReason,
      threshold: enabledResolution.enabled ? threshold : null,
    };

    if (enabledResolution.enabled) {
      if (!draftId) {
        revisionLoop = {
          ...revisionLoop,
          enabled: false,
          stopReason: "error",
          finalReason: "missing_draft_id",
        };
      } else {
        const revisionRuntime =
          opts.revisionLoopMode === "overseer"
            ? await applyReplayOverseerRevisionLoop({
                draftId,
                draftRunId: null,
                draftContent: generatedDraft,
                channel: opts.selectionCase.channel,
                clientId: opts.selectionCase.clientId,
                leadId: opts.selectionCase.leadId,
                latestInbound: opts.selectionCase.inboundBody,
                subject: opts.selectionCase.inboundSubject,
                conversationHistory: transcript,
                sentimentTag,
                emailCampaignId: lead.emailCampaign?.id || null,
                threshold,
	                revisionModel: workspaceRevision?.autoSendRevisionModel || null,
	                maxIterations: clampRevisionIterations(workspaceRevision?.autoSendRevisionMaxIterations),
	                offeredSlots,
	                bookingLink: effectiveBookingLink,
	                leadSchedulerLink,
	                leadTimezone: lead.timezone || null,
	                currentDayIso: opts.selectionCase.sentAt,
	                judgeClientId: opts.judgeClientId,
	                judgeModel: opts.judgeModel,
                judgeProfile: opts.judgeProfile,
                judgeThreshold: opts.judgeThreshold,
                adjudicationBand: opts.adjudicationBand,
                adjudicateBorderline: opts.adjudicateBorderline,
                source: opts.source,
                caseId: opts.selectionCase.caseId,
                messageId: opts.selectionCase.messageId,
                baseJudgeInput,
              })
            : await applyReplayRevisionLoop({
                draftId,
                draftRunId: null,
                draftContent: generatedDraft,
                channel: opts.selectionCase.channel,
                clientId: opts.selectionCase.clientId,
                leadId: opts.selectionCase.leadId,
                latestInbound: opts.selectionCase.inboundBody,
                subject: opts.selectionCase.inboundSubject,
                conversationHistory: transcript,
                sentimentTag,
                emailCampaignId: lead.emailCampaign?.id || null,
                threshold,
	                revisionModel: workspaceRevision?.autoSendRevisionModel || null,
	                maxIterations: clampRevisionIterations(workspaceRevision?.autoSendRevisionMaxIterations),
	                offeredSlots,
	                bookingLink: effectiveBookingLink,
	                leadSchedulerLink,
	                leadTimezone: lead.timezone || null,
	                currentDayIso: opts.selectionCase.sentAt,
	              });
        generatedDraft = revisionRuntime.draftContent || generatedDraft;
        revisionLoop = {
          ...revisionLoop,
          attempted: revisionRuntime.attempted,
          applied: revisionRuntime.applied,
          iterationsUsed: revisionRuntime.iterationsUsed,
          startConfidence: revisionRuntime.startConfidence,
          endConfidence: revisionRuntime.endConfidence,
          stopReason: revisionRuntime.stopReason,
          finalReason: revisionRuntime.finalReason,
          iterations: revisionRuntime.iterations,
        };
      }
    }

    const judgeInput: ReplayJudgeInput = {
      ...baseJudgeInput,
      generatedDraft,
    };

    const judge = await runReplayJudge({
      clientId: opts.selectionCase.clientId,
      judgeClientId: opts.judgeClientId,
      leadId: opts.selectionCase.leadId,
      model: opts.judgeModel,
      judgeProfile: opts.judgeProfile,
      judgeThreshold: opts.judgeThreshold,
      adjudicationBand: opts.adjudicationBand,
	      adjudicateBorderline: opts.adjudicateBorderline,
	      input: judgeInput,
	      offeredSlots,
	      bookingLink: effectiveBookingLink,
	      leadSchedulerLink,
	      source: opts.source,
	      metadata: {
	        replay: true,
	        caseId: opts.selectionCase.caseId,
        messageId: opts.selectionCase.messageId,
      },
    });
    const invariantFailures = evaluateReplayInvariantFailures({
	      inboundBody: opts.selectionCase.inboundBody,
	      draft: generatedDraft,
	      offeredSlots,
	      bookingLink: effectiveBookingLink,
	      leadSchedulerLink,
	    });
    const objectiveCriticalReasons = invariantFailures.map((entry) => `[${entry.code}] ${entry.message}`);
    const pricingObjectiveWarnings: string[] = [];
    const pricingCheck = detectPricingHallucinations(
      generatedDraft,
      workspaceContext.serviceDescription,
      workspaceContext.knowledgeContext
    );
    if (pricingCheck.hallucinated.length > 0) {
      const reason = `[pricing_hallucination] unsupported dollar amounts: $${pricingCheck.hallucinated.join(", $")}`;
      objectiveCriticalReasons.push(reason);
      pricingObjectiveWarnings.push(reason);
    }
    if (pricingCheck.cadenceMismatched.length > 0) {
      const reason = `[pricing_cadence_mismatch] unsupported cadence for amounts: $${pricingCheck.cadenceMismatched.join(", $")}`;
      objectiveCriticalReasons.push(reason);
      pricingObjectiveWarnings.push(reason);
    }
    const requiresPricingAnswer = Boolean(
      judge.decisionContract &&
        typeof judge.decisionContract === "object" &&
        judge.decisionContract.needsPricingAnswer === "yes"
    );
    const sourcePricingAmounts = Array.from(
      new Set([
        ...extractPricingAmounts(workspaceContext.serviceDescription || ""),
        ...extractPricingAmounts(workspaceContext.knowledgeContext || ""),
      ])
    );
    if (requiresPricingAnswer && sourcePricingAmounts.length > 0 && pricingCheck.allDraft.length === 0) {
      const reason = `[pricing_missing_answer] lead asked for pricing but draft provided no supported pricing amount (available: $${sourcePricingAmounts.join(", $")})`;
      objectiveCriticalReasons.push(reason);
      pricingObjectiveWarnings.push(reason);
    }
    if (
      requiresPricingAnswer &&
      PRICING_TERMS_REGEX.test(generatedDraft || "") &&
      pricingCheck.allDraft.length === 0
    ) {
      const reason = "[pricing_missing_answer] pricing intent detected but draft references pricing terms without any dollar amount";
      objectiveCriticalReasons.push(reason);
      pricingObjectiveWarnings.push(reason);
    }
    if (hasOrphanPricingCadenceLine(generatedDraft || "")) {
      const reason = "[pricing_malformed_cadence] draft contains cadence wording without a paired dollar amount";
      objectiveCriticalReasons.push(reason);
      pricingObjectiveWarnings.push(reason);
    }
    const objectivePass = objectiveCriticalReasons.length === 0;
    const objectiveOverallScore = objectivePass ? 100 : 0;
    const llmOverallScore = clampScore(judge.llmOverallScore ?? judge.overallScore);
    const blockingJudgeReasons = computeBlockingJudgeReasons({
      failureReasons: judge.failureReasons || [],
      draft: generatedDraft,
	      availability: offeredSlots
	        .map((slot) => (typeof slot?.label === "string" ? slot.label.trim() : ""))
	        .filter((label) => label.length > 0),
	      bookingLink: effectiveBookingLink,
	      leadSchedulerLink,
	      decisionContract: judge.decisionContract,
	    });
    const blendedScore = clampScore(llmOverallScore * 0.7 + objectiveOverallScore * 0.3);
    const finalPass =
      objectivePass && (llmOverallScore >= opts.judgeThreshold || (judge.llmPass === false && blockingJudgeReasons.length === 0));
    const finalFailureReasons = finalPass
      ? []
      : [
          ...(!judge.llmPass ? blockingJudgeReasons : []),
          ...(!objectivePass ? objectiveCriticalReasons : []),
        ];
    const finalSummary = finalPass
      ? judge.summary
      : !objectivePass
        ? `${judge.summary} Objective critical gate blocked send.`
        : judge.summary;
    const judgedResult = {
      ...judge,
      pass: finalPass,
      objectivePass,
      objectiveOverallScore,
      objectiveCriticalReasons,
      blendedScore,
      overallScore: llmOverallScore,
      failureReasons: finalFailureReasons,
      summary: finalSummary,
    };

    const completedAt = new Date();
    const result: ReplayCaseResult = {
      ...resultBase,
      status: "evaluated",
      skipReason: null,
      error: null,
      warnings: [...resultBase.warnings, ...pricingObjectiveWarnings],
      generation: {
        draftId,
        runId: generation.runId || null,
      },
      revisionLoop,
      generatedDraft,
      judge: judgedResult,
      invariants: invariantFailures,
      failureType: judgedResult.pass ? null : "draft_quality_error",
      evidencePacket: buildEvidencePacket({
        caseId: opts.selectionCase.caseId,
        channel: opts.selectionCase.channel,
        failureType: judgedResult.pass ? null : "draft_quality_error",
        leadSentiment: sentimentTag,
        inboundSubject: opts.selectionCase.inboundSubject,
        inboundBody: opts.selectionCase.inboundBody,
        transcript,
        generationStatus: "generated",
        draftId,
        generatedDraft,
        generationError: null,
        judge: judgedResult,
        decisionContract: judge.decisionContract,
        invariants: invariantFailures,
      }),
      transcript,
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      leadSentiment: sentimentTag,
    };

    if (opts.cleanupDrafts && draftId && !generation.reusedExistingDraft) {
      try {
        await prisma.aIDraft.delete({ where: { id: draftId } });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown cleanup failure";
        result.warnings.push(`Failed to delete replay draft ${draftId}: ${message}`);
      }
    }

    return result;
  } catch (error) {
    const completedAt = new Date();
    const errorMessage = error instanceof Error ? error.message : "Unknown replay case failure";
    const failureType = classifyReplayFailure(errorMessage);
    return {
      ...resultBase,
      status: "failed",
      skipReason: null,
      error: errorMessage,
      generation: null,
      generatedDraft: null,
      judge: null,
      failureType,
      evidencePacket: buildEvidencePacket({
        caseId: opts.selectionCase.caseId,
        channel: opts.selectionCase.channel,
        failureType,
        leadSentiment: opts.selectionCase.leadSentiment,
        inboundSubject: opts.selectionCase.inboundSubject,
        inboundBody: opts.selectionCase.inboundBody,
        transcript: null,
        generationStatus: "failed",
        draftId: null,
        generatedDraft: null,
        generationError: errorMessage,
        judge: null,
        decisionContract: null,
      }),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
    };
  }
}
