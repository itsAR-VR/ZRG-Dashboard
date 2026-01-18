import "server-only";

import type { ConversationInsightOutcome } from "@prisma/client";
import type { ConversationInsight, FollowUpEffectiveness } from "@/lib/insights-chat/thread-extractor";

export type FastSeedThread = {
  leadId: string;
  outcome: ConversationInsightOutcome;
  insight: ConversationInsight;
  /** Follow-up effectiveness score (0-100), null if no follow-up exists */
  followUpScore: number | null;
};

// ============================================================================
// Follow-Up Priority Score (Phase 29c)
// ============================================================================

/**
 * Compute follow-up priority score for thread ordering.
 * Returns 0 if no follow-up effectiveness data exists.
 *
 * Score formula:
 * - Base: follow_up_effectiveness.score (0-100)
 * - Boost: +5 if converted_after_objection
 * - Clamp to [0, 105] (allows slight boost above 100)
 */
export function computeFollowUpPriorityScore(effectiveness: FollowUpEffectiveness | null | undefined): number {
  if (!effectiveness) return 0;

  const baseScore = typeof effectiveness.score === "number" ? effectiveness.score : 0;
  const objectionBoost = effectiveness.converted_after_objection === true ? 5 : 0;

  return Math.max(0, Math.min(105, baseScore + objectionBoost));
}

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

      // Compute follow-up priority score (Phase 29c)
      const followUpScore = computeFollowUpPriorityScore(insight.follow_up_effectiveness);

      return { leadId, outcome, insight, followUpScore: followUpScore > 0 ? followUpScore : null };
    })
    .filter(Boolean) as FastSeedThread[];

  // NEW ORDERING (Phase 29c):
  // 1. Follow-up priority score (desc) — highest signal threads first
  // 2. Outcome priority (BOOKED > REQUESTED > STALLED > NO_RESPONSE > UNKNOWN)
  // 3. Stable fallback (original order)
  rows.sort((a, b) => {
    // Follow-up score descending (higher is better)
    const followUpA = a.followUpScore ?? 0;
    const followUpB = b.followUpScore ?? 0;
    if (followUpA !== followUpB) return followUpB - followUpA;

    // Outcome priority ascending (lower number = better outcome)
    return (OUTCOME_PRIORITY[a.outcome] ?? 99) - (OUTCOME_PRIORITY[b.outcome] ?? 99);
  });

  for (const row of rows) {
    out.push(row);
    if (out.length >= opts.maxThreads) break;
  }

  // Fallback if meta is missing: just use whatever insights we have.
  if (out.length === 0) {
    const ids = opts.processedLeadIds.filter((id) => opts.insightByLeadId.has(id)).slice(0, opts.maxThreads);
    for (const leadId of ids) {
      const insight = opts.insightByLeadId.get(leadId);
      if (insight) {
        const followUpScore = computeFollowUpPriorityScore(insight.follow_up_effectiveness);
        out.push({ leadId, outcome: "UNKNOWN", insight, followUpScore: followUpScore > 0 ? followUpScore : null });
      }
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
      // Build follow-up section if available (Phase 29c)
      const followUp = t.insight.follow_up;
      const followUpScoreLabel = t.followUpScore !== null ? ` (follow-up score: ${t.followUpScore})` : "";

      const followUpSection =
        followUp && (followUp.what_worked?.length || followUp.what_failed?.length)
          ? [
              ``,
              `**Follow-Up Response Patterns** (PRIMARY)${followUpScoreLabel}`,
              `_What worked in follow-ups:_`,
              formatList(followUp.what_worked, 5),
              `_What failed in follow-ups:_`,
              formatList(followUp.what_failed, 3),
              `_Tone observations:_`,
              formatList(followUp.tone_observations, 3),
              followUp.objection_responses?.length
                ? [
                    `_Objection handling:_`,
                    ...followUp.objection_responses.slice(0, 3).map((o) => `- [${o.objection_type}] → "${o.agent_response.slice(0, 80)}${o.agent_response.length > 80 ? "…" : ""}" (${o.outcome})`),
                  ].join("\n")
                : "",
            ]
              .filter(Boolean)
              .join("\n")
          : "";

      return [
        `## Thread ${idx + 1} — ${t.outcome} — lead ${t.leadId}`,
        ``,
        `**Summary**`,
        String(t.insight.summary || "").trim() || "(missing)",
        followUpSection,
        ``,
        `**What worked** (overall)`,
        formatList(t.insight.what_worked, 6),
        ``,
        `**What failed** (overall)`,
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

