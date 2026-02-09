import "server-only";

import { prisma } from "@/lib/prisma";

export async function getDraftPipelineRunByDraftId(draftId: string) {
  const cleaned = (draftId || "").trim();
  if (!cleaned) return null;
  return prisma.draftPipelineRun.findFirst({
    where: { draftId: cleaned },
    orderBy: { createdAt: "desc" },
  });
}

export async function getLatestDraftPipelineRunByTriggerMessageId(triggerMessageId: string, channel: string) {
  const cleanedId = (triggerMessageId || "").trim();
  const cleanedChannel = (channel || "").trim();
  if (!cleanedId || !cleanedChannel) return null;

  return prisma.draftPipelineRun.findUnique({
    where: {
      triggerMessageId_channel: {
        triggerMessageId: cleanedId,
        channel: cleanedChannel,
      },
    },
  });
}

export async function getArtifactsForRun(runId: string) {
  const cleaned = (runId || "").trim();
  if (!cleaned) return [];
  return prisma.draftPipelineArtifact.findMany({
    where: { runId: cleaned },
    orderBy: [{ iteration: "asc" }, { createdAt: "asc" }],
  });
}

