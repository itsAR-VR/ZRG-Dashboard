"use server";

import { prisma } from "@/lib/prisma";
import { isTrueSuperAdminUser, requireAuthUser } from "@/lib/workspace-access";
import { DEFAULT_MEMORY_POLICY } from "@/lib/memory-governance/types";
import type { MemoryPolicySettings } from "@/lib/memory-governance/types";

async function requireTrueSuperAdmin(): Promise<{ userId: string; userEmail: string | null }> {
  const user = await requireAuthUser();
  if (!isTrueSuperAdminUser(user)) {
    throw new Error("Unauthorized");
  }
  return { userId: user.id, userEmail: user.email };
}

function clamp01(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function clampPosInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.trunc(n));
}

function normalizeAllowlist(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const item of values) {
    if (typeof item !== "string") continue;
    const cleaned = item.trim();
    if (!cleaned) continue;
    if (cleaned.length > 64) continue;
    out.push(cleaned);
    if (out.length >= 100) break;
  }
  return Array.from(new Set(out));
}

export type MemoryGovernanceSettings = MemoryPolicySettings & {
  suggestedAllowlistCategories: string[];
  autoSendEvaluatorModel: string | null;
  autoSendEvaluatorReasoningEffort: string | null;
};

export async function getMemoryGovernanceSettings(
  clientId: string | null | undefined
): Promise<{ success: boolean; data?: MemoryGovernanceSettings; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireTrueSuperAdmin();

    const settings = await prisma.workspaceSettings.findUnique({
      where: { clientId },
      select: {
        memoryAllowlistCategories: true,
        memoryMinConfidence: true,
        memoryMinTtlDays: true,
        memoryTtlCapDays: true,
        autoSendEvaluatorModel: true,
        autoSendEvaluatorReasoningEffort: true,
      },
    });

    return {
      success: true,
      data: {
        allowlistCategories: settings?.memoryAllowlistCategories ?? [],
        suggestedAllowlistCategories: DEFAULT_MEMORY_POLICY.allowlistCategories,
        minConfidence: clamp01(settings?.memoryMinConfidence, DEFAULT_MEMORY_POLICY.minConfidence),
        minTtlDays: clampPosInt(settings?.memoryMinTtlDays, DEFAULT_MEMORY_POLICY.minTtlDays),
        ttlCapDays: clampPosInt(settings?.memoryTtlCapDays, DEFAULT_MEMORY_POLICY.ttlCapDays),
        autoSendEvaluatorModel: settings?.autoSendEvaluatorModel ?? null,
        autoSendEvaluatorReasoningEffort: settings?.autoSendEvaluatorReasoningEffort ?? null,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load settings" };
  }
}

export async function updateMemoryGovernanceSettings(
  clientId: string | null | undefined,
  patch: Partial<{
    allowlistCategories: string[];
    minConfidence: number;
    minTtlDays: number;
    ttlCapDays: number;
    autoSendEvaluatorModel: string | null;
    autoSendEvaluatorReasoningEffort: string | null;
  }>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    const user = await requireTrueSuperAdmin();

    const allowlistCategories =
      patch.allowlistCategories !== undefined ? normalizeAllowlist(patch.allowlistCategories) : undefined;
    const minConfidence = patch.minConfidence !== undefined ? clamp01(patch.minConfidence, DEFAULT_MEMORY_POLICY.minConfidence) : undefined;
    const minTtlDays = patch.minTtlDays !== undefined ? clampPosInt(patch.minTtlDays, DEFAULT_MEMORY_POLICY.minTtlDays) : undefined;
    const ttlCapDays = patch.ttlCapDays !== undefined ? clampPosInt(patch.ttlCapDays, DEFAULT_MEMORY_POLICY.ttlCapDays) : undefined;

    const autoSendEvaluatorModel =
      patch.autoSendEvaluatorModel !== undefined ? (patch.autoSendEvaluatorModel ? String(patch.autoSendEvaluatorModel).trim() : null) : undefined;
    const autoSendEvaluatorReasoningEffort =
      patch.autoSendEvaluatorReasoningEffort !== undefined
        ? (patch.autoSendEvaluatorReasoningEffort ? String(patch.autoSendEvaluatorReasoningEffort).trim() : null)
        : undefined;

    await prisma.workspaceSettings.upsert({
      where: { clientId },
      create: {
        clientId,
        ...(allowlistCategories !== undefined ? { memoryAllowlistCategories: allowlistCategories } : {}),
        ...(minConfidence !== undefined ? { memoryMinConfidence: minConfidence } : {}),
        ...(minTtlDays !== undefined ? { memoryMinTtlDays: minTtlDays } : {}),
        ...(ttlCapDays !== undefined ? { memoryTtlCapDays: ttlCapDays } : {}),
        ...(autoSendEvaluatorModel !== undefined ? { autoSendEvaluatorModel } : {}),
        ...(autoSendEvaluatorReasoningEffort !== undefined ? { autoSendEvaluatorReasoningEffort } : {}),
      },
      update: {
        ...(allowlistCategories !== undefined ? { memoryAllowlistCategories: allowlistCategories } : {}),
        ...(minConfidence !== undefined ? { memoryMinConfidence: minConfidence } : {}),
        ...(minTtlDays !== undefined ? { memoryMinTtlDays: minTtlDays } : {}),
        ...(ttlCapDays !== undefined ? { memoryTtlCapDays: ttlCapDays } : {}),
        ...(autoSendEvaluatorModel !== undefined ? { autoSendEvaluatorModel } : {}),
        ...(autoSendEvaluatorReasoningEffort !== undefined ? { autoSendEvaluatorReasoningEffort } : {}),
      },
      select: { id: true },
    });

    // Best-effort audit trail (no sensitive content).
    await prisma.aIInteraction
      .create({
        data: {
          clientId,
          leadId: null,
          source: "action:memory_governance.update",
          featureId: "memory.governance.update",
          promptKey: null,
          model: "internal",
          apiType: "internal",
          status: "success",
          metadata: {
            updatedByUserId: user.userId,
            allowlistSize: allowlistCategories?.length ?? null,
            minConfidence,
            minTtlDays,
            ttlCapDays,
            autoSendEvaluatorModel,
            autoSendEvaluatorReasoningEffort,
          },
        },
      })
      .catch(() => null);

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to update settings" };
  }
}

