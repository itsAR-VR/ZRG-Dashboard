import "server-only";

import type { WorkspaceSettings } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  PRIMARY_WEBSITE_ASSET_NAME,
  buildKnowledgeContextFromAssets,
  extractPrimaryWebsiteUrlFromAssets,
  type KnowledgeAssetForContext,
} from "@/lib/knowledge-asset-context";
import {
  buildLeadMemoryContextFromEntries,
  getLeadMemoryContext,
  type LeadMemoryEntryForContext,
} from "@/lib/lead-memory-context";

export const LEAD_CONTEXT_BUNDLE_VERSION = "lead_context_bundle.v1";

export type LeadContextProfile =
  | "draft"
  | "revision"
  | "auto_send_evaluator"
  | "meeting_overseer_gate"
  | "followup_parse"
  | "followup_booking_gate";

export type LeadContextBundleStats = {
  knowledge?: {
    maxTokens: number;
    maxAssetTokens: number;
    totalAssets: number;
    includedAssets: number;
    truncatedAssets: number;
    totalTokensEstimated: number;
  };
  memory?: {
    maxTokens: number;
    maxEntryTokens: number;
    totalEntries: number;
    includedEntries: number;
    truncatedEntries: number;
    totalTokensEstimated: number;
  };
  totals: { tokensEstimated: number };
};

export type LeadContextBundle = {
  clientId: string;
  leadId: string;
  profile: LeadContextProfile;

  serviceDescription: string | null;
  goals: string | null;

  knowledgeContext: string | null;
  primaryWebsiteUrl: string | null;
  leadMemoryContext: string | null;

  stats: LeadContextBundleStats;
};

type BudgetSpec = {
  knowledge?: { maxTokens: number; maxAssetTokens: number };
  memory?: { maxTokens: number; maxEntryTokens: number };
};

const DEFAULT_BUDGETS_BY_PROFILE: Record<LeadContextProfile, BudgetSpec> = {
  draft: {
    knowledge: { maxTokens: 4000, maxAssetTokens: 1200 },
    memory: { maxTokens: 1200, maxEntryTokens: 400 },
  },
  revision: {
    knowledge: { maxTokens: 3000, maxAssetTokens: 1200 },
    memory: { maxTokens: 800, maxEntryTokens: 300 },
  },
  auto_send_evaluator: {
    knowledge: { maxTokens: 8000, maxAssetTokens: 1600 },
    memory: { maxTokens: 600, maxEntryTokens: 300 },
  },
  meeting_overseer_gate: {
    memory: { maxTokens: 600, maxEntryTokens: 300 },
  },
  followup_parse: {
    memory: { maxTokens: 400, maxEntryTokens: 200 },
  },
  followup_booking_gate: {
    memory: { maxTokens: 600, maxEntryTokens: 300 },
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof parsed === "number") return Math.max(min, Math.min(max, parsed));
  return fallback;
}

function parseBudgetsOverride(value: unknown): Partial<Record<LeadContextProfile, BudgetSpec>> {
  if (!isPlainObject(value)) return {};

  const out: Partial<Record<LeadContextProfile, BudgetSpec>> = {};
  const profiles: LeadContextProfile[] = [
    "draft",
    "revision",
    "auto_send_evaluator",
    "meeting_overseer_gate",
    "followup_parse",
    "followup_booking_gate",
  ];

  for (const profile of profiles) {
    const rawProfile = value[profile];
    if (!isPlainObject(rawProfile)) continue;

    const next: BudgetSpec = {};
    const rawKnowledge = rawProfile.knowledge;
    if (isPlainObject(rawKnowledge)) {
      next.knowledge = {
        maxTokens: clampInt(rawKnowledge.maxTokens, DEFAULT_BUDGETS_BY_PROFILE[profile].knowledge?.maxTokens ?? 0, 0, 20_000),
        maxAssetTokens: clampInt(
          rawKnowledge.maxAssetTokens,
          DEFAULT_BUDGETS_BY_PROFILE[profile].knowledge?.maxAssetTokens ?? 0,
          0,
          20_000
        ),
      };
    }

    const rawMemory = rawProfile.memory;
    if (isPlainObject(rawMemory)) {
      next.memory = {
        maxTokens: clampInt(rawMemory.maxTokens, DEFAULT_BUDGETS_BY_PROFILE[profile].memory?.maxTokens ?? 0, 0, 20_000),
        maxEntryTokens: clampInt(
          rawMemory.maxEntryTokens,
          DEFAULT_BUDGETS_BY_PROFILE[profile].memory?.maxEntryTokens ?? 0,
          0,
          20_000
        ),
      };
    }

    out[profile] = next;
  }

  return out;
}

