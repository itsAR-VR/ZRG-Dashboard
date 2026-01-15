import "server-only";

import type { ConversationInsightOutcome } from "@prisma/client";
import type { ConversationInsight } from "@/lib/insights-chat/thread-extractor";

export type FastSeedThread = {
  leadId: string;
  outcome: ConversationInsightOutcome;
  insight: ConversationInsight;
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function getFastSeedMinThreads(targetThreadsTotal: number): number {
  const override = Number.parseInt(process.env.INSIGHTS_FAST_SEED_MIN_THREADS || "", 10);
  if (Number.isFinite(override) && override > 0) return clampInt(override, 5, 200);

  const base = Math.ceil((Number.isFinite(targetThreadsTotal) ? targetThreadsTotal : 0) * 0.25);
  return clampInt(base, 10, 50);
}

export function getFastSeedMaxThreads(): number {
  const override = Number.parseInt(process.env.INSIGHTS_FAST_SEED_MAX_THREADS || "", 10);
  if (Number.isFinite(override) && override > 0) return clampInt(override, 10, 200);
  return 30;
}

const OUTCOME_PRIORITY: Record<ConversationInsightOutcome, number> = {
  BOOKED: 0,
  REQUESTED: 1,
  STALLED: 2,
  NO_RESPONSE: 3,
  UNKNOWN: 4,
};

export function selectFastSeedThreads(opts: {
  processedLeadIds: string[];
  selectedLeadsMeta: unknown;
  insightByLeadId: Map<string, ConversationInsight>;
  maxThreads: number;
}): FastSeedThread[] {
  const processed = new Set(opts.processedLeadIds);
  const meta = Array.isArray(opts.selectedLeadsMeta) ? (opts.selectedLeadsMeta as any[]) : [];
  const out: FastSeedThread[] = [];

  const rows = meta
    .map((row) => {
      const leadId = typeof row?.leadId === "string" ? row.leadId : null;
      if (!leadId || !processed.has(leadId)) return null;
      const outcome = typeof row?.outcome === "string" ? (row.outcome as ConversationInsightOutcome) : "UNKNOWN";
      const insight = opts.insightByLeadId.get(leadId);
      if (!insight) return null;
      return { leadId, outcome, insight };
    })
    .filter(Boolean) as FastSeedThread[];

  rows.sort((a, b) => (OUTCOME_PRIORITY[a.outcome] ?? 99) - (OUTCOME_PRIORITY[b.outcome] ?? 99));

  for (const row of rows) {
    out.push(row);
    if (out.length >= opts.maxThreads) break;
  }

  // Fallback if meta is missing: just use whatever insights we have.
  if (out.length === 0) {
    const ids = opts.processedLeadIds.filter((id) => opts.insightByLeadId.has(id)).slice(0, opts.maxThreads);
    for (const leadId of ids) {
      const insight = opts.insightByLeadId.get(leadId);
      if (insight) out.push({ leadId, outcome: "UNKNOWN", insight });
    }
  }

  return out;
}

function formatList(items: string[] | null | undefined, limit: number): string {
  const list = Array.isArray(items) ? items.filter(Boolean).slice(0, limit) : [];
  if (list.length === 0) return "- (none)";
  return list.map((v) => `- ${String(v).trim()}`).join("\n");
}

export function buildFastContextPackMarkdown(opts: {
  windowLabel: string;
  campaignContextLabel: string;
  processedThreads: number;
  targetThreadsTotal: number;
  threads: FastSeedThread[];
}): string {
  const header = `# Fast Context Pack (partial)\n\n- Window: ${opts.windowLabel}\n- Campaign scope: ${opts.campaignContextLabel}\n- Progress: ${opts.processedThreads}/${opts.targetThreadsTotal}\n\nThis pack is a **partial** view built early to provide a fast initial answer. A fuller pack and updated answer will appear when processing completes.\n`;

  const sections = opts.threads
    .slice(0, getFastSeedMaxThreads())
    .map((t, idx) => {
      return [
        `## Thread ${idx + 1} — ${t.outcome} — lead ${t.leadId}`,
        ``,
        `**Summary**`,
        String(t.insight.summary || "").trim() || "(missing)",
        ``,
        `**What worked**`,
        formatList(t.insight.what_worked, 6),
        ``,
        `**What failed**`,
        formatList(t.insight.what_failed, 4),
        ``,
        `**Key phrases**`,
        formatList(t.insight.key_phrases, 6),
        ``,
        `**Recommended tests**`,
        formatList(t.insight.recommended_tests, 5),
      ].join("\n");
    })
    .join("\n\n");

  return `${header}\n\n${sections}`.trim();
}

