"use server";

import { prisma } from "@/lib/prisma";
import { requireClientAdminAccess } from "@/lib/workspace-access";
import {
  listAIPromptTemplates,
  computePromptMessageBaseHash,
  type PromptRole,
} from "@/lib/ai/prompt-registry";
import { SNIPPET_DEFAULTS } from "@/lib/ai/prompt-snippets";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { pruneOldAIInteractionsMaybe } from "@/lib/ai/retention";
import { AI_ROUTE_SKIP_FEATURE_ID } from "@/lib/ai/route-skip-observability";

export type AiObservabilityWindow = "24h" | "7d" | "30d";

export type AiPromptTemplatePublic = {
  key: string;
  featureId: string;
  name: string;
  description: string;
  model: string;
  apiType: "responses" | "chat_completions";
  messages: Array<{ role: "system" | "assistant" | "user"; content: string }>;
};

export type FeatureSummary = {
  featureId: string;
  name: string;
  model: string;
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgLatencyMs: number | null;
  lastUsedAt: string | null;
  estimatedCostUsd: number | null;
  costComplete: boolean;
};

export type SourceSummary = {
  source: string | null;
  name: string;
  model: string;
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgLatencyMs: number | null;
  lastUsedAt: string | null;
  estimatedCostUsd: number | null;
  costComplete: boolean;
};

export type TotalsSummary = {
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgLatencyMs: number | null;
  estimatedCostUsd: number;
  costComplete: boolean;
};

export type ErrorSample = {
  at: string;
  message: string;
};

export type ErrorSampleGroup = {
  featureId: string;
  name: string;
  model: string;
  errors: number;
  samples: ErrorSample[];
};

export type AiRouteSkipSummary = {
  window: AiObservabilityWindow;
  rangeStart: string;
  rangeEnd: string;
  counts: {
    draftGeneration: number;
    draftGenerationStep2: number;
    draftVerificationStep3: number;
    meetingOverseer: number;
  };
  events: Array<{
    id: string;
    createdAt: string;
    route: "draft_generation" | "draft_generation_step2" | "draft_verification_step3" | "meeting_overseer";
    source: string | null;
    leadId: string | null;
    channel: string | null;
    reason: string;
  }>;
};

// =============================================================================
// Prompt Override Types (Phase 47)
// =============================================================================

export type PromptOverrideInput = {
  promptKey: string;
  role: PromptRole;
  index: number;
  content: string;
};

export type PromptOverrideRecord = {
  promptKey: string;
  role: string;
  index: number;
  content: string;
  baseContentHash: string;
  updatedAt: string;
  codeBaseHash: string | null;
  isDrifted: boolean;
};

export type ObservabilitySummary = {
  window: AiObservabilityWindow;
  rangeStart: string;
  rangeEnd: string;
  totals: TotalsSummary;
  sources: SourceSummary[];
  features: FeatureSummary[];
  errorSamples: ErrorSampleGroup[];
};

async function requireWorkspaceAdmin(clientId: string): Promise<{ userId: string; userEmail: string | null }> {
  return requireClientAdminAccess(clientId);
}

function windowToMs(window: AiObservabilityWindow): number {
  switch (window) {
    case "24h":
      return 24 * 60 * 60 * 1000;
    case "7d":
      return 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return 30 * 24 * 60 * 60 * 1000;
  }
}

function roundCurrencyUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

const FEATURE_NAME_BY_ID = (() => {
  const map = new Map<string, string>();
  for (const t of listAIPromptTemplates()) {
    const featureId = typeof (t as any)?.featureId === "string" ? String((t as any).featureId) : null;
    const name = typeof (t as any)?.name === "string" ? String((t as any).name) : null;
    if (!featureId || !name) continue;
    if (!map.has(featureId)) map.set(featureId, name);
  }
  return map;
})();

function buildFeatureName(featureId: string): string {
  const fromRegistry = FEATURE_NAME_BY_ID.get(featureId);
  if (fromRegistry) return fromRegistry;

  const fallback: Record<string, string> = {
    "knowledge_assets.summarize_text": "Knowledge Assets: Summarize Text",
    "knowledge_assets.ocr_pdf": "Knowledge Assets: OCR PDF",
    "knowledge_assets.ocr_image": "Knowledge Assets: OCR Image",
    "insights.answer_judge": "Insights: Answer Judge",
  };

  return fallback[featureId] || featureId;
}

