import "server-only";

import { prisma } from "@/lib/prisma";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
import { selectAutoSendOptimizationContext, type AutoSendOptimizationSelection } from "@/lib/auto-send/optimization-context";
import type { AutoSendEvaluation } from "@/lib/auto-send-evaluator";

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
  confidence: number;
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
    confidence: clamp01(conf),
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
  };
};

export async function maybeReviseAutoSendDraft(opts: {
  clientId: string;
  leadId?: string | null;
  emailCampaignId?: string | null;
  draftId: string;
  channel: "email" | "sms" | "linkedin";
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

    if (!claimRes || typeof (claimRes as any).count !== "number" || (claimRes as any).count <= 0) {
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

  let selection: AutoSendOptimizationSelection | null = null;
  let selectorUsed = false;

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
        model: opts.model ?? "gpt-5.2",
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

  // Best-effort persistence for operator visibility (no raw text).
  try {
    await db.aIDraft.updateMany({
      where: { id: opts.draftId, status: "pending" },
      data: { autoSendRevisionSelectorUsed: selectorUsed },
    });
  } catch {
    // ignore
  }

  const inputJson = JSON.stringify(
    {
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
      optimization_context: selection
        ? {
            selected_context_markdown: selection.selected_context_markdown.slice(0, 2500),
            what_to_apply: selection.what_to_apply.slice(0, 10),
            what_to_avoid: selection.what_to_avoid.slice(0, 10),
            missing_info: selection.missing_info.slice(0, 6),
          }
        : null,
    },
    null,
    2
  );

  const revisedResult = await withDeadline(
    runPrompt<RevisePromptOutput>({
      pattern: "structured_json",
      clientId: opts.clientId,
      leadId: opts.leadId ?? null,
      featureId: "auto_send.revise",
      promptKey: "auto_send.revise.v1",
      model: opts.model ?? "gpt-5.2",
      reasoningEffort: "low",
      temperature: 0,
      systemFallback: "Return ONLY valid JSON with keys: revised_draft, changes_made, issues_addressed, confidence.",
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
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["revised_draft", "changes_made", "issues_addressed", "confidence"],
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
  const improved = revisedConfidence > originalConfidence;

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
    },
  };
}
