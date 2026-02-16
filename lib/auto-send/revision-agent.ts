import "server-only";

import { prisma } from "@/lib/prisma";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
import { selectAutoSendOptimizationContext, type AutoSendOptimizationSelection } from "@/lib/auto-send/optimization-context";
import { coerceAutoSendRevisionModel, coerceAutoSendRevisionReasoningEffort } from "@/lib/auto-send/revision-config";
import type { AutoSendEvaluation } from "@/lib/auto-send-evaluator";
import { buildLeadContextBundle, isLeadContextBundleGloballyDisabled, type LeadContextBundle } from "@/lib/lead-context-bundle";
import { getArtifactsForRun } from "@/lib/draft-pipeline/queries";
import { buildDraftRunContextPack, renderDraftRunContextPackMarkdown } from "@/lib/draft-pipeline/context-pack";
import { validateArtifactPayload } from "@/lib/draft-pipeline/validate-payload";
import { DRAFT_PIPELINE_STAGES } from "@/lib/draft-pipeline/types";
import { persistGovernedMemoryProposals } from "@/lib/memory-governance/persist";
import type { MemoryProposal } from "@/lib/memory-governance/types";
import type { Prisma } from "@prisma/client";

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function redactCommonPii(text: string): string {
  let out = text || "";
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted_email]");
  out = out.replace(/\bhttps?:\/\/[^\s)]+/gi, "[redacted_url]");
  out = out.replace(/\bwww\.[^\s)]+/gi, "[redacted_url]");
  out = out.replace(/(\+?\d[\d\s().-]{7,}\d)/g, (match) => {
    const digits = match.replace(/\D/g, "");
    const suffix = digits.slice(-2);
    return `[redacted_phone..${suffix || "xx"}]`;
  });
  return out;
}

function trimToMaxChars(text: string, maxChars: number): string {
  const raw = String(text || "").trim();
  const limit = Math.max(0, Math.trunc(maxChars));
  if (raw.length <= limit) return raw;
  const sliceLen = Math.max(0, limit - 1);
  return raw.slice(0, sliceLen).trimEnd() + "…";
}

function getChannelMaxChars(channel: "email" | "sms" | "linkedin"): number {
  if (channel === "sms") return 480;
  if (channel === "linkedin") return 1800;
  return 5000;
}

function nowMs(): number {
  return Date.now();
}

async function withDeadline<T>(promise: Promise<T>, deadlineMs: number): Promise<T> {
  const remaining = Math.max(0, deadlineMs - nowMs());
  if (remaining <= 0) {
    throw new Error("deadline_exceeded");
  }
  return await Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error("deadline_exceeded")), remaining)),
  ]);
}

type RevisePromptOutput = {
  revised_draft: string;
  changes_made: string[];
  issues_addressed: string[];
  unresolved_requirements?: string[];
  confidence: number;
  memory_proposals?: MemoryProposal[];
};

type RevisionDraftValidation = {
  passed: boolean;
  reasons: string[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function readStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") out.push(redactCommonPii(item).slice(0, 240));
    if (out.length >= max) break;
  }
  return out;
}

function readMemoryProposals(value: unknown, max: number): MemoryProposal[] {
  if (!Array.isArray(value)) return [];
  const out: MemoryProposal[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const scope = item.scope === "lead" || item.scope === "workspace" ? item.scope : null;
    if (!scope) continue;
    const category = typeof item.category === "string" ? item.category.trim().slice(0, 64) : "";
    const content = typeof item.content === "string" ? item.content.trim().slice(0, 500) : "";
    const ttlDays = typeof item.ttlDays === "number" ? item.ttlDays : Number.parseInt(String(item.ttlDays || ""), 10);
    const confidence = typeof item.confidence === "number" ? item.confidence : Number(item.confidence);
    if (!category || !content) continue;
    if (!Number.isFinite(ttlDays) || ttlDays <= 0) continue;
    if (!Number.isFinite(confidence)) continue;
    out.push({
      scope,
      category,
      content,
      ttlDays: Math.trunc(ttlDays),
      confidence: clamp01(confidence),
    });
    if (out.length >= max) break;
  }
  return out;
}