function buildSourceName(source: string | null): string {
  if (!source) return "Unattributed";
  if (source.startsWith("action:")) {
    const rest = source.slice("action:".length).trim();
    return rest ? `Action: ${rest}` : "Action";
  }
  return source;
}

const ROUTE_PROMPT_KEYS = {
  draftGeneration: "ai.route_skip.draft_generation.v1",
  draftGenerationStep2: "ai.route_skip.draft_generation_step2.v1",
  draftVerificationStep3: "ai.route_skip.draft_verification_step3.v1",
  meetingOverseerDraft: "ai.route_skip.meeting_overseer_draft.v1",
  meetingOverseerFollowup: "ai.route_skip.meeting_overseer_followup.v1",
} as const;

function mapRouteFromPromptKey(
  promptKey: string | null
): "draft_generation" | "draft_generation_step2" | "draft_verification_step3" | "meeting_overseer" {
  if (promptKey === ROUTE_PROMPT_KEYS.draftGenerationStep2) return "draft_generation_step2";
  if (promptKey === ROUTE_PROMPT_KEYS.draftVerificationStep3) return "draft_verification_step3";
  if (
    promptKey === ROUTE_PROMPT_KEYS.meetingOverseerDraft ||
    promptKey === ROUTE_PROMPT_KEYS.meetingOverseerFollowup
  ) {
    return "meeting_overseer";
  }
  return "draft_generation";
}

export async function getAiPromptTemplates(clientId: string): Promise<{
  success: boolean;
  templates?: AiPromptTemplatePublic[];
  error?: string;
}> {
  try {
    await requireWorkspaceAdmin(clientId);
    return { success: true, templates: listAIPromptTemplates() as AiPromptTemplatePublic[] };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load prompts" };
  }
}

