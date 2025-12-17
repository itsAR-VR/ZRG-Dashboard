import "server-only";

import { prisma } from "@/lib/prisma";

export const AI_INTERACTION_RETENTION_DAYS = 30;

declare global {
  // eslint-disable-next-line no-var
  var __zrgAiPruneLastRunMs: number | undefined;
}

function getCutoffDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function pruneOldAIInteractions(opts?: { retentionDays?: number }): Promise<void> {
  const retentionDays = opts?.retentionDays ?? AI_INTERACTION_RETENTION_DAYS;
  const cutoff = getCutoffDate(retentionDays);

  await prisma.aIInteraction.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
}

export async function pruneOldAIInteractionsMaybe(): Promise<void> {
  const now = Date.now();
  const last = globalThis.__zrgAiPruneLastRunMs ?? 0;

  // At most once per hour per runtime.
  if (now - last < 60 * 60 * 1000) return;

  globalThis.__zrgAiPruneLastRunMs = now;
  try {
    await pruneOldAIInteractions();
  } catch (error) {
    console.error("[AI Retention] Failed to prune old interactions:", error);
  }
}