function coerceTruthyEnv(value: string | undefined): boolean {
  const raw = (value || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function isLeadContextBundleGloballyDisabled(): boolean {
  return coerceTruthyEnv(process.env.LEAD_CONTEXT_BUNDLE_DISABLED);
}

export function buildLeadContextBundleTelemetryMetadata(bundle: LeadContextBundle): {
  leadContextBundle: {
    version: string;
    profile: LeadContextProfile;
    knowledge?: LeadContextBundleStats["knowledge"];
    memory?: LeadContextBundleStats["memory"];
    totals: LeadContextBundleStats["totals"];
  };
} {
  return {
    leadContextBundle: {
      version: LEAD_CONTEXT_BUNDLE_VERSION,
      profile: bundle.profile,
      ...(bundle.stats.knowledge ? { knowledge: bundle.stats.knowledge } : {}),
      ...(bundle.stats.memory ? { memory: bundle.stats.memory } : {}),
      totals: bundle.stats.totals,
    },
  };
}

function shouldIncludeKnowledge(profile: LeadContextProfile): boolean {
  return profile === "draft" || profile === "revision" || profile === "auto_send_evaluator";
}

function shouldRedactMemory(profile: LeadContextProfile): boolean {
  return profile !== "draft";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const ms = Number.isFinite(timeoutMs) ? Math.max(1, Math.trunc(timeoutMs)) : 0;
  if (!ms) return promise;

  return await Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      const id = setTimeout(() => {
        reject(new Error(`${label} timed out after ${ms}ms`));
      }, ms);
      // Allow Node to exit even if the timer is still pending.
      (id as any).unref?.();
    }),
  ]);
}

