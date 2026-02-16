import "server-only";

import { recomputeInboxCounts } from "@/lib/inbox-counts-recompute";
import { prisma } from "@/lib/prisma";

export async function recomputeDirtyInboxCounts(opts?: {
  limit?: number;
}): Promise<{ processed: number; failed: Array<{ clientId: string; error: string }> }> {
  const limit = Math.max(1, Math.min(100, opts?.limit ?? 10));
  const dirtyRows = await prisma.inboxCountsDirty.findMany({
    orderBy: { dirtyAt: "asc" },
    take: limit,
    select: { clientId: true },
  });

  const failed: Array<{ clientId: string; error: string }> = [];
  let processed = 0;

  for (const row of dirtyRows) {
    try {
      await recomputeInboxCounts(row.clientId);
      processed += 1;
    } catch (error) {
      failed.push({
        clientId: row.clientId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { processed, failed };
}
