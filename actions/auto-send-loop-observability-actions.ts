"use server";

import { prisma } from "@/lib/prisma";
import { isTrueSuperAdminUser, requireAuthUser } from "@/lib/workspace-access";
import { DRAFT_PIPELINE_STAGES } from "@/lib/draft-pipeline/types";

async function requireTrueSuperAdmin(): Promise<void> {
  const user = await requireAuthUser();
  if (!isTrueSuperAdminUser(user)) {
    throw new Error("Unauthorized");
  }
}

export type AutoSendRevisionLoopRow = {
  id: string;
  createdAt: string;
  runId: string;
  clientId: string;
  leadId: string;
  draftId: string | null;
  channel: string;
  summary: unknown | null;
};

export async function listAutoSendRevisionLoopSummaries(
  clientId: string | null | undefined,
  filters?: { leadId?: string; limit?: number }
): Promise<{ success: boolean; data?: { rows: AutoSendRevisionLoopRow[] }; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireTrueSuperAdmin();

    const limitRaw = typeof filters?.limit === "number" && Number.isFinite(filters.limit) ? Math.trunc(filters.limit) : 50;
    const limit = Math.max(1, Math.min(200, limitRaw));
    const leadId = (filters?.leadId || "").trim() || null;

    const artifacts = await prisma.draftPipelineArtifact.findMany({
      where: {
        stage: DRAFT_PIPELINE_STAGES.autoSendRevisionLoop,
        iteration: 0,
        run: { clientId, ...(leadId ? { leadId } : {}) },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        runId: true,
        payload: true,
        run: {
          select: {
            clientId: true,
            leadId: true,
            draftId: true,
            channel: true,
          },
        },
      },
    });

    return {
      success: true,
      data: {
        rows: artifacts.map((a) => ({
          id: a.id,
          createdAt: a.createdAt.toISOString(),
          runId: a.runId,
          clientId: a.run.clientId,
          leadId: a.run.leadId,
          draftId: a.run.draftId ?? null,
          channel: a.run.channel,
          summary: a.payload ?? null,
        })),
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load loop summaries" };
  }
}