function validateReviseOutput(value: unknown): RevisePromptOutput | null {
  if (!isPlainObject(value)) return null;
  const draft = typeof value.revised_draft === "string" ? value.revised_draft : "";
  const conf = typeof value.confidence === "number" ? value.confidence : 0;
  return {
    // NOTE: Do NOT redact the actual draft content; it may legitimately include booking links or
    // other contact details needed for sending. PII hygiene is enforced by restricting telemetry
    // metadata, not by mutating outbound message content.
    revised_draft: draft,
    changes_made: readStringArray(value.changes_made, 10),
    issues_addressed: readStringArray(value.issues_addressed, 10),
    unresolved_requirements: readStringArray(value.unresolved_requirements, 10),
    confidence: clamp01(conf),
    memory_proposals: readMemoryProposals(value.memory_proposals, 10),
  };
}

export type AutoSendRevisionResult = {
  revisedDraft: string | null;
  revisedEvaluation: AutoSendEvaluation | null;
  telemetry: {
    attempted: boolean;
    selectorUsed: boolean;
    improved: boolean;
    originalConfidence: number;
    revisedConfidence: number | null;
    threshold: number;
    validationPassed?: boolean;
    validationReasons?: string[];
  };
};

export async function maybeReviseAutoSendDraft(opts: {
  clientId: string;
  leadId?: string | null;
  emailCampaignId?: string | null;
  draftId: string;
  channel: "email" | "sms" | "linkedin";
  draftPipelineRunId?: string | null;
  iteration?: number;
  subject?: string | null;
  latestInbound: string;
  conversationHistory: string;
  draft: string;
  evaluation: AutoSendEvaluation;
  threshold: number;
  reEvaluate: (draft: string) => Promise<AutoSendEvaluation>;
  timeoutMs?: number;
  selectorTimeoutMs?: number;
  reviserTimeoutMs?: number;
  model?: string;
  hardRequirements?: string[];
  hardForbidden?: string[];
  currentDayIso?: string | null;
  leadTimezone?: string | null;
  offeredSlots?: Array<{ label?: string | null; datetime?: string | null; offeredAt?: string | null }> | null;
  bookingLink?: string | null;
  leadSchedulerLink?: string | null;
  reviewFeedback?: {
    summary?: string | null;
    failureReasons?: string[];
    suggestedFixes?: string[];
    decisionContract?: Record<string, unknown> | null;
    judgeScore?: number | null;
    judgePass?: boolean | null;
  } | null;
  validateRevisedDraft?: (draft: string) => RevisionDraftValidation | Promise<RevisionDraftValidation>;
  optimizationContext?: AutoSendOptimizationSelection | null;
  selectOptimizationContext?: typeof selectAutoSendOptimizationContext;
  runPrompt?: typeof runStructuredJsonPrompt;
  db?: typeof prisma;
}): Promise<AutoSendRevisionResult> {
  const originalConfidence = clamp01(Number(opts.evaluation.confidence));
  const threshold = clamp01(Number(opts.threshold));
  const killSwitch = process.env.AUTO_SEND_REVISION_DISABLED === "1";

  if (killSwitch) {
    return {
      revisedDraft: null,
      revisedEvaluation: null,
      telemetry: { attempted: false, selectorUsed: false, improved: false, originalConfidence, revisedConfidence: null, threshold },
    };
  }

  const source = opts.evaluation.source ?? "model";
  if (source === "hard_block" || opts.evaluation.hardBlockCode) {
    return {
      revisedDraft: null,
      revisedEvaluation: null,
      telemetry: { attempted: false, selectorUsed: false, improved: false, originalConfidence, revisedConfidence: null, threshold },
    };
  }

  if (originalConfidence >= threshold) {
    return {
      revisedDraft: null,
      revisedEvaluation: null,
      telemetry: { attempted: false, selectorUsed: false, improved: false, originalConfidence, revisedConfidence: null, threshold },
    };
  }

  const deadlineMs = nowMs() + Math.max(5_000, Math.min(120_000, Math.trunc(opts.timeoutMs ?? 35_000)));
  const runPrompt = opts.runPrompt ?? runStructuredJsonPrompt;
  const db = opts.db ?? prisma;
  const selectOptimization = opts.selectOptimizationContext ?? selectAutoSendOptimizationContext;

  const iteration =
    typeof opts.iteration === "number" && Number.isFinite(opts.iteration) ? Math.max(0, Math.trunc(opts.iteration)) : 0;
  const allowRepeatAttempts = iteration > 0;

  // Retry-safety: claim a one-time revision attempt up front so job retries don't repeatedly
  // burn tokens/latency attempting selector+reviser calls.
  try {
    const claimRes = await db.aIDraft.updateMany({
      where: { id: opts.draftId, status: "pending", autoSendRevisionAttemptedAt: null },
      data: {
        autoSendRevisionAttemptedAt: new Date(),
        autoSendOriginalConfidence: originalConfidence,
        autoSendRevisionApplied: false,
      },
    });

    if (
      !allowRepeatAttempts &&
      (!claimRes || typeof (claimRes as any).count !== "number" || (claimRes as any).count <= 0)
    ) {
      return {
        revisedDraft: null,
        revisedEvaluation: null,
        telemetry: { attempted: false, selectorUsed: false, improved: false, originalConfidence, revisedConfidence: null, threshold },
      };
    }
  } catch {
    // Fail closed: if we can't persist the attempt claim, don't attempt revision.
    return {
      revisedDraft: null,
      revisedEvaluation: null,
      telemetry: { attempted: false, selectorUsed: false, improved: false, originalConfidence, revisedConfidence: null, threshold },
    };
  }

  // Best-effort: read per-workspace revision model configuration. (Tests may inject a db stub without this API.)
  let workspaceSettings: {
    clientId: string;
    leadContextBundleEnabled: boolean;
    leadContextBundleBudgets: Prisma.JsonValue;
    serviceDescription: string | null;
    aiGoals: string | null;
    autoSendRevisionModel: string | null;
    autoSendRevisionReasoningEffort: string | null;
    memoryAllowlistCategories: string[];
    memoryMinConfidence: number;
    memoryMinTtlDays: number;
    memoryTtlCapDays: number;
  } | null = null;
  try {
    if (typeof (db as any)?.workspaceSettings?.findUnique === "function") {
      workspaceSettings = await (db as any).workspaceSettings.findUnique({
        where: { clientId: opts.clientId },
        select: {
          clientId: true,
          leadContextBundleEnabled: true,
          leadContextBundleBudgets: true,
          serviceDescription: true,
          aiGoals: true,
          autoSendRevisionModel: true,
          autoSendRevisionReasoningEffort: true,
          memoryAllowlistCategories: true,
          memoryMinConfidence: true,
          memoryMinTtlDays: true,
          memoryTtlCapDays: true,
        },
      });
    }
  } catch {
    // ignore
  }

  const revisionModel = coerceAutoSendRevisionModel(
    opts.model ?? workspaceSettings?.autoSendRevisionModel ?? process.env.AUTO_SEND_REVISION_MODEL ?? null
  );
  const { api: revisionReasoningEffort } = coerceAutoSendRevisionReasoningEffort({
    model: revisionModel,
    storedValue: workspaceSettings?.autoSendRevisionReasoningEffort ?? process.env.AUTO_SEND_REVISION_REASONING_EFFORT ?? null,
  });

  let selection: AutoSendOptimizationSelection | null = null;
  let selectorUsed = false;

  if (typeof opts.optimizationContext !== "undefined") {
    selection = opts.optimizationContext;
    selectorUsed = Boolean(selection);
  } else {
    try {
      const selectorResult = await withDeadline(
        selectOptimization({
          clientId: opts.clientId,
          leadId: opts.leadId ?? null,
          emailCampaignId: opts.emailCampaignId ?? null,
          channel: opts.channel,
          subject: opts.subject ?? null,
          latestInbound: opts.latestInbound,
          draft: opts.draft,
          evaluatorReason: opts.evaluation.reason,
          timeoutMs: Math.max(1_000, Math.trunc(opts.selectorTimeoutMs ?? 10_000)),
          model: revisionModel,
        }).then((res) => res.selection),
        deadlineMs
      );

      if (selectorResult) {
        selection = selectorResult;
        selectorUsed = true;
      }
    } catch {
      // Fail closed: selector is best-effort; proceed without optimization context.
    }
  }

  // Best-effort persistence for operator visibility (no raw text).
  try {
    await db.aIDraft.updateMany({
      where: { id: opts.draftId, status: "pending" },
      data: { autoSendRevisionSelectorUsed: selectorUsed },
    });
  } catch {
    // ignore
  }

  const runId = (opts.draftPipelineRunId || "").trim() || null;

  const persistDraftPipelineArtifact = async (params: {
    stage: string;
    iteration: number;
    promptKey?: string | null;
    model?: string | null;
    payload?: unknown;
    text?: string | null;
  }): Promise<void> => {
    if (!runId) return;
    if (typeof (db as any)?.draftPipelineArtifact?.upsert !== "function") return;

    const it = Math.max(0, Math.trunc(params.iteration));
    const payload = validateArtifactPayload(params.payload);

    const createOrUpdate = {
      ...(params.promptKey ? { promptKey: params.promptKey } : {}),
      ...(params.model ? { model: params.model } : {}),
      ...(payload !== null ? { payload } : {}),
      ...(params.text ? { text: params.text } : {}),
    };

    try {
      await (db as any).draftPipelineArtifact.upsert({
        where: {
          runId_stage_iteration: {
            runId,
            stage: params.stage,
            iteration: it,
          },
        },
        create: {
          runId,
          stage: params.stage,
          iteration: it,
          ...createOrUpdate,
        },
        update: createOrUpdate,
        select: { id: true },
      });
    } catch (error) {
      console.warn("[AutoSendRevision] Failed to persist DraftPipelineArtifact; continuing", {
        clientId: opts.clientId,
        leadId: opts.leadId ?? null,
        draftId: opts.draftId,
        runId,
        stage: params.stage,
        iteration: it,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // Always record the input evaluation (iteration-1), best-effort, so loop retries can reuse it.
  if (runId && iteration > 0) {
    await persistDraftPipelineArtifact({
      stage: DRAFT_PIPELINE_STAGES.autoSendEvaluation,
      iteration: iteration - 1,
      payload: opts.evaluation,
    });
  }

  // Best-effort cache hit path: if we already produced the revision + evaluation for this iteration, reuse it.
  // This prevents re-running LLM calls on background job retries.
  if (runId && iteration > 0) {
    try {
      const artifacts = await withDeadline(getArtifactsForRun(runId), deadlineMs);
      const cachedLoopError = artifacts.find(
        (a) => a.stage === DRAFT_PIPELINE_STAGES.loopError && a.iteration === iteration
      );
      if (cachedLoopError) {
        return {
          revisedDraft: null,
          revisedEvaluation: null,
          telemetry: {
            attempted: false,
            selectorUsed: false,
            improved: false,
            originalConfidence,
            revisedConfidence: null,
            threshold,
          },
        };
      }

      const cachedRevision = artifacts.find(
        (a) => a.stage === DRAFT_PIPELINE_STAGES.autoSendRevisionReviser && a.iteration === iteration
      );
      const cachedEval = artifacts.find(
        (a) => a.stage === DRAFT_PIPELINE_STAGES.autoSendEvaluation && a.iteration === iteration
      );

      const cachedDraft = typeof cachedRevision?.text === "string" ? cachedRevision.text.trim() : "";
      const cachedEvalPayload = cachedEval?.payload ?? null;
      const cachedRevisionPayload = cachedRevision?.payload ?? null;

      const cachedImproved =
        cachedRevisionPayload &&
        typeof cachedRevisionPayload === "object" &&
        typeof (cachedRevisionPayload as any).improved === "boolean"
          ? Boolean((cachedRevisionPayload as any).improved)
          : null;

      if (cachedImproved === false) {
        return {
          revisedDraft: null,
          revisedEvaluation: null,
          telemetry: {
            attempted: false,
            selectorUsed: Boolean(
              cachedRevisionPayload &&
                typeof cachedRevisionPayload === "object" &&
                Boolean((cachedRevisionPayload as any).selectorUsed)
            ),
            improved: false,
            originalConfidence,
            revisedConfidence: null,
            threshold,
          },
        };
      }

      if (cachedDraft && cachedEvalPayload && typeof cachedEvalPayload === "object") {
        const anyEval = cachedEvalPayload as any;
        const revisedEvaluation: AutoSendEvaluation | null =
          typeof anyEval.confidence === "number" &&
          typeof anyEval.safeToSend === "boolean" &&
          typeof anyEval.requiresHumanReview === "boolean" &&
          typeof anyEval.reason === "string"
            ? {
                confidence: clamp01(Number(anyEval.confidence)),
                safeToSend: Boolean(anyEval.safeToSend),
                requiresHumanReview: Boolean(anyEval.requiresHumanReview),
                reason: String(anyEval.reason || "").slice(0, 320) || "No reason provided",
                ...(anyEval.source ? { source: anyEval.source } : {}),
                ...(anyEval.hardBlockCode ? { hardBlockCode: anyEval.hardBlockCode } : {}),
              }
            : null;

        if (revisedEvaluation) {
          // Best-effort: ensure the draft row reflects the cached best content.
          try {
            await db.aIDraft.updateMany({
              where: { id: opts.draftId, status: "pending" },
              data: { content: cachedDraft },
            });
          } catch {
            // ignore
          }

          return {
            revisedDraft: cachedDraft,
            revisedEvaluation,
            telemetry: {
              attempted: false,
              selectorUsed: Boolean(cachedRevisionPayload && typeof cachedRevisionPayload === "object" && (cachedRevisionPayload as any).selectorUsed),
              improved: cachedImproved === true ? true : revisedEvaluation.confidence > originalConfidence,
              originalConfidence,
              revisedConfidence: revisedEvaluation.confidence,
              threshold,
            },
          };
        }
      }
    } catch {
      // ignore cache failures
    }
  }

  let leadContextBundle: LeadContextBundle | null = null;
  if (
    runId &&
    opts.leadId &&
    Boolean(workspaceSettings?.leadContextBundleEnabled) &&
    !isLeadContextBundleGloballyDisabled()
  ) {
    try {
      leadContextBundle = await withDeadline(
        buildLeadContextBundle({
          clientId: opts.clientId,
          leadId: opts.leadId,
          profile: "revision",
          timeoutMs: 700,
          settings: workspaceSettings,
        }),
        deadlineMs
      );
    } catch {
      // ignore
    }
  }

  let contextPackMarkdown: string | null = null;
  let contextPackChars: number | null = null;

  if (runId) {
    try {
      const artifacts = await withDeadline(getArtifactsForRun(runId), deadlineMs);
      const pack = buildDraftRunContextPack({
        runId,
        iteration,
        draft: opts.draft,
        evaluation: opts.evaluation,
        threshold,
        artifacts,
        leadContextBundle,
        optimizationContext: selection,
      });
      contextPackChars = pack.stats.totalChars;
      contextPackMarkdown = renderDraftRunContextPackMarkdown(pack);
    } catch {
      // ignore
    }
  }

  const hardRequirements = Array.from(new Set((opts.hardRequirements || []).map((entry) => String(entry || "").trim()).filter(Boolean))).slice(0, 12);
  const hardForbidden = Array.from(new Set((opts.hardForbidden || []).map((entry) => String(entry || "").trim()).filter(Boolean))).slice(0, 12);
  const reviewFeedback =
    opts.reviewFeedback && typeof opts.reviewFeedback === "object"
      ? {
          summary:
            typeof opts.reviewFeedback.summary === "string" && opts.reviewFeedback.summary.trim()
              ? opts.reviewFeedback.summary.trim().slice(0, 400)
              : null,
          failure_reasons: Array.from(
            new Set(
              (opts.reviewFeedback.failureReasons || [])
                .map((entry) => String(entry || "").replace(/\s+/g, " ").trim())
                .filter(Boolean)
            )
          ).slice(0, 10),
          suggested_fixes: Array.from(
            new Set(
              (opts.reviewFeedback.suggestedFixes || [])
                .map((entry) => String(entry || "").replace(/\s+/g, " ").trim())
                .filter(Boolean)
            )
          ).slice(0, 10),
          decision_contract:
            opts.reviewFeedback.decisionContract && typeof opts.reviewFeedback.decisionContract === "object"
              ? opts.reviewFeedback.decisionContract
              : null,
          judge_score:
            typeof opts.reviewFeedback.judgeScore === "number" && Number.isFinite(opts.reviewFeedback.judgeScore)
              ? opts.reviewFeedback.judgeScore
              : null,
          judge_pass: typeof opts.reviewFeedback.judgePass === "boolean" ? opts.reviewFeedback.judgePass : null,
        }
      : null;
  const offeredSlots = (opts.offeredSlots || [])
    .map((slot) => {
      const label = String(slot?.label || "").trim();
      const datetime = String(slot?.datetime || "").trim();
      return [label, datetime].filter(Boolean).join(" | ");
    })
    .filter(Boolean)
    .slice(0, 8);
  const hardConstraints = {
    hard_requirements: hardRequirements,
    hard_forbidden: hardForbidden,
    current_day_iso: (opts.currentDayIso || new Date().toISOString()).trim(),
    lead_timezone: (opts.leadTimezone || "UNKNOWN").trim() || "UNKNOWN",
    offered_slots_verbatim: offeredSlots,
    booking_link: (opts.bookingLink || "").trim() || null,
    lead_scheduler_link: (opts.leadSchedulerLink || "").trim() || null,
  };

  const inputObject = contextPackMarkdown
    ? {
        context_pack: { runId, iteration, chars: contextPackChars },
        context_pack_markdown: trimToMaxChars(contextPackMarkdown, 24_000),
        review_feedback: reviewFeedback,
        hard_constraints: hardConstraints,
        case: {
          channel: opts.channel,
          subject: (opts.subject || "").slice(0, 300),
          latest_inbound: (opts.latestInbound || "").slice(0, 1800),
          conversation_history: (opts.conversationHistory || "").slice(0, 6000),
        },
      }
    : {
        case: {
          channel: opts.channel,
          subject: (opts.subject || "").slice(0, 300),
          latest_inbound: (opts.latestInbound || "").slice(0, 1800),
          conversation_history: (opts.conversationHistory || "").slice(0, 6000),
          current_draft: (opts.draft || "").slice(0, 2400),
          evaluator: {
            confidence: originalConfidence,
            threshold,
            reason: String(opts.evaluation.reason || "").slice(0, 400),
          },
        },
        review_feedback: reviewFeedback,
        hard_constraints: hardConstraints,
        optimization_context: selection
          ? {
              selected_context_markdown: selection.selected_context_markdown.slice(0, 2500),
              what_to_apply: selection.what_to_apply.slice(0, 10),
              what_to_avoid: selection.what_to_avoid.slice(0, 10),
              missing_info: selection.missing_info.slice(0, 6),
            }
          : null,
      };

  const inputJson = JSON.stringify(inputObject, null, 2);

  // Best-effort: persist selector output for cross-agent context. (No PII; selection is redacted.)
  if (runId && iteration > 0) {
    await persistDraftPipelineArtifact({
      stage: DRAFT_PIPELINE_STAGES.autoSendRevisionSelector,
      iteration,
      payload: selection ? { selectorUsed: true, selection } : { selectorUsed: false },
    });
  }

  const revisedResult = await withDeadline(
    runPrompt<RevisePromptOutput>({
      pattern: "structured_json",
      clientId: opts.clientId,
      leadId: opts.leadId ?? null,
      featureId: "auto_send.revise",
      promptKey: "auto_send.revise.v1",
      model: revisionModel,
      reasoningEffort: revisionReasoningEffort,
      temperature: 0,
      systemFallback:
        "Return ONLY valid JSON with keys: revised_draft, changes_made, issues_addressed, unresolved_requirements, confidence, memory_proposals.",
      templateVars: { inputJson },
      schemaName: "auto_send_revise",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          revised_draft: { type: "string" },
          changes_made: { type: "array", items: { type: "string" } },
          issues_addressed: { type: "array", items: { type: "string" } },
          unresolved_requirements: { type: "array", items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          memory_proposals: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                scope: { type: "string", enum: ["lead", "workspace"] },
                category: { type: "string" },
                content: { type: "string" },
                ttlDays: { type: "number" },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["scope", "category", "content", "ttlDays", "confidence"],
            },
          },
        },
        required: [
          "revised_draft",
          "changes_made",
          "issues_addressed",
          "unresolved_requirements",
          "confidence",
          "memory_proposals",
        ],
      },
      budget: {
        min: 240,
        max: 1100,
        retryMax: 1700,
        overheadTokens: 520,
        outputScale: 0.25,
        preferApiCount: true,
      },
      timeoutMs: Math.max(1_000, Math.trunc(opts.reviserTimeoutMs ?? 10_000)),
      maxRetries: 0,
      metadata: {
        autoSendRevision: {
          stage: "revise",
          selectorUsed,
          originalConfidence,
          threshold,
          iteration,
          model: revisionModel,
          reasoningEffort: revisionReasoningEffort,
          contextPackUsed: Boolean(contextPackMarkdown),
          contextPackChars,
          hardRequirementsCount: hardRequirements.length,
          hardForbiddenCount: hardForbidden.length,
          offeredSlotsCount: offeredSlots.length,
        },
      },
      validate: (value) => {
        const validated = validateReviseOutput(value);
        if (!validated) return { success: false, error: "Invalid revise output" };
        return { success: true, data: validated };
      },
    }).then((res) => (res.success ? res.data : null)),
    deadlineMs
  );

  if (!revisedResult?.revised_draft) {
    if (runId && iteration > 0) {
      await persistDraftPipelineArtifact({
        stage: DRAFT_PIPELINE_STAGES.loopError,
        iteration,
        payload: { error: "missing_revised_draft" },
      });
    }
    return {
      revisedDraft: null,
      revisedEvaluation: null,
      telemetry: { attempted: true, selectorUsed, improved: false, originalConfidence, revisedConfidence: null, threshold },
    };
  }

  const maxChars = getChannelMaxChars(opts.channel);
  const revisedDraft = trimToMaxChars(revisedResult.revised_draft, maxChars);
  if (!revisedDraft.trim()) {
    return {
      revisedDraft: null,
      revisedEvaluation: null,
      telemetry: { attempted: true, selectorUsed, improved: false, originalConfidence, revisedConfidence: null, threshold },
    };
  }

  const revisedEvaluation = await withDeadline(opts.reEvaluate(revisedDraft), deadlineMs);
  const revisedConfidence = clamp01(Number(revisedEvaluation.confidence));
  let validationPassed = true;
  let validationReasons: string[] = [];
  if (Array.isArray(revisedResult.unresolved_requirements) && revisedResult.unresolved_requirements.length > 0) {
    validationPassed = false;
    validationReasons = revisedResult.unresolved_requirements.slice(0, 10);
  }
  if (validationPassed && typeof opts.validateRevisedDraft === "function") {
    try {
      const validation = await opts.validateRevisedDraft(revisedDraft);
      validationPassed = Boolean(validation?.passed);
      validationReasons = Array.isArray(validation?.reasons) ? validation.reasons.slice(0, 10) : [];
    } catch (error) {
      validationPassed = false;
      validationReasons = [
        `revision_validation_error:${error instanceof Error ? error.message : String(error)}`.slice(0, 240),
      ];
    }
  }

  const improvedByConfidence = revisedConfidence > originalConfidence || revisedConfidence >= threshold;
  const improved = improvedByConfidence && validationPassed;

  const memoryProposals = Array.isArray(revisedResult.memory_proposals) ? revisedResult.memory_proposals : [];
  if (memoryProposals.length > 0) {
    try {
      const persistResult = await persistGovernedMemoryProposals({
        clientId: opts.clientId,
        leadId: opts.leadId ?? null,
        draftId: opts.draftId,
        draftPipelineRunId: runId,
        proposals: memoryProposals,
        policy: {
          allowlistCategories: workspaceSettings?.memoryAllowlistCategories ?? [],
          minConfidence: workspaceSettings?.memoryMinConfidence,
          minTtlDays: workspaceSettings?.memoryMinTtlDays,
          ttlCapDays: workspaceSettings?.memoryTtlCapDays,
        },
        db,
      });

      if (runId && iteration > 0) {
        await persistDraftPipelineArtifact({
          stage: DRAFT_PIPELINE_STAGES.memoryProposal,
          iteration,
          payload: {
            totalProposed: memoryProposals.length,
            approvedCount: persistResult.approvedCount,
            pendingCount: persistResult.pendingCount,
            droppedCount: persistResult.droppedCount,
            persistedCount: persistResult.proposals.length,
            proposals: persistResult.proposals,
          },
        });
      }
    } catch (error) {
      if (runId && iteration > 0) {
        await persistDraftPipelineArtifact({
          stage: DRAFT_PIPELINE_STAGES.memoryProposal,
          iteration,
          payload: {
            totalProposed: memoryProposals.length,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }

  if (runId && iteration > 0) {
    await persistDraftPipelineArtifact({
      stage: DRAFT_PIPELINE_STAGES.autoSendRevisionReviser,
      iteration,
      payload: {
        selectorUsed,
        improved,
        improvedByConfidence,
        validationPassed,
        validationReasons,
        originalConfidence,
        revisedConfidence,
        changesMade: revisedResult.changes_made,
        issuesAddressed: revisedResult.issues_addressed,
        unresolvedRequirements: revisedResult.unresolved_requirements || [],
      },
      text: revisedDraft,
    });

    await persistDraftPipelineArtifact({
      stage: DRAFT_PIPELINE_STAGES.autoSendEvaluation,
      iteration,
      payload: revisedEvaluation,
    });
  }

  // Best-effort persistence for operator visibility (no raw text).
  try {
    await db.aIDraft.updateMany({
      where: { id: opts.draftId, status: "pending" },
      data: { autoSendRevisionConfidence: revisedConfidence },
    });
  } catch {
    // ignore
  }

  if (improved) {
    // Persist the improved draft so downstream send paths read the updated content.
    const updateRes = await db.aIDraft.updateMany({
      where: { id: opts.draftId, status: "pending" },
      data: {
        content: revisedDraft,
        autoSendRevisionApplied: true,
        autoSendRevisionConfidence: revisedConfidence,
        autoSendRevisionSelectorUsed: selectorUsed,
        autoSendRevisionIterations: iteration > 0 ? iteration : 0,
      },
    });
    if (!updateRes || typeof (updateRes as any).count !== "number" || (updateRes as any).count <= 0) {
      return {
        revisedDraft: null,
        revisedEvaluation: null,
        telemetry: {
          attempted: true,
          selectorUsed,
          improved: false,
          originalConfidence,
          revisedConfidence,
          threshold,
        },
      };
    }

    return {
      revisedDraft,
      revisedEvaluation,
      telemetry: {
        attempted: true,
        selectorUsed,
        improved: true,
        originalConfidence,
        revisedConfidence,
        threshold,
        validationPassed,
        validationReasons,
      },
    };
  }

  return {
    revisedDraft: null,
    revisedEvaluation: null,
    telemetry: {
      attempted: true,
      selectorUsed,
      improved: false,
      originalConfidence,
      revisedConfidence,
      threshold,
      validationPassed,
      validationReasons,
    },
  };
}