export async function getAiObservabilitySummary(
  clientId: string,
  window: AiObservabilityWindow = "24h"
): Promise<{ success: boolean; data?: ObservabilitySummary; error?: string }> {
  try {
    await requireWorkspaceAdmin(clientId);

    // Best-effort retention enforcement.
    await pruneOldAIInteractionsMaybe();

    const rangeEnd = new Date();
    const rangeStart = new Date(rangeEnd.getTime() - windowToMs(window));

    const groups = await prisma.aIInteraction.groupBy({
      by: ["featureId", "model", "status"],
      where: {
        clientId,
        createdAt: { gte: rangeStart, lte: rangeEnd },
      },
      _count: { _all: true },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        latencyMs: true,
      },
      _max: { createdAt: true },
    });

    const sourceGroups = await prisma.aIInteraction.groupBy({
      by: ["source", "model", "status"],
      where: {
        clientId,
        createdAt: { gte: rangeStart, lte: rangeEnd },
      },
      _count: { _all: true },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        latencyMs: true,
      },
      _max: { createdAt: true },
    });

    type Key = `${string}::${string}`;
    const perFeatureModel = new Map<Key, {
      featureId: string;
      model: string;
      calls: number;
      errors: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      latencySum: number;
      lastUsedAt: Date | null;
    }>();

    for (const g of groups) {
      const key = `${g.featureId}::${g.model}` as Key;
      const current = perFeatureModel.get(key) || {
        featureId: g.featureId,
        model: g.model,
        calls: 0,
        errors: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        latencySum: 0,
        lastUsedAt: null as Date | null,
      };

      const count = g._count._all || 0;
      const inputTokens = g._sum.inputTokens || 0;
      const outputTokens = g._sum.outputTokens || 0;
      const totalTokens = g._sum.totalTokens || 0;
      const latencySum = g._sum.latencyMs || 0;

      current.calls += count;
      current.inputTokens += inputTokens;
      current.outputTokens += outputTokens;
      current.totalTokens += totalTokens;
      current.latencySum += latencySum;
      if (g.status === "error") current.errors += count;

      const last = g._max.createdAt || null;
      if (last && (!current.lastUsedAt || last > current.lastUsedAt)) {
        current.lastUsedAt = last;
      }

      perFeatureModel.set(key, current);
    }

    const perSourceModel = new Map<Key, {
      source: string | null;
      model: string;
      calls: number;
      errors: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      latencySum: number;
      lastUsedAt: Date | null;
    }>();

    for (const g of sourceGroups) {
      const sourceKey = (g as any).source ?? null;
      const key = `${sourceKey ?? "\u0000"}::${g.model}` as Key;
      const current = perSourceModel.get(key) || {
        source: sourceKey,
        model: g.model,
        calls: 0,
        errors: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        latencySum: 0,
        lastUsedAt: null as Date | null,
      };

      const count = g._count._all || 0;
      const inputTokens = g._sum.inputTokens || 0;
      const outputTokens = g._sum.outputTokens || 0;
      const totalTokens = g._sum.totalTokens || 0;
      const latencySum = g._sum.latencyMs || 0;

      current.calls += count;
      current.inputTokens += inputTokens;
      current.outputTokens += outputTokens;
      current.totalTokens += totalTokens;
      current.latencySum += latencySum;
      if (g.status === "error") current.errors += count;

      const last = g._max.createdAt || null;
      if (last && (!current.lastUsedAt || last > current.lastUsedAt)) {
        current.lastUsedAt = last;
      }

      perSourceModel.set(key, current);
    }

    const features: FeatureSummary[] = [];
    const sources: SourceSummary[] = [];
    let totalCalls = 0;
    let totalErrors = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalTokens = 0;
    let totalLatencySum = 0;
    let totalCost = 0;
    let costComplete = true;

    for (const row of perFeatureModel.values()) {
      const avgLatencyMs =
        row.calls > 0 ? Math.round(row.latencySum / row.calls) : null;

      const cost = estimateCostUsd({
        model: row.model,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
      });

      if (cost === null) costComplete = false;
      const costUsd = cost === null ? null : roundCurrencyUsd(cost);

      features.push({
        featureId: row.featureId,
        name: buildFeatureName(row.featureId),
        model: row.model,
        calls: row.calls,
        errors: row.errors,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        avgLatencyMs,
        lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
        estimatedCostUsd: costUsd,
        costComplete: cost !== null,
      });

      totalCalls += row.calls;
      totalErrors += row.errors;
      totalInput += row.inputTokens;
      totalOutput += row.outputTokens;
      totalTokens += row.totalTokens;
      totalLatencySum += row.latencySum;
      if (cost !== null) totalCost += cost;
    }

    for (const row of perSourceModel.values()) {
      const avgLatencyMs =
        row.calls > 0 ? Math.round(row.latencySum / row.calls) : null;

      const cost = estimateCostUsd({
        model: row.model,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
      });

      const costUsd = cost === null ? null : roundCurrencyUsd(cost);

      sources.push({
        source: row.source,
        name: buildSourceName(row.source),
        model: row.model,
        calls: row.calls,
        errors: row.errors,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        avgLatencyMs,
        lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
        estimatedCostUsd: costUsd,
        costComplete: cost !== null,
      });
    }

    features.sort((a, b) => b.calls - a.calls);
    sources.sort((a, b) => b.calls - a.calls);

    const totalsAvgLatencyMs =
      totalCalls > 0 ? Math.round(totalLatencySum / totalCalls) : null;

    const recentErrors = await prisma.aIInteraction.findMany({
      where: {
        clientId,
        status: "error",
        createdAt: { gte: rangeStart, lte: rangeEnd },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        featureId: true,
        model: true,
        createdAt: true,
        errorMessage: true,
      },
    });

    const errorSampleGroups = new Map<Key, ErrorSampleGroup>();
    for (const row of recentErrors) {
      const key = `${row.featureId}::${row.model}` as Key;
      const existing = errorSampleGroups.get(key);
      const base = perFeatureModel.get(key);
      const group =
        existing ||
        ({
          featureId: row.featureId,
          name: buildFeatureName(row.featureId),
          model: row.model,
          errors: base?.errors ?? 0,
          samples: [],
        } satisfies ErrorSampleGroup);

      if (!existing) errorSampleGroups.set(key, group);

      if (group.samples.length < 3) {
        group.samples.push({
          at: row.createdAt.toISOString(),
          message: (row.errorMessage || "Unknown error").trim(),
        });
      }
    }

    const errorSamples = Array.from(errorSampleGroups.values()).sort((a, b) => {
      const byErrors = b.errors - a.errors;
      if (byErrors !== 0) return byErrors;
      const aAt = a.samples[0]?.at || "";
      const bAt = b.samples[0]?.at || "";
      return bAt.localeCompare(aAt);
    });

    const data: ObservabilitySummary = {
      window,
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      totals: {
        calls: totalCalls,
        errors: totalErrors,
        inputTokens: totalInput,
        outputTokens: totalOutput,
        totalTokens,
        avgLatencyMs: totalsAvgLatencyMs,
        estimatedCostUsd: roundCurrencyUsd(totalCost),
        costComplete,
      },
      sources,
      features,
      errorSamples,
    };

    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load AI metrics" };
  }
}

