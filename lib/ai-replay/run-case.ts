import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { evaluateReplayInvariantFailures } from "@/lib/ai-replay/invariants";
import { getReplayJudgeSystemPrompt, REPLAY_JUDGE_PROMPT_KEY, runReplayJudge } from "@/lib/ai-replay/judge";
import { AUTO_SEND_CONSTANTS } from "@/lib/auto-send/types";
import { evaluateAutoSend } from "@/lib/auto-send-evaluator";
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
};

function parseOfferedSlotsJson(value: string | null | undefined): OfferedSlot[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as OfferedSlot[]) : [];
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
    decisionContract: null,
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
  if (opts.mode === "force") return { enabled: true, stopReason: "exhausted" };
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
        meetingOverseerMode: "fresh",
        persistMeetingOverseerDecisions: false,
      }
    );

    if (!generation.success || !generation.content) {
      throw new Error(generation.error || "Draft generation failed");
    }

    let generatedDraft = generation.content;
    const draftId = generation.draftId || null;
    let offeredSlots: OfferedSlot[] = parseOfferedSlotsJson(lead.offeredSlots);

    // Keep replay invariants and judging aligned with the actual slot set used by
    // this generation pass (generateResponseDraft may refresh offeredSlots).
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
        const revisionRuntime = await applyReplayRevisionLoop({
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
          bookingLink: workspaceBookingLink || null,
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
        };
      }
    }

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

    const judgeInput: ReplayJudgeInput = {
      channel: opts.selectionCase.channel,
      leadSentiment: sentimentTag,
      inboundSubject: opts.selectionCase.inboundSubject,
      inboundBody: opts.selectionCase.inboundBody,
      conversationTranscript: transcript,
      generatedDraft,
      serviceDescription: workspaceContext.serviceDescription,
      knowledgeContext: workspaceContext.knowledgeContext,
      companyName: workspaceContext.companyName,
      targetResult: workspaceContext.targetResult,
      observedNextOutbound,
      historicalReplyExamples,
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
      bookingLink: workspaceBookingLink || null,
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
      bookingLink: workspaceBookingLink || null,
      leadSchedulerLink,
    });
    const objectiveCriticalReasons = invariantFailures.map((entry) => `[${entry.code}] ${entry.message}`);
    const objectivePass = objectiveCriticalReasons.length === 0;
    const objectiveOverallScore = objectivePass ? 100 : 0;
    const llmOverallScore = clampScore(judge.llmOverallScore ?? judge.overallScore);
    const blendedScore = clampScore(llmOverallScore * 0.7 + objectiveOverallScore * 0.3);
    const finalPass = objectivePass && blendedScore >= opts.judgeThreshold;
    const finalFailureReasons = finalPass
      ? []
      : [
          ...(!judge.llmPass ? judge.failureReasons : []),
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
      overallScore: blendedScore,
      failureReasons: finalFailureReasons,
      summary: finalSummary,
    };

    const completedAt = new Date();
    const result: ReplayCaseResult = {
      ...resultBase,
      status: "evaluated",
      skipReason: null,
      error: null,
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
      }),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
    };
  }
}
