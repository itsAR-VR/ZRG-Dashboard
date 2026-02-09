import "server-only";

import { prisma } from "@/lib/prisma";
import { decideMemoryProposal, resolveMemoryPolicySettings } from "@/lib/memory-governance/policy";
import type { MemoryPolicySettings, MemoryProposal } from "@/lib/memory-governance/types";
import { LeadMemorySource } from "@prisma/client";

function addDaysUtc(now: Date, days: number): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + Math.max(1, Math.trunc(days)));
  return d;
}

type PersistedProposalRow = {
  scope: "lead" | "workspace";
  category: string;
  content: string;
  ttlDays: number;
  confidence: number;
  status: "APPROVED" | "PENDING";
};

export async function persistGovernedMemoryProposals(opts: {
  clientId: string;
  leadId?: string | null;
  draftId?: string | null;
  draftPipelineRunId?: string | null;
  proposals: MemoryProposal[];
  policy?: Partial<MemoryPolicySettings> | MemoryPolicySettings | null;
  db?: typeof prisma;
}): Promise<{
  approvedCount: number;
  pendingCount: number;
  droppedCount: number;
  proposals: PersistedProposalRow[];
}> {
  const db = opts.db ?? prisma;
  const clientId = (opts.clientId || "").trim();
  const leadId = (opts.leadId || "").trim() || null;
  const runId = (opts.draftPipelineRunId || "").trim() || null;
  const draftId = (opts.draftId || "").trim() || null;

  const incoming = Array.isArray(opts.proposals) ? opts.proposals : [];
  if (!clientId || incoming.length === 0) {
    return { approvedCount: 0, pendingCount: 0, droppedCount: 0, proposals: [] };
  }

  const policy = resolveMemoryPolicySettings(opts.policy ?? null);
  const now = new Date();

  const decided = incoming
    .map((p) => decideMemoryProposal(p, policy))
    .filter((d): d is NonNullable<typeof d> => Boolean(d));

  // If proposal wants lead scope but we don't have a lead id, drop it.
  const filtered = decided.filter((d) => !(d.proposal.scope === "lead" && !leadId));

  const droppedCount = Math.max(0, incoming.length - filtered.length);
  if (filtered.length === 0) {
    return { approvedCount: 0, pendingCount: 0, droppedCount, proposals: [] };
  }

  const [existingLead, existingWorkspace] = await Promise.all([
    leadId
      ? db.leadMemoryEntry
          .findMany({
            where: {
              clientId,
              leadId,
              source: LeadMemorySource.INFERENCE,
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
            select: { category: true, content: true },
            take: 200,
          })
          .catch(() => [])
      : Promise.resolve([]),
    db.workspaceMemoryEntry
      .findMany({
        where: {
          clientId,
          source: LeadMemorySource.INFERENCE,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { category: true, content: true },
        take: 200,
      })
      .catch(() => []),
  ]);

  const leadKeySet = new Set(existingLead.map((e) => `${e.category}|||${e.content}`));
  const workspaceKeySet = new Set(existingWorkspace.map((e) => `${e.category}|||${e.content}`));

  const leadCreates: Array<{
    clientId: string;
    leadId: string;
    category: string;
    content: string;
    source: LeadMemorySource;
    status: "APPROVED" | "PENDING";
    proposedByDraftPipelineRunId?: string | null;
    proposedByDraftId?: string | null;
    expiresAt?: Date | null;
  }> = [];

  const workspaceCreates: Array<{
    clientId: string;
    category: string;
    content: string;
    source: LeadMemorySource;
    status: "APPROVED" | "PENDING";
    proposedByDraftPipelineRunId?: string | null;
    proposedByDraftId?: string | null;
    expiresAt?: Date | null;
  }> = [];

  const proposalRows: PersistedProposalRow[] = [];

  for (const d of filtered) {
    const key = `${d.proposal.category}|||${d.scrubbedContent}`;
    const expiresAt = addDaysUtc(now, d.effectiveTtlDays);

    if (d.proposal.scope === "lead" && leadId) {
      if (leadKeySet.has(key)) continue;
      leadKeySet.add(key);
      leadCreates.push({
        clientId,
        leadId,
        category: d.proposal.category,
        content: d.scrubbedContent,
        source: LeadMemorySource.INFERENCE,
        status: d.status,
        proposedByDraftPipelineRunId: runId,
        proposedByDraftId: draftId,
        expiresAt,
      });
      proposalRows.push({
        scope: "lead",
        category: d.proposal.category,
        content: d.scrubbedContent,
        ttlDays: d.effectiveTtlDays,
        confidence: d.proposal.confidence,
        status: d.status,
      });
      continue;
    }

    if (d.proposal.scope === "workspace") {
      if (workspaceKeySet.has(key)) continue;
      workspaceKeySet.add(key);
      workspaceCreates.push({
        clientId,
        category: d.proposal.category,
        content: d.scrubbedContent,
        source: LeadMemorySource.INFERENCE,
        status: d.status,
        proposedByDraftPipelineRunId: runId,
        proposedByDraftId: draftId,
        expiresAt,
      });
      proposalRows.push({
        scope: "workspace",
        category: d.proposal.category,
        content: d.scrubbedContent,
        ttlDays: d.effectiveTtlDays,
        confidence: d.proposal.confidence,
        status: d.status,
      });
    }
  }

  if (leadCreates.length > 0) {
    await db.leadMemoryEntry.createMany({ data: leadCreates }).catch(() => null);
  }
  if (workspaceCreates.length > 0) {
    await db.workspaceMemoryEntry.createMany({ data: workspaceCreates }).catch(() => null);
  }

  let approvedCount = 0;
  let pendingCount = 0;
  for (const row of proposalRows) {
    if (row.status === "APPROVED") approvedCount += 1;
    else pendingCount += 1;
  }

  return { approvedCount, pendingCount, droppedCount, proposals: proposalRows };
}