export async function getAiRouteSkipSummary(
  clientId: string,
  window: AiObservabilityWindow = "24h"
): Promise<{ success: boolean; data?: AiRouteSkipSummary; error?: string }> {
  try {
    await requireWorkspaceAdmin(clientId);

    const rangeEnd = new Date();
    const rangeStart = new Date(rangeEnd.getTime() - windowToMs(window));

    const groups = await prisma.aIInteraction.groupBy({
      by: ["promptKey"],
      where: {
        clientId,
        featureId: AI_ROUTE_SKIP_FEATURE_ID,
        createdAt: { gte: rangeStart, lte: rangeEnd },
      },
      _count: { _all: true },
    });

    const counts = {
      draftGeneration: 0,
      draftGenerationStep2: 0,
      draftVerificationStep3: 0,
      meetingOverseer: 0,
    };

    for (const group of groups) {
      const count = group._count._all || 0;
      if (group.promptKey === ROUTE_PROMPT_KEYS.draftGenerationStep2) {
        counts.draftGenerationStep2 += count;
      } else if (group.promptKey === ROUTE_PROMPT_KEYS.draftVerificationStep3) {
        counts.draftVerificationStep3 += count;
      } else if (
        group.promptKey === ROUTE_PROMPT_KEYS.meetingOverseerDraft ||
        group.promptKey === ROUTE_PROMPT_KEYS.meetingOverseerFollowup
      ) {
        counts.meetingOverseer += count;
      } else {
        counts.draftGeneration += count;
      }
    }

    const rows = await prisma.aIInteraction.findMany({
      where: {
        clientId,
        featureId: AI_ROUTE_SKIP_FEATURE_ID,
        createdAt: { gte: rangeStart, lte: rangeEnd },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        createdAt: true,
        source: true,
        leadId: true,
        promptKey: true,
        metadata: true,
      },
    });

    const events = rows.map((row) => {
      const metadata = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, any>) : null;
      const routeSkip =
        metadata && metadata.routeSkip && typeof metadata.routeSkip === "object"
          ? (metadata.routeSkip as Record<string, any>)
          : null;

      return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        route: mapRouteFromPromptKey(row.promptKey),
        source: row.source ?? null,
        leadId: row.leadId ?? null,
        channel: typeof routeSkip?.channel === "string" ? routeSkip.channel : null,
        reason:
          typeof routeSkip?.reason === "string" && routeSkip.reason.trim().length > 0
            ? routeSkip.reason
            : "disabled_by_workspace_settings",
      } as AiRouteSkipSummary["events"][number];
    });

    return {
      success: true,
      data: {
        window,
        rangeStart: rangeStart.toISOString(),
        rangeEnd: rangeEnd.toISOString(),
        counts,
        events,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load AI route skip summary",
    };
  }
}

// =============================================================================
// Prompt Override CRUD (Phase 47)
// =============================================================================

/**
 * Save a prompt override for a workspace.
 * Creates or updates the override, storing a baseContentHash for drift detection.
 */
export async function savePromptOverride(
  clientId: string,
  override: PromptOverrideInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId, userEmail } = await requireWorkspaceAdmin(clientId);

    // Compute baseContentHash from the current registry template (prevents index drift)
    const baseContentHash = computePromptMessageBaseHash({
      promptKey: override.promptKey,
      role: override.role,
      index: override.index,
    });

    if (!baseContentHash) {
      return {
        success: false,
        error: `Invalid prompt message: ${override.promptKey} ${override.role}[${override.index}] does not exist`,
      };
    }

    const saved = await prisma.promptOverride.upsert({
      where: {
        clientId_promptKey_role_index: {
          clientId,
          promptKey: override.promptKey,
          role: override.role,
          index: override.index,
        },
      },
      create: {
        clientId,
        promptKey: override.promptKey,
        role: override.role,
        index: override.index,
        baseContentHash,
        content: override.content,
      },
      update: {
        baseContentHash,
        content: override.content,
      },
      select: { id: true },
    });

    await prisma.promptOverrideRevision.create({
      data: {
        clientId,
        promptOverrideId: saved.id,
        promptKey: override.promptKey,
        role: override.role,
        index: override.index,
        baseContentHash,
        content: override.content,
        action: "UPSERT",
        createdByUserId: userId,
        createdByEmail: userEmail ?? null,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("[savePromptOverride] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save override",
    };
  }
}

/**
 * Reset a specific prompt message to default (delete override).
 */
export async function resetPromptOverride(
  clientId: string,
  promptKey: string,
  role: string,
  index: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId, userEmail } = await requireWorkspaceAdmin(clientId);

    const existing = await prisma.promptOverride.findFirst({
      where: { clientId, promptKey, role, index },
      select: { id: true, baseContentHash: true, content: true },
    });

    await prisma.promptOverride.deleteMany({
      where: { clientId, promptKey, role, index },
    });

    if (existing) {
      await prisma.promptOverrideRevision.create({
        data: {
          clientId,
          promptOverrideId: existing.id,
          promptKey,
          role,
          index,
          baseContentHash: existing.baseContentHash,
          content: existing.content,
          action: "RESET",
          createdByUserId: userId,
          createdByEmail: userEmail ?? null,
        },
      });
    }

    return { success: true };
  } catch (error) {
    console.error("[resetPromptOverride] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to reset override",
    };
  }
}

