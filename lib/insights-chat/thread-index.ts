import "server-only";

import { prisma } from "@/lib/prisma";
import type { InsightThreadIndexItem } from "@/lib/insights-chat/citations";
import type { ConversationInsight, FollowUpEffectiveness } from "@/lib/insights-chat/thread-extractor";
import type { SelectedInsightThread } from "@/lib/insights-chat/thread-selection";
import { computeFollowUpPriorityScore } from "@/lib/insights-chat/fast-seed";

function formatLeadLabel(lead: { firstName: string | null; lastName: string | null; email: string | null }): string {
  const name = `${lead.firstName || ""} ${lead.lastName || ""}`.trim();
  const email = (lead.email || "").trim();
  if (name && email) return `${name} <${email}>`;
  if (name) return name;
  if (email) return email;
  return "Unknown lead";
}

function clampText(text: string, maxLen: number): string {
  const cleaned = (text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLen - 1))}…`;
}

export async function buildInsightThreadIndex(opts: {
  clientId: string;
  selectedMeta: SelectedInsightThread[];
  maxThreads?: number;
}): Promise<InsightThreadIndexItem[]> {
  const maxThreads = Math.max(1, Math.min(500, Math.trunc(Number(opts.maxThreads ?? opts.selectedMeta.length) || 1)));
  const meta = opts.selectedMeta.slice(0, maxThreads);
  const leadIds = Array.from(new Set(meta.map((m) => m.leadId)));
  if (leadIds.length === 0) return [];

  const [leads, insights] = await Promise.all([
    prisma.lead.findMany({
      where: { clientId: opts.clientId, id: { in: leadIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        emailCampaign: { select: { id: true, name: true } },
      },
    }),
    prisma.leadConversationInsight.findMany({
      where: { leadId: { in: leadIds } },
      select: { leadId: true, insight: true },
    }),
  ]);

  const leadById = new Map(leads.map((l) => [l.id, l]));
  const summaryByLeadId = new Map<string, string>();
  const followUpByLeadId = new Map<string, FollowUpEffectiveness | null>();

  for (const row of insights) {
    const insight = row.insight as any as ConversationInsight;
    if (insight?.summary) summaryByLeadId.set(row.leadId, String(insight.summary));
    // Extract follow-up effectiveness for Phase 29c
    if (insight?.follow_up_effectiveness !== undefined) {
      followUpByLeadId.set(row.leadId, insight.follow_up_effectiveness);
    }
  }

  return meta.map((row, i) => {
    const lead = leadById.get(row.leadId);
    const leadLabel = lead ? formatLeadLabel(lead) : row.leadId;
    const campaignName = lead?.emailCampaign?.name ?? null;
    const campaignId = lead?.emailCampaign?.id ?? row.emailCampaignId ?? null;
    const ref = `T${String(i + 1).padStart(3, "0")}`;
    const summary = clampText(summaryByLeadId.get(row.leadId) || "", 380) || "No extracted summary available.";

    // Extract follow-up metadata (Phase 29c)
    const followUpEffectiveness = followUpByLeadId.get(row.leadId);
    const followUpScore = followUpEffectiveness ? computeFollowUpPriorityScore(followUpEffectiveness) : undefined;
    const convertedAfterObjection = followUpEffectiveness?.converted_after_objection === true ? true : undefined;

    return {
      ref,
      leadId: row.leadId,
      outcome: row.outcome,
      exampleType: row.exampleType,
      selectionBucket: row.selectionBucket,
      emailCampaignId: campaignId,
      campaignName,
      leadLabel,
      summary,
      // Phase 29c: Follow-up metadata
      ...(followUpScore !== undefined && followUpScore > 0 ? { followUpScore } : {}),
      ...(convertedAfterObjection ? { convertedAfterObjection } : {}),
    };
  });
}

