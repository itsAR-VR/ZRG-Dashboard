"use server";

import { prisma } from "@/lib/prisma";
import { requireAuthUser, requireClientAccess, requireClientAdminAccess, isTrueSuperAdminUser } from "@/lib/workspace-access";
import { computePromptMessageBaseHash } from "@/lib/ai/prompt-registry";

type ProposalPublic = {
  id: string;
  type: string;
  status: string;
  title: string;
  summary: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  appliedAt: Date | null;
  payload?: unknown;
  evidence?: unknown;
};

export async function listMessagePerformanceProposals(
  clientId: string | null | undefined
): Promise<{ success: boolean; data?: { proposals: ProposalPublic[]; isAdmin: boolean }; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireClientAccess(clientId);

    let isAdmin = false;
    try {
      await requireClientAdminAccess(clientId);
      isAdmin = true;
    } catch {
      isAdmin = false;
    }

    const proposals = await prisma.messagePerformanceProposal.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        status: true,
        title: true,
        summary: true,
        payload: true,
        evidence: true,
        createdAt: true,
        approvedAt: true,
        appliedAt: true,
      },
    });

    const data = proposals.map((proposal) => ({
      id: proposal.id,
      type: proposal.type,
      status: proposal.status,
      title: proposal.title,
      summary: proposal.summary,
      createdAt: proposal.createdAt,
      approvedAt: proposal.approvedAt,
      appliedAt: proposal.appliedAt,
      ...(isAdmin ? { payload: proposal.payload, evidence: proposal.evidence } : {}),
    }));

    return { success: true, data: { proposals: data, isAdmin } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load proposals" };
  }
}

export async function approveMessagePerformanceProposal(
  clientId: string | null | undefined,
  proposalId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    const { userId, userEmail } = await requireClientAdminAccess(clientId);

    const proposal = await prisma.messagePerformanceProposal.findFirst({
      where: { id: proposalId, clientId },
      select: { id: true },
    });
    if (!proposal) return { success: false, error: "Proposal not found" };

    await prisma.messagePerformanceProposal.update({
      where: { id: proposal.id },
      data: {
        status: "APPROVED",
        approvedByUserId: userId,
        approvedByEmail: userEmail,
        approvedAt: new Date(),
      },
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to approve proposal" };
  }
}

export async function rejectMessagePerformanceProposal(
  clientId: string | null | undefined,
  proposalId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireClientAdminAccess(clientId);

    const proposal = await prisma.messagePerformanceProposal.findFirst({
      where: { id: proposalId, clientId },
      select: { id: true },
    });
    if (!proposal) return { success: false, error: "Proposal not found" };

    await prisma.messagePerformanceProposal.update({
      where: { id: proposal.id },
      data: {
        status: "REJECTED",
      },
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to reject proposal" };
  }
}

export async function applyMessagePerformanceProposal(
  clientId: string | null | undefined,
  proposalId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    const user = await requireAuthUser();
    if (!isTrueSuperAdminUser(user)) return { success: false, error: "Unauthorized" };

    const proposal = await prisma.messagePerformanceProposal.findFirst({
      where: { id: proposalId, clientId },
      select: { id: true, type: true, status: true, payload: true },
    });
    if (!proposal) return { success: false, error: "Proposal not found" };
    if (proposal.status !== "APPROVED") {
      return { success: false, error: "Proposal must be approved before applying" };
    }

    const payload = proposal.payload as any;
    const target = payload?.target ?? {};
    const content = typeof payload?.content === "string" ? payload.content : null;
    if (!content) return { success: false, error: "Proposal content missing" };

    if (proposal.type === "PROMPT_OVERRIDE") {
      const promptKey = target.promptKey;
      const role = target.role;
      const index = Number.isFinite(target.index) ? Number(target.index) : null;
      if (!promptKey || !role || index === null) return { success: false, error: "Prompt override target missing" };

      const baseContentHash = computePromptMessageBaseHash({
        promptKey,
        role: role as "system" | "assistant" | "user",
        index,
      });
      if (!baseContentHash) return { success: false, error: "Prompt target invalid" };

      const override = await prisma.promptOverride.upsert({
        where: { clientId_promptKey_role_index: { clientId, promptKey, role, index } },
        create: { clientId, promptKey, role, index, baseContentHash, content },
        update: { baseContentHash, content },
        select: { id: true },
      });

      await prisma.promptOverrideRevision.create({
        data: {
          clientId,
          promptOverrideId: override.id,
          proposalId: proposal.id,
          promptKey,
          role,
          index,
          baseContentHash,
          content,
          action: "APPLY_PROPOSAL",
          createdByUserId: user.id,
          createdByEmail: user.email ?? null,
        },
      });
    } else if (proposal.type === "PROMPT_SNIPPET") {
      const snippetKey = target.snippetKey;
      if (!snippetKey) return { success: false, error: "Snippet target missing" };

      const snippet = await prisma.promptSnippetOverride.upsert({
        where: { clientId_snippetKey: { clientId, snippetKey } },
        create: { clientId, snippetKey, content },
        update: { content },
        select: { id: true },
      });

      await prisma.promptSnippetOverrideRevision.create({
        data: {
          clientId,
          promptSnippetOverrideId: snippet.id,
          proposalId: proposal.id,
          snippetKey,
          content,
          action: "APPLY_PROPOSAL",
          createdByUserId: user.id,
          createdByEmail: user.email ?? null,
        },
      });
    } else if (proposal.type === "KNOWLEDGE_ASSET") {
      const settings = await prisma.workspaceSettings.upsert({
        where: { clientId },
        update: {},
        create: { clientId },
        select: { id: true },
      });

      const assetId = target.assetId || null;
      const assetName = target.assetName || proposal.id.slice(0, 8);

      let asset;
      if (assetId) {
        const existing = await prisma.knowledgeAsset.findFirst({
          where: { id: assetId, workspaceSettings: { clientId } },
          select: { id: true },
        });
        if (!existing) return { success: false, error: "Knowledge asset not found" };
        asset = await prisma.knowledgeAsset.update({
          where: { id: existing.id },
          data: { textContent: content },
        });
      } else {
        asset = await prisma.knowledgeAsset.create({
          data: {
            workspaceSettingsId: settings.id,
            name: assetName,
            type: "text",
            textContent: content,
          },
        });
      }

      await prisma.knowledgeAssetRevision.create({
        data: {
          clientId,
          workspaceSettingsId: settings.id,
          knowledgeAssetId: asset.id,
          proposalId: proposal.id,
          name: asset.name,
          type: asset.type,
          fileUrl: asset.fileUrl,
          textContent: asset.textContent,
          action: "APPLY_PROPOSAL",
          createdByUserId: user.id,
          createdByEmail: user.email ?? null,
        },
      });
    } else {
      return { success: false, error: "Unsupported proposal type" };
    }

    await prisma.messagePerformanceProposal.update({
      where: { id: proposal.id },
      data: {
        status: "APPLIED",
        appliedByUserId: user.id,
        appliedByEmail: user.email ?? null,
        appliedAt: new Date(),
      },
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to apply proposal" };
  }
}