/**
 * Reset all overrides for a prompt (restore entire prompt to defaults).
 */
export async function resetAllPromptOverrides(
  clientId: string,
  promptKey: string
): Promise<{ success: boolean; deletedCount?: number; error?: string }> {
  try {
    await requireWorkspaceAdmin(clientId);

    const result = await prisma.promptOverride.deleteMany({
      where: { clientId, promptKey },
    });

    return { success: true, deletedCount: result.count };
  } catch (error) {
    console.error("[resetAllPromptOverrides] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to reset overrides",
    };
  }
}

/**
 * Get all overrides for a workspace (for displaying in UI).
 */
export async function getPromptOverrides(clientId: string): Promise<{
  success: boolean;
  overrides?: PromptOverrideRecord[];
  error?: string;
}> {
  try {
    await requireWorkspaceAdmin(clientId);

    const overrides = await prisma.promptOverride.findMany({
      where: { clientId },
      select: {
        promptKey: true,
        role: true,
        index: true,
        baseContentHash: true,
        content: true,
        updatedAt: true,
      },
    });

    return {
      success: true,
      overrides: overrides.map((o) => {
        const codeBaseHash = computePromptMessageBaseHash({
          promptKey: o.promptKey,
          role: o.role as PromptRole,
          index: o.index,
        });
        return {
          promptKey: o.promptKey,
          role: o.role,
          index: o.index,
          baseContentHash: o.baseContentHash,
          content: o.content,
          updatedAt: o.updatedAt.toISOString(),
          codeBaseHash,
          isDrifted: codeBaseHash !== o.baseContentHash,
        };
      }),
    };
  } catch (error) {
    console.error("[getPromptOverrides] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load overrides",
    };
  }
}

export type SystemPromptOverrideRecord = {
  promptKey: string;
  role: string;
  index: number;
  content: string;
  baseContentHash: string;
  updatedAt: string;
  codeBaseHash: string | null;
  isDrifted: boolean;
};

export async function getSystemPromptOverridesForWorkspace(clientId: string): Promise<{
  success: boolean;
  overrides?: SystemPromptOverrideRecord[];
  error?: string;
}> {
  try {
    await requireWorkspaceAdmin(clientId);

    const overrides = await prisma.systemPromptOverride.findMany({
      select: {
        promptKey: true,
        role: true,
        index: true,
        baseContentHash: true,
        content: true,
        updatedAt: true,
      },
    });

    return {
      success: true,
      overrides: overrides.map((o) => {
        const codeBaseHash = computePromptMessageBaseHash({
          promptKey: o.promptKey,
          role: o.role as PromptRole,
          index: o.index,
        });
        return {
          promptKey: o.promptKey,
          role: o.role,
          index: o.index,
          baseContentHash: o.baseContentHash,
          content: o.content,
          updatedAt: o.updatedAt.toISOString(),
          codeBaseHash,
          isDrifted: codeBaseHash !== o.baseContentHash,
        };
      }),
    };
  } catch (error) {
    console.error("[getSystemPromptOverridesForWorkspace] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load system overrides",
    };
  }
}

export type PromptOverrideRevisionRecord = {
  id: string;
  promptKey: string;
  role: string;
  index: number;
  content: string | null;
  action: string;
  createdAt: Date;
  createdByEmail: string | null;
};

export async function getPromptOverrideRevisions(
  clientId: string,
  promptKey: string,
  role: string,
  index: number
): Promise<{ success: boolean; data?: PromptOverrideRevisionRecord[]; error?: string }> {
  try {
    await requireWorkspaceAdmin(clientId);

    const revisions = await prisma.promptOverrideRevision.findMany({
      where: { clientId, promptKey, role, index },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        promptKey: true,
        role: true,
        index: true,
        content: true,
        action: true,
        createdAt: true,
        createdByEmail: true,
      },
    });

    return { success: true, data: revisions };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load prompt history" };
  }
}

