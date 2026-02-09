import "server-only";

import type { DraftPipelineArtifact } from "@prisma/client";

import type { AutoSendOptimizationSelection } from "@/lib/auto-send/optimization-context";
import type { AutoSendEvaluation } from "@/lib/auto-send-evaluator";
import type { LeadContextBundle } from "@/lib/lead-context-bundle";
import { DRAFT_PIPELINE_STAGES, type DraftRunContextPack } from "@/lib/draft-pipeline/types";

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function formatJsonForPrompt(value: unknown, maxChars: number): string {
  const limit = clampInt(maxChars, 0, 50_000);
  if (!value) return "None.";
  let json: string;
  try {
    json = JSON.stringify(value, null, 2);
  } catch {
    return "None.";
  }
  if (json.length <= limit) return json;
  return json.slice(0, Math.max(0, limit - 12)).trimEnd() + "\n…(truncated)";
}

function pickArtifact(opts: {
  artifacts: DraftPipelineArtifact[];
  stage: string;
  iteration: number;
}): DraftPipelineArtifact | null {
  const stage = opts.stage;
  const it = clampInt(opts.iteration, 0, 1000);

  // Prefer exact iteration, otherwise fallback to the latest <= iteration.
  const exact = opts.artifacts.find((a) => a.stage === stage && a.iteration === it);
  if (exact) return exact;

  let best: DraftPipelineArtifact | null = null;
  for (const a of opts.artifacts) {
    if (a.stage !== stage) continue;
    if (a.iteration > it) continue;
    if (!best || a.iteration > best.iteration || a.createdAt > best.createdAt) {
      best = a;
    }
  }
  return best;
}

export function buildDraftRunContextPack(opts: {
  runId: string;
  iteration: number;
  draft: string;
  evaluation: AutoSendEvaluation;
  threshold: number;
  artifacts: DraftPipelineArtifact[];
  leadContextBundle: LeadContextBundle | null;
  optimizationContext: AutoSendOptimizationSelection | null;
}): DraftRunContextPack {
  const it = clampInt(opts.iteration, 0, 1000);

  const strategyArtifact = pickArtifact({
    artifacts: opts.artifacts,
    stage: DRAFT_PIPELINE_STAGES.draftStrategyStep1,
    iteration: 0,
  });
  const gateArtifact = pickArtifact({
    artifacts: opts.artifacts,
    stage: DRAFT_PIPELINE_STAGES.meetingOverseerGate,
    iteration: it,
  });

  const evaluationSummary = {
    safeToSend: Boolean(opts.evaluation.safeToSend),
    requiresHumanReview: Boolean(opts.evaluation.requiresHumanReview),
    confidence: typeof opts.evaluation.confidence === "number" ? opts.evaluation.confidence : null,
    threshold: opts.threshold,
    source: opts.evaluation.source ?? null,
    hardBlockCode: opts.evaluation.hardBlockCode ?? null,
    reason: opts.evaluation.reason ?? null,
  };

  const primary = [
    {
      label: "Evaluator (why confidence is low)",
      content: formatJsonForPrompt(evaluationSummary, 2400),
    },
    {
      label: "Current draft to revise",
      content: (opts.draft || "").trim() || "None.",
    },
    {
      label: "Most recent meeting overseer gate (if any)",
      content: formatJsonForPrompt(gateArtifact?.payload ?? null, 3000),
    },
  ];

  const secondary = [
    {
      label: "Draft strategy (Step 1)",
      content: formatJsonForPrompt(strategyArtifact?.payload ?? null, 3000),
    },
    ...(opts.optimizationContext
      ? [
          {
            label: "Optimization context (best-effort)",
            content: [
              opts.optimizationContext.selected_context_markdown || "",
              opts.optimizationContext.what_to_apply?.length ? `What to apply:\n- ${opts.optimizationContext.what_to_apply.join("\n- ")}` : "",
              opts.optimizationContext.what_to_avoid?.length ? `What to avoid:\n- ${opts.optimizationContext.what_to_avoid.join("\n- ")}` : "",
              opts.optimizationContext.missing_info?.length ? `Missing info:\n- ${opts.optimizationContext.missing_info.join("\n- ")}` : "",
            ]
              .filter(Boolean)
              .join("\n\n")
              .trim(),
          },
        ]
      : []),
    ...(opts.leadContextBundle?.knowledgeContext
      ? [
          {
            label: "Workspace knowledge",
            content: opts.leadContextBundle.knowledgeContext.trim(),
          },
        ]
      : []),
    ...(opts.leadContextBundle?.leadMemoryContext
      ? [
          {
            label: "Lead memory (redacted)",
            content: opts.leadContextBundle.leadMemoryContext.trim(),
          },
        ]
      : []),
  ];

  const tertiary = [
    {
      label: "Run metadata",
      content: JSON.stringify({ runId: opts.runId, iteration: it }, null, 2),
    },
  ];

  const primaryChars = primary.reduce((sum, s) => sum + s.content.length, 0);
  const secondaryChars = secondary.reduce((sum, s) => sum + s.content.length, 0);
  const tertiaryChars = tertiary.reduce((sum, s) => sum + s.content.length, 0);

  return {
    runId: opts.runId,
    iteration: it,
    primary,
    secondary,
    tertiary,
    stats: {
      primaryChars,
      secondaryChars,
      tertiaryChars,
      totalChars: primaryChars + secondaryChars + tertiaryChars,
    },
  };
}

export function renderDraftRunContextPackMarkdown(pack: DraftRunContextPack): string {
  const renderSection = (title: string, sections: DraftRunContextPack["primary"]): string => {
    const parts: string[] = [`# ${title}`];
    for (const section of sections) {
      const body = (section.content || "").trim() || "None.";
      parts.push(`## ${section.label}\n${body}`);
    }
    return parts.join("\n\n");
  };

  const out = [
    renderSection("PRIMARY", pack.primary),
    renderSection("SECONDARY", pack.secondary),
    renderSection("TERTIARY", pack.tertiary),
    `# STATS\n${JSON.stringify(pack.stats, null, 2)}`,
  ];
  return out.join("\n\n");
}

