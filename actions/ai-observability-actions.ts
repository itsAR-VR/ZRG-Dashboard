"use server";

import { prisma } from "@/lib/prisma";
import { requireClientAdminAccess } from "@/lib/workspace-access";
import { listAIPromptTemplates } from "@/lib/ai/prompt-registry";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { pruneOldAIInteractionsMaybe } from "@/lib/ai/retention";

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

export type ObservabilitySummary = {
  window: AiObservabilityWindow;
  rangeStart: string;
  rangeEnd: string;
  totals: TotalsSummary;
  features: FeatureSummary[];
  errorSamples: ErrorSampleGroup[];
};

async function requireWorkspaceAdmin(clientId: string): Promise<{ userId: string }> {
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

function buildFeatureName(featureId: string): string {
  const map: Record<string, string> = {
    "sentiment.classify": "Sentiment Classification",
    "draft.generate.email": "Draft: Email",
    "draft.generate.sms": "Draft: SMS",
    "draft.generate.linkedin": "Draft: LinkedIn",
    "auto_reply_gate.decide": "Auto-Reply Gate",
    "signature.extract": "Signature Extraction",
    "timezone.infer": "Timezone Inference",
    "followup.parse_accepted_time": "Follow-up: Parse Accepted Time",
    "followup.detect_meeting_accept_intent": "Follow-up: Detect Meeting Acceptance Intent",
  };
  return map[featureId] || featureId;
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

    const features: FeatureSummary[] = [];
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

    features.sort((a, b) => b.calls - a.calls);

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
      features,
      errorSamples,
    };

    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load AI metrics" };
  }
}