export async function rollbackPromptOverrideRevision(
  clientId: string,
  revisionId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId, userEmail } = await requireWorkspaceAdmin(clientId);

    const revision = await prisma.promptOverrideRevision.findFirst({
      where: { id: revisionId, clientId },
      select: { promptKey: true, role: true, index: true, content: true },
    });
    if (!revision) return { success: false, error: "Revision not found" };

    if (!revision.content) {
      await prisma.promptOverride.deleteMany({
        where: { clientId, promptKey: revision.promptKey, role: revision.role, index: revision.index },
      });
      await prisma.promptOverrideRevision.create({
        data: {
          clientId,
          promptKey: revision.promptKey,
          role: revision.role,
          index: revision.index,
          content: null,
          action: "ROLLBACK_DELETE",
          createdByUserId: userId,
          createdByEmail: userEmail ?? null,
        },
      });
      return { success: true };
    }

    const baseContentHash = computePromptMessageBaseHash({
      promptKey: revision.promptKey,
      role: revision.role as PromptRole,
      index: revision.index,
    });
    if (!baseContentHash) {
      return { success: false, error: "Prompt target invalid" };
    }

    const override = await prisma.promptOverride.upsert({
      where: {
        clientId_promptKey_role_index: {
          clientId,
          promptKey: revision.promptKey,
          role: revision.role,
          index: revision.index,
        },
      },
      create: {
        clientId,
        promptKey: revision.promptKey,
        role: revision.role,
        index: revision.index,
        baseContentHash,
        content: revision.content,
      },
      update: {
        baseContentHash,
        content: revision.content,
      },
      select: { id: true },
    });

    await prisma.promptOverrideRevision.create({
      data: {
        clientId,
        promptOverrideId: override.id,
        promptKey: revision.promptKey,
        role: revision.role,
        index: revision.index,
        baseContentHash,
        content: revision.content,
        action: "ROLLBACK",
        createdByUserId: userId,
        createdByEmail: userEmail ?? null,
      },
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to rollback prompt" };
  }
}

// =============================================================================
// Prompt Snippet Override CRUD (Phase 47e)
// =============================================================================

export type PromptSnippetOverrideRecord = {
  snippetKey: string;
  content: string;
  updatedAt: string;
};

/**
 * Get all snippet overrides for a workspace.
 */
export async function getPromptSnippetOverrides(clientId: string): Promise<{
  success: boolean;
  overrides?: PromptSnippetOverrideRecord[];
  error?: string;
}> {
  try {
    await requireWorkspaceAdmin(clientId);

    const overrides = await prisma.promptSnippetOverride.findMany({
      where: { clientId },
      select: {
        snippetKey: true,
        content: true,
        updatedAt: true,
      },
    });

    return {
      success: true,
      overrides: overrides.map((o) => ({
        snippetKey: o.snippetKey,
        content: o.content,
        updatedAt: o.updatedAt.toISOString(),
      })),
    };
  } catch (error) {
    console.error("[getPromptSnippetOverrides] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load snippet overrides",
    };
  }
}

/**
 * Save a snippet override for a workspace (upsert).
 */
export async function savePromptSnippetOverride(
  clientId: string,
  snippetKey: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId, userEmail } = await requireWorkspaceAdmin(clientId);

    const saved = await prisma.promptSnippetOverride.upsert({
      where: { clientId_snippetKey: { clientId, snippetKey } },
      create: { clientId, snippetKey, content },
      update: { content },
      select: { id: true },
    });

    await prisma.promptSnippetOverrideRevision.create({
      data: {
        clientId,
        promptSnippetOverrideId: saved.id,
        snippetKey,
        content,
        action: "UPSERT",
        createdByUserId: userId,
        createdByEmail: userEmail ?? null,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("[savePromptSnippetOverride] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save snippet override",
    };
  }
}

/**
 * Reset a snippet override to default (delete).
 */
export async function resetPromptSnippetOverride(
  clientId: string,
  snippetKey: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId, userEmail } = await requireWorkspaceAdmin(clientId);

    const existing = await prisma.promptSnippetOverride.findFirst({
      where: { clientId, snippetKey },
      select: { id: true, content: true },
    });

    await prisma.promptSnippetOverride.deleteMany({
      where: { clientId, snippetKey },
    });

    if (existing) {
      await prisma.promptSnippetOverrideRevision.create({
        data: {
          clientId,
          promptSnippetOverrideId: existing.id,
          snippetKey,
          content: existing.content,
          action: "RESET",
          createdByUserId: userId,
          createdByEmail: userEmail ?? null,
        },
      });
    }

    return { success: true };
  } catch (error) {
    console.error("[resetPromptSnippetOverride] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to reset snippet override",
    };
  }
}

