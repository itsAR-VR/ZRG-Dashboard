import "server-only";

import { prisma } from "@/lib/prisma";

export type AutoSendDecisionRecord = {
  draftId: string;
  evaluatedAt: Date;
  confidence?: number | null;
  threshold?: number | null;
  reason?: string | null;
  action: "send_immediate" | "send_delayed" | "needs_review" | "skip" | "error";
  slackNotified?: boolean;
  // Phase 70: Slack message metadata for interactive button updates
  slackNotificationChannelId?: string | null;
  slackNotificationMessageTs?: string | null;
};

export async function recordAutoSendDecision(record: AutoSendDecisionRecord): Promise<void> {
  const data = {
    autoSendEvaluatedAt: record.evaluatedAt,
    autoSendConfidence: typeof record.confidence === "number" ? record.confidence : null,
    autoSendThreshold: typeof record.threshold === "number" ? record.threshold : null,
    autoSendReason: record.reason ? record.reason : null,
    autoSendAction: record.action,
    autoSendSlackNotified: Boolean(record.slackNotified),
    // Phase 70: Persist Slack message metadata for interactive button updates
    slackNotificationChannelId: record.slackNotificationChannelId ?? null,
    slackNotificationMessageTs: record.slackNotificationMessageTs ?? null,
  };

  // Never let retries "downgrade" an already-recorded send decision.
  // (e.g. delayed scheduling retried as skip:already_scheduled, or send attempt retried after approval.)
  if (record.action === "skip" || record.action === "error") {
    await prisma.aIDraft.updateMany({
      where: { id: record.draftId, autoSendAction: null },
      data,
    });
    return;
  }

  await prisma.aIDraft.updateMany({
    where: {
      id: record.draftId,
      OR: [
        { autoSendAction: null },
        { autoSendAction: { notIn: ["send_immediate", "send_delayed"] } },
      ],
    },
    data,
  });
}
