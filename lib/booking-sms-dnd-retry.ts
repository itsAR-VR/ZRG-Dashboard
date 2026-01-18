/**
 * SMS DND Retry for Booking Progress (Phase 36)
 *
 * Handles retrying SMS sends for leads blocked by DND (Do Not Disturb) in GHL.
 *
 * Per Phase 36i:
 * - Retry every 2 hours until DND clears
 * - If DND blocks for >72 hours, skip SMS for that wave so the wave can advance
 */

import { prisma } from "@/lib/prisma";
import { approveAndSendDraftSystem } from "@/actions/message-actions";
import { checkSmsDndTimeout, skipChannelForWave } from "@/lib/booking-progress";
import { generateResponseDraft } from "@/lib/ai-drafts";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export interface SmsDndRetryResult {
  processed: number;
  retried: number;
  timedOut: number;
  succeeded: number;
  errors: string[];
}

/**
 * Retry SMS sends for leads with DND holds that are due for retry.
 * Called from the followups cron.
 */
export async function retrySmsDndHeldLeads(opts: {
  limit?: number;
} = {}): Promise<SmsDndRetryResult> {
  const { limit = 50 } = opts;
  const result: SmsDndRetryResult = {
    processed: 0,
    retried: 0,
    timedOut: 0,
    succeeded: 0,
    errors: [],
  };

  try {
    const twoHoursAgo = new Date(Date.now() - TWO_HOURS_MS);

    // Find leads with SMS DND holds that are due for retry
    const heldProgress = await prisma.leadCampaignBookingProgress.findMany({
      where: {
        smsDndHeldSince: { not: null },
        OR: [
          { smsDndLastRetryAt: null },
          { smsDndLastRetryAt: { lt: twoHoursAgo } },
        ],
      },
      take: limit,
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            phone: true,
            smsDndActive: true,
            sentimentTag: true,
            clientId: true,
            client: {
              select: {
                settings: true,
              },
            },
            messages: {
              where: { channel: "sms" },
              orderBy: { sentAt: "desc" },
              take: 10,
              select: {
                body: true,
                direction: true,
                sentAt: true,
              },
            },
          },
        },
        emailCampaign: {
          select: {
            id: true,
            bookingProcessId: true,
          },
        },
      },
    });

    for (const progress of heldProgress) {
      result.processed++;

      try {
        const { leadId, emailCampaignId } = progress;
        const lead = progress.lead;

        if (!lead || !lead.phone) {
          // Lead no longer has phone - skip SMS for this wave so we can advance.
          await skipChannelForWave({ leadId, emailCampaignId, channel: "sms" });
          result.timedOut++;
          continue;
        }

        // Check if 72h timeout exceeded
        const timeoutCheck = await checkSmsDndTimeout({ leadId, emailCampaignId });
        if (timeoutCheck.timedOut) {
          console.log(
            `[SMS DND Retry] 72h timeout exceeded for lead ${leadId} - skipping SMS for wave`
          );
          result.timedOut++;
          continue;
        }

        // DND appears cleared - try to send the SMS
        // First, check if there's a pending draft we can use
        const pendingDraft = await prisma.aIDraft.findFirst({
          where: {
            leadId,
            channel: "sms",
            status: "pending",
          },
          orderBy: { createdAt: "desc" },
        });

        if (pendingDraft) {
          const sendResult = await approveAndSendDraftSystem(pendingDraft.id, { sentBy: "ai" });

          if (sendResult.success) {
            result.succeeded++;
            console.log(`[SMS DND Retry] Successfully sent SMS for lead ${leadId}`);
          } else if (sendResult.errorCode === "sms_dnd") {
            result.retried++;
            console.log(`[SMS DND Retry] Still blocked by DND for lead ${leadId} - will retry later`);
          } else {
            result.errors.push(`Lead ${leadId}: ${sendResult.error}`);
          }
        } else {
          // No pending draft - generate a new one
          console.log(
            `[SMS DND Retry] No pending draft for lead ${leadId} - generating new draft`
          );

          // Build transcript from messages (reversed to chronological order)
          const messages = lead.messages || [];
          const transcript = messages
            .slice()
            .reverse()
            .map((m) => `${m.direction === "inbound" ? "Lead" : "You"}: ${m.body}`)
            .join("\n") || `Lead: [No recent messages]`;

          const sentimentTag = lead.sentimentTag || "Interested";

          const draftResult = await generateResponseDraft(
            leadId,
            transcript,
            sentimentTag,
            "sms"
          );

          if (draftResult.success && draftResult.draftId) {
            const sendResult = await approveAndSendDraftSystem(draftResult.draftId, { sentBy: "ai" });

            if (sendResult.success) {
              result.succeeded++;
            } else if (sendResult.errorCode === "sms_dnd") {
              result.retried++;
            } else {
              result.errors.push(`Lead ${leadId}: ${sendResult.error}`);
            }
          } else {
            // Draft generation failed - just update retry timestamp
            await prisma.leadCampaignBookingProgress.update({
              where: { id: progress.id },
              data: { smsDndLastRetryAt: new Date() },
            });
            result.errors.push(
              `Lead ${leadId}: Draft generation failed - ${draftResult.error}`
            );
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`Lead ${progress.leadId}: ${message}`);
      }
    }
  } catch (error) {
    console.error("[SMS DND Retry] Fatal error:", error);
    result.errors.push(
      `Fatal: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return result;
}