export type PromptSnippetOverrideRevisionRecord = {
  id: string;
  snippetKey: string;
  content: string | null;
  action: string;
  createdAt: Date;
  createdByEmail: string | null;
};

export async function getPromptSnippetOverrideRevisions(
  clientId: string,
  snippetKey: string
): Promise<{ success: boolean; data?: PromptSnippetOverrideRevisionRecord[]; error?: string }> {
  try {
    await requireWorkspaceAdmin(clientId);

    const revisions = await prisma.promptSnippetOverrideRevision.findMany({
      where: { clientId, snippetKey },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        snippetKey: true,
        content: true,
        action: true,
        createdAt: true,
        createdByEmail: true,
      },
    });

    return { success: true, data: revisions };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load snippet history" };
  }
}

export async function rollbackPromptSnippetOverrideRevision(
  clientId: string,
  revisionId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId, userEmail } = await requireWorkspaceAdmin(clientId);

    const revision = await prisma.promptSnippetOverrideRevision.findFirst({
      where: { id: revisionId, clientId },
      select: { snippetKey: true, content: true },
    });
    if (!revision) return { success: false, error: "Revision not found" };

    if (!revision.content) {
      await prisma.promptSnippetOverride.deleteMany({
        where: { clientId, snippetKey: revision.snippetKey },
      });
      await prisma.promptSnippetOverrideRevision.create({
        data: {
          clientId,
          snippetKey: revision.snippetKey,
          content: null,
          action: "ROLLBACK_DELETE",
          createdByUserId: userId,
          createdByEmail: userEmail ?? null,
        },
      });
      return { success: true };
    }

    const override = await prisma.promptSnippetOverride.upsert({
      where: { clientId_snippetKey: { clientId, snippetKey: revision.snippetKey } },
      create: { clientId, snippetKey: revision.snippetKey, content: revision.content },
      update: { content: revision.content },
      select: { id: true },
    });

    await prisma.promptSnippetOverrideRevision.create({
      data: {
        clientId,
        promptSnippetOverrideId: override.id,
        snippetKey: revision.snippetKey,
        content: revision.content,
        action: "ROLLBACK",
        createdByUserId: userId,
        createdByEmail: userEmail ?? null,
      },
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to rollback snippet override" };
  }
}

// =============================================================================
// Snippet Registry for UI (Phase 47h)
// =============================================================================

export type SnippetRegistryEntry = {
  key: string;
  label: string;
  description: string;
  type: "text" | "list" | "number" | "template";
  // Baseline default for this workspace (system default override, or code default).
  defaultValue: string;
  // Workspace override value (null means using the baseline default).
  currentValue: string | null;
  placeholders?: string[]; // for template type
  // Additional metadata for UI badges and diffing.
  codeDefaultValue?: string;
  systemDefaultValue?: string | null;
  systemUpdatedAt?: string | null;
  workspaceUpdatedAt?: string | null;
  source?: "workspace" | "system" | "code";
  isStale?: boolean;
};

/**
 * Get the full snippet registry with current override values for UI display.
 */