export type PendingMemoryEntryRow = {
  scope: "lead" | "workspace";
  id: string;
  leadId: string | null;
  leadLabel: string | null;
  category: string;
  content: string;
  expiresAt: string | null;
  createdAt: string;
  proposedByDraftPipelineRunId: string | null;
  proposedByDraftId: string | null;
};

export async function listPendingMemoryEntries(
  clientId: string | null | undefined,
  opts?: { limit?: number }
): Promise<{ success: boolean; data?: { entries: PendingMemoryEntryRow[] }; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireTrueSuperAdmin();

    const limitRaw = typeof opts?.limit === "number" && Number.isFinite(opts.limit) ? Math.trunc(opts.limit) : 50;
    const limit = Math.max(1, Math.min(200, limitRaw));

    const [leadRows, workspaceRows] = await Promise.all([
      prisma.leadMemoryEntry.findMany({
        where: { clientId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          leadId: true,
          category: true,
          content: true,
          expiresAt: true,
          createdAt: true,
          proposedByDraftPipelineRunId: true,
          proposedByDraftId: true,
          lead: { select: { firstName: true, lastName: true, email: true } },
        },
      }),
      prisma.workspaceMemoryEntry.findMany({
        where: { clientId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          category: true,
          content: true,
          expiresAt: true,
          createdAt: true,
          proposedByDraftPipelineRunId: true,
          proposedByDraftId: true,
        },
      }),
    ]);

    const entries: PendingMemoryEntryRow[] = [];

    for (const row of leadRows) {
      const labelParts = [row.lead?.firstName, row.lead?.lastName].filter((v): v is string => Boolean(v && v.trim()));
      const label = labelParts.join(" ").trim() || row.lead?.email?.trim() || null;
      entries.push({
        scope: "lead",
        id: row.id,
        leadId: row.leadId,
        leadLabel: label,
        category: row.category,
        content: row.content,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        proposedByDraftPipelineRunId: row.proposedByDraftPipelineRunId ?? null,
        proposedByDraftId: row.proposedByDraftId ?? null,
      });
    }

    for (const row of workspaceRows) {
      entries.push({
        scope: "workspace",
        id: row.id,
        leadId: null,
        leadLabel: null,
        category: row.category,
        content: row.content,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        proposedByDraftPipelineRunId: row.proposedByDraftPipelineRunId ?? null,
        proposedByDraftId: row.proposedByDraftId ?? null,
      });
    }

    entries.sort((a, b) => {
      const aMs = new Date(a.createdAt).getTime();
      const bMs = new Date(b.createdAt).getTime();
      return bMs - aMs;
    });

    return { success: true, data: { entries: entries.slice(0, limit) } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load pending memory" };
  }
}

export async function approvePendingMemoryEntry(
  clientId: string | null | undefined,
  entry: { scope: "lead" | "workspace"; id: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireTrueSuperAdmin();

    const id = (entry.id || "").trim();
    if (!id) return { success: false, error: "Missing id" };

    if (entry.scope === "workspace") {
      await prisma.workspaceMemoryEntry.updateMany({ where: { id, clientId }, data: { status: "APPROVED" } });
    } else {
      await prisma.leadMemoryEntry.updateMany({ where: { id, clientId }, data: { status: "APPROVED" } });
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to approve" };
  }
}

export async function rejectPendingMemoryEntry(
  clientId: string | null | undefined,
  entry: { scope: "lead" | "workspace"; id: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireTrueSuperAdmin();

    const id = (entry.id || "").trim();
    if (!id) return { success: false, error: "Missing id" };

    if (entry.scope === "workspace") {
      await prisma.workspaceMemoryEntry.deleteMany({ where: { id, clientId } });
    } else {
      await prisma.leadMemoryEntry.deleteMany({ where: { id, clientId } });
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to reject" };
  }
}
