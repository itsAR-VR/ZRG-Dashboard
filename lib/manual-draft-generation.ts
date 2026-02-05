import "server-only";

import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { prisma } from "@/lib/prisma";
import { buildSentimentTranscriptFromMessages } from "@/lib/sentiment";

export type DraftChannel = "sms" | "email" | "linkedin";

const SUPPORTED_DRAFT_CHANNELS: DraftChannel[] = ["sms", "email", "linkedin"];

function isDraftChannel(value: string): value is DraftChannel {
  return SUPPORTED_DRAFT_CHANNELS.includes(value as DraftChannel);
}

export function collectDraftChannelsFromInboundHistory(channels: string[]): DraftChannel[] {
  const seen = new Set(channels.filter(isDraftChannel));
  return SUPPORTED_DRAFT_CHANNELS.filter((channel) => seen.has(channel));
}

export type ManualDraftGenerationSummary = {
  attempted: number;
  created: number;
  skipped: number;
  failed: number;
  channels: DraftChannel[];
};

/**
 * Best-effort draft backfill when sentiment is manually marked as draft-eligible.
 * Generates at most one pending draft per channel (email/sms/linkedin) with inbound history.
 */
export async function generateDraftsForLeadOnManualSentiment(opts: {
  leadId: string;
  sentimentTag: string;
  leadEmail: string | null;
}): Promise<ManualDraftGenerationSummary> {
  const summary: ManualDraftGenerationSummary = {
    attempted: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    channels: [],
  };

  if (!shouldGenerateDraft(opts.sentimentTag, opts.leadEmail)) {
    return summary;
  }

  const grouped = await prisma.message.groupBy({
    by: ["channel"],
    where: {
      leadId: opts.leadId,
      direction: "inbound",
    },
  });

  const channels = collectDraftChannelsFromInboundHistory(grouped.map((row) => row.channel));
  summary.channels = channels;

  for (const channel of channels) {
    summary.attempted += 1;

    const pendingDraft = await prisma.aIDraft.findFirst({
      where: {
        leadId: opts.leadId,
        channel,
        status: "pending",
      },
      select: { id: true },
    });

    if (pendingDraft) {
      summary.skipped += 1;
      continue;
    }

    try {
      const recentMessages = await prisma.message.findMany({
        where: { leadId: opts.leadId },
        orderBy: { sentAt: "desc" },
        take: 80,
        select: {
          sentAt: true,
          channel: true,
          direction: true,
          body: true,
          subject: true,
        },
      });

      const transcript = buildSentimentTranscriptFromMessages(recentMessages.reverse());
      const emailForChannel = channel === "email" ? opts.leadEmail : null;

      if (!shouldGenerateDraft(opts.sentimentTag, emailForChannel)) {
        summary.skipped += 1;
        continue;
      }

      const draftResult = await generateResponseDraft(opts.leadId, transcript, opts.sentimentTag, channel);

      if (draftResult.success && draftResult.draftId) {
        summary.created += 1;
      } else {
        summary.failed += 1;
      }
    } catch (error) {
      summary.failed += 1;
      console.warn("[Manual Draft Generation] Failed to generate draft", {
        leadId: opts.leadId,
        channel,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summary;
}