export async function getSnippetRegistry(clientId: string): Promise<{
  success: boolean;
  entries?: SnippetRegistryEntry[];
  error?: string;
}> {
  try {
    await requireWorkspaceAdmin(clientId);

    const buildRegistryMeta = (
      snippetKey: string
    ): Omit<SnippetRegistryEntry, "key" | "defaultValue" | "currentValue"> => {
      if (snippetKey === "forbiddenTerms") {
        return {
          label: "Forbidden Terms",
          description: "Words/phrases to avoid in AI-generated email content (one per line).",
          type: "list",
        };
      }

      if (snippetKey === "emailLengthMinChars") {
        return {
          label: "Email Min Characters",
          description: "Minimum character count for generated emails.",
          type: "number",
        };
      }

      if (snippetKey === "emailLengthMaxChars") {
        return {
          label: "Email Max Characters",
          description: "Maximum character count for generated emails.",
          type: "number",
        };
      }

      if (snippetKey === "emailLengthRulesTemplate") {
        return {
          label: "Email Length Instructions",
          description: "Template for the length rules instruction block.",
          type: "template",
          placeholders: ["{minChars}", "{maxChars}"],
        };
      }

      const archetypeMatch = snippetKey.match(/^emailArchetype\.(.+)\.instructions$/);
      if (archetypeMatch) {
        const archetypeId = archetypeMatch[1] || "";
        const archetypePrefix = archetypeId.split("_")[0] || archetypeId;
        const humanized = archetypeId.replace(/^A\d+_/, "").replace(/_/g, " ").trim();
        return {
          label: `Email Archetype ${archetypePrefix}`,
          description: humanized ? `Structure instructions (${humanized}).` : "Structure instructions.",
          type: "text",
        };
      }

      return {
        label: snippetKey,
        description: "Prompt snippet value.",
        type: "text",
      };
    };

    const sortKey = (snippetKey: string): [number, number, string] => {
      if (snippetKey === "forbiddenTerms") return [0, 0, snippetKey];
      if (snippetKey === "emailLengthMinChars") return [1, 0, snippetKey];
      if (snippetKey === "emailLengthMaxChars") return [1, 1, snippetKey];
      if (snippetKey === "emailLengthRulesTemplate") return [1, 2, snippetKey];

      const archetypeMatch = snippetKey.match(/^emailArchetype\.(.+)\.instructions$/);
      if (archetypeMatch) {
        const archetypeId = archetypeMatch[1] || "";
        const numberMatch = archetypeId.match(/^A(\d+)_/);
        const n = numberMatch ? Number.parseInt(numberMatch[1], 10) : 999;
        return [2, Number.isFinite(n) ? n : 999, snippetKey];
      }

      return [9, 0, snippetKey];
    };

    const [workspaceOverrides, systemOverrides] = await Promise.all([
      prisma.promptSnippetOverride.findMany({
        where: { clientId },
        select: { snippetKey: true, content: true, updatedAt: true },
      }),
      prisma.systemPromptSnippetOverride.findMany({
        select: { snippetKey: true, content: true, updatedAt: true },
      }),
    ]);
    const workspaceOverrideMap = new Map(
      workspaceOverrides.map((o) => [o.snippetKey, { content: o.content, updatedAt: o.updatedAt }])
    );
    const systemOverrideMap = new Map(
      systemOverrides.map((o) => [o.snippetKey, { content: o.content, updatedAt: o.updatedAt }])
    );

    // Build entries with current values
    const keys = Object.keys(SNIPPET_DEFAULTS).sort((a, b) => {
      const aa = sortKey(a);
      const bb = sortKey(b);
      if (aa[0] !== bb[0]) return aa[0] - bb[0];
      if (aa[1] !== bb[1]) return aa[1] - bb[1];
      return aa[2].localeCompare(bb[2]);
    });

    const entries: SnippetRegistryEntry[] = keys.map((key) => {
      const codeDefaultValue = SNIPPET_DEFAULTS[key] ?? "";
      const system = systemOverrideMap.get(key) ?? null;
      const workspace = workspaceOverrideMap.get(key) ?? null;

      const hasSystemOverride = Boolean(system);
      const hasWorkspaceOverride = Boolean(workspace);

      // Note: overrides can intentionally set content to an empty string. Use existence checks, not truthiness.
      const systemDefaultValue = hasSystemOverride ? system!.content : null;
      const workspaceDefaultValue = hasWorkspaceOverride ? workspace!.content : null;

      const source: "workspace" | "system" | "code" = hasWorkspaceOverride
        ? "workspace"
        : hasSystemOverride
          ? "system"
          : "code";

      const systemUpdatedAt = hasSystemOverride ? system!.updatedAt.toISOString() : null;
      const workspaceUpdatedAt = hasWorkspaceOverride ? workspace!.updatedAt.toISOString() : null;
      const isStale = Boolean(hasWorkspaceOverride && hasSystemOverride && workspace!.updatedAt < system!.updatedAt);

      // Baseline default shown in the workspace editor (system override, else code).
      const baselineDefault = systemDefaultValue ?? codeDefaultValue;

      return {
        key,
        ...buildRegistryMeta(key),
        defaultValue: baselineDefault,
        currentValue: workspaceDefaultValue ?? null,
        codeDefaultValue,
        systemDefaultValue,
        systemUpdatedAt,
        workspaceUpdatedAt,
        source,
        isStale,
      };
    });

    return { success: true, entries };
  } catch (error) {
    console.error("[getSnippetRegistry] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load snippet registry",
    };
  }
}