export async function buildLeadContextBundle(opts: {
  clientId: string;
  leadId: string;
  profile: LeadContextProfile;
  timeoutMs?: number;
  settings?: Pick<
    WorkspaceSettings,
    "clientId" | "serviceDescription" | "aiGoals" | "leadContextBundleBudgets"
  > | null;
  knowledgeAssets?: KnowledgeAssetForContext[] | null;
  memoryEntries?: LeadMemoryEntryForContext[] | null;
  serviceDescription?: string | null;
  goals?: string | null;
}): Promise<LeadContextBundle> {
  const clientId = (opts.clientId || "").trim();
  const leadId = (opts.leadId || "").trim();
  const profile = opts.profile;

  if (!clientId || !leadId) {
    return {
      clientId,
      leadId,
      profile,
      serviceDescription: null,
      goals: null,
      knowledgeContext: null,
      primaryWebsiteUrl: null,
      leadMemoryContext: null,
      stats: { totals: { tokensEstimated: 0 } },
    };
  }

  const runner = (async (): Promise<LeadContextBundle> => {
    const wantsKnowledgeAssets = shouldIncludeKnowledge(profile) && !opts.knowledgeAssets;

    let settings: Pick<
      WorkspaceSettings,
      "clientId" | "serviceDescription" | "aiGoals" | "leadContextBundleBudgets"
    > | null = opts.settings ?? null;
    let knowledgeAssets: KnowledgeAssetForContext[] | null = opts.knowledgeAssets ?? null;

    if (!settings || (wantsKnowledgeAssets && !knowledgeAssets)) {
      const fetchedSettings = await prisma.workspaceSettings.findUnique({
        where: { clientId },
        select: {
          clientId: true,
          serviceDescription: true,
          aiGoals: true,
          leadContextBundleBudgets: true,
        },
      }).catch(() => null);

      if (!settings) settings = fetchedSettings;

      if (wantsKnowledgeAssets && !knowledgeAssets) {
        const fetchedAssets = await prisma.knowledgeAsset.findMany({
          where: { workspaceSettings: { clientId } },
          orderBy: { updatedAt: "desc" },
          take: 50,
          select: {
            name: true,
            type: true,
            fileUrl: true,
            originalFileName: true,
            mimeType: true,
            rawContent: true,
            textContent: true,
            aiContextMode: true,
            updatedAt: true,
          },
        }).catch(() => []);

        knowledgeAssets = fetchedAssets.map((asset) => ({
          ...asset,
          aiContextMode: asset.aiContextMode === "raw" ? "raw" : "notes",
        }));
      }
    }

    const budgetsOverride = parseBudgetsOverride(settings?.leadContextBundleBudgets);
    const baseBudget = DEFAULT_BUDGETS_BY_PROFILE[profile];
    const profileOverride = budgetsOverride[profile] ?? {};
    const budgets: BudgetSpec = {
      knowledge: profileOverride.knowledge ?? baseBudget.knowledge,
      memory: profileOverride.memory ?? baseBudget.memory,
    };

    const normalizedKnowledgeAssets: KnowledgeAssetForContext[] = Array.isArray(knowledgeAssets) ? knowledgeAssets : [];
    const primaryWebsiteUrl = extractPrimaryWebsiteUrlFromAssets(normalizedKnowledgeAssets);

    const effectiveServiceDescription = (opts.serviceDescription ?? settings?.serviceDescription ?? "").trim() || null;
    const effectiveGoals = (opts.goals ?? settings?.aiGoals ?? "").trim() || null;

    const knowledgeResult = shouldIncludeKnowledge(profile) && budgets.knowledge && budgets.knowledge.maxTokens > 0
      ? buildKnowledgeContextFromAssets({
          assets: normalizedKnowledgeAssets.filter(
            (a) => (a.name || "").trim().toLowerCase() !== PRIMARY_WEBSITE_ASSET_NAME.toLowerCase()
          ),
          maxTokens: budgets.knowledge.maxTokens,
          maxAssetTokens: budgets.knowledge.maxAssetTokens,
        })
      : null;

    const memoryResult = budgets.memory && budgets.memory.maxTokens > 0
      ? opts.memoryEntries
        ? buildLeadMemoryContextFromEntries({
            entries: opts.memoryEntries,
            maxTokens: budgets.memory.maxTokens,
            maxEntryTokens: budgets.memory.maxEntryTokens,
            redact: shouldRedactMemory(profile),
          })
        : await getLeadMemoryContext({
            leadId,
            clientId,
            maxTokens: budgets.memory.maxTokens,
            maxEntryTokens: budgets.memory.maxEntryTokens,
            redact: shouldRedactMemory(profile),
          })
      : null;

    const knowledgeContext = knowledgeResult?.context?.trim() || null;
    const leadMemoryContext = memoryResult?.context?.trim() || null;

    const knowledgeStats = knowledgeResult
      ? {
          maxTokens: knowledgeResult.stats.maxTokens,
          maxAssetTokens: knowledgeResult.stats.maxAssetTokens,
          totalAssets: knowledgeResult.stats.totalAssets,
          includedAssets: knowledgeResult.stats.includedAssets,
          truncatedAssets: knowledgeResult.stats.truncatedAssets,
          totalTokensEstimated: knowledgeResult.stats.totalTokensEstimated,
        }
      : undefined;

    const memoryStats = memoryResult
      ? {
          maxTokens: memoryResult.stats.maxTokens,
          maxEntryTokens: memoryResult.stats.maxEntryTokens,
          totalEntries: memoryResult.stats.totalEntries,
          includedEntries: memoryResult.stats.includedEntries,
          truncatedEntries: memoryResult.stats.truncatedEntries,
          totalTokensEstimated: memoryResult.stats.totalTokensEstimated,
        }
      : undefined;

    const tokensEstimated =
      (knowledgeResult?.stats.includedTokensEstimated ?? 0) + (memoryResult?.stats.includedTokensEstimated ?? 0);

    return {
      clientId,
      leadId,
      profile,
      serviceDescription: effectiveServiceDescription,
      goals: effectiveGoals,
      knowledgeContext,
      primaryWebsiteUrl,
      leadMemoryContext,
      stats: {
        ...(knowledgeStats ? { knowledge: knowledgeStats } : {}),
        ...(memoryStats ? { memory: memoryStats } : {}),
        totals: { tokensEstimated },
      },
    };
  })();

  return await withTimeout(runner, opts.timeoutMs ?? 0, "LeadContextBundle build");
}
