import "server-only";

import { prisma } from "@/lib/prisma";
import { scoreLead } from "@/lib/lead-scoring";

/**
 * Background job handler for lead scoring.
 * Scores a lead based on their conversation history.
 */
export async function runLeadScoringPostProcessJob(opts: {
  clientId: string;
  leadId: string;
  messageId: string;
}): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: opts.leadId },
    select: {
      id: true,
      clientId: true,
    },
  });

  if (!lead) {
    console.log(`[Lead Scoring] Lead not found: ${opts.leadId}`);
    return;
  }

  if (lead.clientId !== opts.clientId) {
    console.log(`[Lead Scoring] Client mismatch for lead ${opts.leadId}`);
    return;
  }

  const result = await scoreLead(opts.leadId);

  if (result.success) {
    if (result.disqualified) {
      console.log(`[Lead Scoring] Lead ${opts.leadId} disqualified (overallScore=1)`);
    } else if (result.score) {
      console.log(
        `[Lead Scoring] Lead ${opts.leadId} scored: fit=${result.score.fitScore} intent=${result.score.intentScore} overall=${result.score.overallScore}`
      );
    } else {
      console.log(`[Lead Scoring] Lead ${opts.leadId} not scored (no inbound messages)`);
    }
  } else {
    console.error(`[Lead Scoring] Failed to score lead ${opts.leadId}: ${result.error}`);
    // Retry only when the error is marked retryable (e.g. transient timeouts). Non-retryable failures should not churn.
    if (result.retryable) {
      throw new Error(result.error || "Lead scoring failed (retryable)");
    }
  }
}
