import "server-only";

import { prisma } from "@/lib/prisma";
import { validateArtifactPayload } from "@/lib/draft-pipeline/validate-payload";
import { DRAFT_PIPELINE_STAGES } from "@/lib/draft-pipeline/types";

export type AutoSendRevisionLoopStopReason =
  | "threshold_met"
  | "hard_block"
  | "no_improvement"
  | "timeout"
  | "exhausted"
  | "error";

export type AutoSendRevisionLoopSummary = {
  stopReason: AutoSendRevisionLoopStopReason;
  iterationsUsed: number;
  threshold: number;
  startConfidence: number;
  endConfidence: number;
  deltaConfidence: number;
  cacheHits: number;
  elapsedMs: number;
  channel: string;
};

export async function persistAutoSendRevisionLoopSummary(opts: {
  clientId: string;
  leadId: string;
  draftId: string;
  runId: string;
  summary: AutoSendRevisionLoopSummary;
}): Promise<void> {
  const runId = (opts.runId || "").trim();
  if (!runId) return;

  const payload = validateArtifactPayload(opts.summary);

  // 1) Persist on the run for deterministic cross-agent context.
  if (payload !== null) {
    await prisma.draftPipelineArtifact
      .upsert({
        where: {
          runId_stage_iteration: {
            runId,
            stage: DRAFT_PIPELINE_STAGES.autoSendRevisionLoop,
            iteration: 0,
          },
        },
        create: {
          runId,
          stage: DRAFT_PIPELINE_STAGES.autoSendRevisionLoop,
          iteration: 0,
          payload,
        },
        update: { payload },
        select: { id: true },
      })
      .catch(() => null);
  }

  // 2) Also store as stats-only AIInteraction for super-admin observability.
  await prisma.aIInteraction
    .create({
      data: {
        clientId: opts.clientId,
        leadId: opts.leadId,
        source: "lib:auto_send.orchestrator",
        featureId: "auto_send.revision_loop",
        promptKey: null,
        model: "internal",
        apiType: "internal",
        status: "success",
        metadata: {
          runId,
          draftId: opts.draftId,
          ...opts.summary,
        },
      },
    })
    .catch(() => null);
}

