"use server";

import { prisma } from "@/lib/prisma";
import {
  requireAuthUser,
  requireClientAccess,
  requireClientAdminAccess,
  isTrueSuperAdminUser,
} from "@/lib/workspace-access";
import { coerceConfidencePolicyConfig } from "@/lib/confidence-policy";

type ProposalPublic = {
  id: string;
  policyKey: string;
  status: string;
  title: string;
  summary: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  appliedAt: Date | null;
  payload?: unknown;
  evidence?: unknown;
};

export async function listConfidencePolicyProposals(
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

    const proposals = await prisma.confidencePolicyProposal.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        policyKey: true,
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

    const data = proposals.map((p) => ({
      id: p.id,
      policyKey: p.policyKey,
      status: p.status,
      title: p.title,
      summary: p.summary,
      createdAt: p.createdAt,
      approvedAt: p.approvedAt,
      appliedAt: p.appliedAt,
      ...(isAdmin ? { payload: p.payload, evidence: p.evidence } : {}),
    }));

    return { success: true, data: { proposals: data, isAdmin } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load proposals" };
  }
}

export async function approveConfidencePolicyProposal(
  clientId: string | null | undefined,
  proposalId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    const { userId, userEmail } = await requireClientAdminAccess(clientId);

    const proposal = await prisma.confidencePolicyProposal.findFirst({
      where: { id: proposalId, clientId },
      select: { id: true },
    });
    if (!proposal) return { success: false, error: "Proposal not found" };

    await prisma.confidencePolicyProposal.update({
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

export async function rejectConfidencePolicyProposal(
  clientId: string | null | undefined,
  proposalId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireClientAdminAccess(clientId);

    const proposal = await prisma.confidencePolicyProposal.findFirst({
      where: { id: proposalId, clientId },
      select: { id: true },
    });
    if (!proposal) return { success: false, error: "Proposal not found" };

    await prisma.confidencePolicyProposal.update({
      where: { id: proposal.id },
      data: { status: "REJECTED" },
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to reject proposal" };
  }
}

export async function applyConfidencePolicyProposal(
  clientId: string | null | undefined,
  proposalId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    const user = await requireAuthUser();
    if (!isTrueSuperAdminUser(user)) return { success: false, error: "Unauthorized" };

    const proposal = await prisma.confidencePolicyProposal.findFirst({
      where: { id: proposalId, clientId },
      select: { id: true, status: true, policyKey: true, payload: true },
    });
    if (!proposal) return { success: false, error: "Proposal not found" };
    if (proposal.status !== "APPROVED") {
      return { success: false, error: "Proposal must be approved before applying" };
    }

    const config = coerceConfidencePolicyConfig(proposal.policyKey, proposal.payload);

    const policy = await prisma.confidencePolicy.upsert({
      where: { clientId_policyKey: { clientId, policyKey: proposal.policyKey } },
      create: {
        clientId,
        policyKey: proposal.policyKey,
        config,
      },
      update: {
        config,
      },
      select: { id: true },
    });

    await prisma.confidencePolicyRevision.create({
      data: {
        clientId,
        confidencePolicyId: policy.id,
        proposalId: proposal.id,
        policyKey: proposal.policyKey,
        config,
        action: "APPLY_PROPOSAL",
        createdByUserId: user.id,
        createdByEmail: user.email ?? null,
      },
      select: { id: true },
    });

    await prisma.confidencePolicyProposal.update({
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

export type ConfidencePolicyRevisionRecord = {
  id: string;
  policyKey: string;
  action: string;
  config: unknown;
  createdAt: string;
  createdByEmail: string | null;
};

export async function getConfidencePolicyRevisions(
  clientId: string | null | undefined,
  policyKey: string
): Promise<{ success: boolean; data?: { revisions: ConfidencePolicyRevisionRecord[] }; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireClientAdminAccess(clientId);

    const revisions = await prisma.confidencePolicyRevision.findMany({
      where: { clientId, policyKey },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        policyKey: true,
        action: true,
        config: true,
        createdAt: true,
        createdByEmail: true,
      },
    });

    return {
      success: true,
      data: {
        revisions: revisions.map((r) => ({
          id: r.id,
          policyKey: r.policyKey,
          action: r.action,
          config: r.config,
          createdAt: r.createdAt.toISOString(),
          createdByEmail: r.createdByEmail ?? null,
        })),
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load history" };
  }
}

export async function rollbackConfidencePolicyRevision(
  clientId: string | null | undefined,
  revisionId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    const user = await requireAuthUser();
    if (!isTrueSuperAdminUser(user)) return { success: false, error: "Unauthorized" };

    const revision = await prisma.confidencePolicyRevision.findFirst({
      where: { id: revisionId, clientId },
      select: { policyKey: true, config: true },
    });
    if (!revision) return { success: false, error: "Revision not found" };
    if (!revision.config) return { success: false, error: "Revision config missing" };

    const config = coerceConfidencePolicyConfig(revision.policyKey, revision.config);

    const policy = await prisma.confidencePolicy.upsert({
      where: { clientId_policyKey: { clientId, policyKey: revision.policyKey } },
      create: {
        clientId,
        policyKey: revision.policyKey,
        config,
      },
      update: {
        config,
      },
      select: { id: true },
    });

    await prisma.confidencePolicyRevision.create({
      data: {
        clientId,
        confidencePolicyId: policy.id,
        policyKey: revision.policyKey,
        config,
        action: "ROLLBACK",
        createdByUserId: user.id,
        createdByEmail: user.email ?? null,
      },
      select: { id: true },
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to rollback policy" };
  }
}

