import { prisma } from "@/lib/prisma";
import { computeAIDraftResponseDisposition } from "@/lib/ai-drafts/response-disposition";

export type StaleDraftRecoveryResult = {
  checked: number;
  recovered: number;
  missingMessages: number;
  errors: string[];
};

export async function recoverStaleSendingDrafts(opts?: {
  staleMinutes?: number;
  limit?: number;
}): Promise<StaleDraftRecoveryResult> {
  const staleMinutes = opts?.staleMinutes ?? 10;
  const limit = opts?.limit ?? 100;
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

  const drafts = await prisma.aIDraft.findMany({
    where: { status: "sending", updatedAt: { lt: cutoff } },
    include: {
      sentMessages: {
        select: { body: true, sentBy: true },
        orderBy: { sentAt: "desc" },
        take: 1,
      },
    },
    take: limit,
  });

  const result: StaleDraftRecoveryResult = {
    checked: drafts.length,
    recovered: 0,
    missingMessages: 0,
    errors: [],
  };

  for (const draft of drafts) {
    try {
      const message = draft.sentMessages[0] ?? null;
      const sentBy = message?.sentBy === "ai" || message?.sentBy === "setter" ? message.sentBy : null;
      const responseDisposition = computeAIDraftResponseDisposition({
        sentBy,
        draftContent: draft.content,
        finalContent: message?.body || draft.content,
      });

      if (!message) result.missingMessages++;

      const updated = await prisma.aIDraft.updateMany({
        where: { id: draft.id, status: "sending" },
        data: { status: "approved", responseDisposition },
      });

      if (updated.count > 0) result.recovered++;
    } catch (error) {
      result.errors.push(`${draft.id}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  return result;
}
