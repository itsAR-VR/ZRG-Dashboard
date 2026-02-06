"use server";

import { prisma } from "@/lib/prisma";
import { isTrueSuperAdminUser, requireAuthUser } from "@/lib/workspace-access";

async function requireTrueSuperAdmin(): Promise<void> {
  const user = await requireAuthUser();
  if (!isTrueSuperAdminUser(user)) {
    throw new Error("Unauthorized");
  }
}

export type AiInteractionListRow = {
  id: string;
  createdAt: string;
  featureId: string;
  promptKey: string | null;
  model: string;
  status: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  leadId: string | null;
  source: string | null;
  metadata: unknown | null;
};

export async function listAiInteractions(
  clientId: string | null | undefined,
  filters?: {
    window?: "24h" | "7d" | "30d";
    featureId?: string;
    promptKey?: string;
    status?: "success" | "error";
    leadId?: string;
    limit?: number;
  }
): Promise<{ success: boolean; data?: { interactions: AiInteractionListRow[] }; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireTrueSuperAdmin();

    const window = filters?.window ?? "7d";
    const now = Date.now();
    const windowMs = window === "24h" ? 24 * 60 * 60 * 1000 : window === "30d" ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const rangeStart = new Date(now - windowMs);

    const limit =
      typeof filters?.limit === "number" && Number.isFinite(filters.limit) ? Math.max(1, Math.min(200, Math.trunc(filters.limit))) : 50;

    const interactions = await prisma.aIInteraction.findMany({
      where: {
        clientId,
        createdAt: { gte: rangeStart },
        ...(filters?.featureId ? { featureId: filters.featureId } : {}),
        ...(filters?.promptKey ? { promptKey: filters.promptKey } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.leadId ? { leadId: filters.leadId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        featureId: true,
        promptKey: true,
        model: true,
        status: true,
        latencyMs: true,
        inputTokens: true,
        outputTokens: true,
        reasoningTokens: true,
        totalTokens: true,
        leadId: true,
        source: true,
        metadata: true,
      },
    });

    return {
      success: true,
      data: {
        interactions: interactions.map((i) => ({
          id: i.id,
          createdAt: i.createdAt.toISOString(),
          featureId: i.featureId,
          promptKey: i.promptKey ?? null,
          model: i.model,
          status: i.status,
          latencyMs: i.latencyMs ?? null,
          inputTokens: i.inputTokens ?? null,
          outputTokens: i.outputTokens ?? null,
          reasoningTokens: i.reasoningTokens ?? null,
          totalTokens: i.totalTokens ?? null,
          leadId: i.leadId ?? null,
          source: i.source ?? null,
          metadata: i.metadata ?? null,
        })),
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to list interactions" };
  }
}

export async function getAiInteraction(
  clientId: string | null | undefined,
  interactionId: string
): Promise<{ success: boolean; data?: { interaction: any }; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireTrueSuperAdmin();

    const interaction = await prisma.aIInteraction.findFirst({
      where: { id: interactionId, clientId },
      select: {
        id: true,
        createdAt: true,
        clientId: true,
        leadId: true,
        source: true,
        featureId: true,
        promptKey: true,
        model: true,
        apiType: true,
        inputTokens: true,
        outputTokens: true,
        reasoningTokens: true,
        totalTokens: true,
        latencyMs: true,
        status: true,
        errorMessage: true,
        metadata: true,
      },
    });
    if (!interaction) return { success: false, error: "Interaction not found" };

    return {
      success: true,
      data: {
        interaction: {
          ...interaction,
          createdAt: interaction.createdAt.toISOString(),
        },
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load interaction" };
  }
}

