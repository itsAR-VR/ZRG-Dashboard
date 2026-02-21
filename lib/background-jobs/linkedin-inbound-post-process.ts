import "server-only";

import { prisma } from "@/lib/prisma";
import { buildSentimentTranscriptFromMessages, classifySentiment, SENTIMENT_TO_STATUS, isPositiveSentiment } from "@/lib/sentiment";
import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { extractContactFromMessageContent } from "@/lib/signature-extractor";
import { triggerEnrichmentForLead } from "@/lib/clay-api";
import { ensureGhlContactIdForLead, syncGhlContactPhoneForLead } from "@/lib/ghl-contacts";
import { pauseFollowUpsOnReply, processMessageForAutoBooking, resumeAwaitingEnrichmentFollowUpsForLead } from "@/lib/followup-engine";
import { toStoredPhone } from "@/lib/phone-utils";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { enqueueLeadScoringJob } from "@/lib/lead-scoring";
import { maybeAssignLead } from "@/lib/lead-assignment";
import { notifyOnLeadSentimentChange } from "@/lib/notification-center";
import { ensureCallRequestedTask } from "@/lib/call-requested";
import { backfillMissingFollowUpTaskDrafts, hasPendingEligibleFollowUpTaskDraft } from "@/lib/followup-task-drafts";
import { extractSchedulerLinkFromText } from "@/lib/scheduling-link";
import { handleLeadSchedulerLinkIfPresent } from "@/lib/lead-scheduler-link";
import { upsertLeadCrmRowOnInterest } from "@/lib/lead-crm-row";
import { resolveBookingLink } from "@/lib/meeting-booking-provider";
import { coerceMeetingBookedSentimentToEvidence } from "@/lib/meeting-lifecycle";
import {
  cancelPendingTimingClarifyAttempt2OnInbound,
  runFollowUpTimingReengageGate,
  scheduleFollowUpTimingFromInbound,
} from "@/lib/followup-timing";
import { detectActionSignals, EMPTY_ACTION_SIGNAL_RESULT, hasActionSignal, notifyActionSignals } from "@/lib/action-signal-detector";

export async function runLinkedInInboundPostProcessJob(params: {
  clientId: string;
  leadId: string;
  messageId: string;
}): Promise<void> {
  console.log(`[LinkedIn Post-Process] Starting for message ${params.messageId}`);

  // Fetch message + lead + client
  const message = await prisma.message.findUnique({
    where: { id: params.messageId },
    include: {
      lead: {
        include: {
          client: {
            select: {
              id: true,
              ghlLocationId: true,
              ghlPrivateKey: true,
              settings: true,
            },
          },
        },
      },
    },
  });

  if (!message) {
    console.error(`[LinkedIn Post-Process] Message not found: ${params.messageId}`);
    return;
  }

  if (!message.lead) {
    console.error(`[LinkedIn Post-Process] Lead not found for message: ${params.messageId}`);
    return;
  }

  const lead = message.lead;
  const client = lead.client;

  // Skip outbound messages
  if (message.direction === "outbound") {
    console.log(`[LinkedIn Post-Process] Skipping outbound message`);
    return;
  }

  const messageBody = message.body || "";
  const messageSentAt = message.sentAt || new Date();
  const schedulerLink = extractSchedulerLinkFromText(messageBody);
  if (schedulerLink) {
    prisma.lead
      .updateMany({
        where: { id: lead.id, externalSchedulingLink: { not: schedulerLink } },
        data: { externalSchedulingLink: schedulerLink, externalSchedulingLinkLastSeenAt: new Date() },
      })
      .catch(() => undefined);
  }

  // 1. Extract Contact Info from Message
  // LinkedIn messages may contain phone numbers in signature
  const extractedContact = extractContactFromMessageContent(messageBody);

  if (extractedContact.foundInMessage) {
    const currentLead = await prisma.lead.findUnique({ where: { id: lead.id } });
    const contactUpdates: Record<string, unknown> = {};

    // Phone is the main thing we'd find in LinkedIn messages
    // (LinkedIn URL would already be known, email unlikely)
    if (extractedContact.phone && !currentLead?.phone) {
      const storedPhone = toStoredPhone(extractedContact.phone);
      if (storedPhone) {
        contactUpdates.phone = storedPhone;
        console.log(`[LinkedIn Post-Process] Extracted phone: ${storedPhone}`);
      }
    }

    if (Object.keys(contactUpdates).length > 0) {
      contactUpdates.enrichmentSource = "message_content";
      contactUpdates.enrichedAt = new Date();
      await prisma.lead.update({
        where: { id: lead.id },
        data: contactUpdates,
      });
      console.log(`[LinkedIn Post-Process] Updated lead ${lead.id} from message content`);

      // If we discovered a phone, sync to GHL
      if (contactUpdates.phone && client.ghlLocationId && client.ghlPrivateKey) {
        try {
          await ensureGhlContactIdForLead(lead.id, { allowCreateWithoutPhone: true });
          await syncGhlContactPhoneForLead(lead.id).catch(() => undefined);
        } catch (error) {
          console.warn(`[LinkedIn Post-Process] Failed to sync phone to GHL:`, error);
        }

        // Resume follow-ups that were waiting for enrichment
        await resumeAwaitingEnrichmentFollowUpsForLead(lead.id).catch(() => undefined);
      }
    }
  }

  // 2. AI Sentiment Classification
  const recentMessages = await prisma.message.findMany({
    where: { leadId: lead.id, channel: "linkedin" },
    orderBy: { sentAt: "desc" },
    take: 30,
    select: {
      sentAt: true,
      channel: true,
      direction: true,
      body: true,
      subject: true,
    },
  });

  const transcript = buildSentimentTranscriptFromMessages(recentMessages.reverse());

  // Store original sentiment before classification
  const previousSentiment = lead.sentimentTag;

  // Check if sentiment already analyzed (idempotency)
  const currentSentiment = lead.sentimentTag;
  const shouldClassify = !currentSentiment || currentSentiment === "New" || currentSentiment === "Neutral";

  if (shouldClassify) {
    let sentimentTag = await classifySentiment(transcript || messageBody, {
      clientId: client.id,
      leadId: lead.id,
      maxRetries: 1,
    });

    if (sentimentTag) {
      const meetingBookedGate = await coerceMeetingBookedSentimentToEvidence({
        leadId: lead.id,
        sentimentTag,
      });
      if (meetingBookedGate.downgraded) {
        console.log(
          `[LinkedIn Post-Process] Downgrading Meeting Booked (no provider evidence) -> ${meetingBookedGate.sentimentTag}`
        );
        sentimentTag = meetingBookedGate.sentimentTag as typeof sentimentTag;
      }

      // Update lead status based on sentiment
      const newStatus = SENTIMENT_TO_STATUS[sentimentTag];
      if (newStatus) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            status: newStatus,
            sentimentTag,
          },
        });
      }

      console.log(`[LinkedIn Post-Process] AI Classification: ${sentimentTag}`);
    }
  } else {
    console.log(`[LinkedIn Post-Process] Sentiment already analyzed: ${currentSentiment}`);
  }

  // 2b. Round-robin lead assignment (Phase 43)
  // Assign lead to next setter if sentiment is positive and not already assigned
  const finalSentiment = (await prisma.lead.findUnique({
    where: { id: lead.id },
    select: { sentimentTag: true },
  }))?.sentimentTag ?? null;

  await cancelPendingTimingClarifyAttempt2OnInbound({ leadId: lead.id }).catch(() => undefined);

  let timingFollowUpScheduled = false;
  const shouldRunTimingScheduler =
    finalSentiment === "Follow Up" ||
    (finalSentiment === "Not Interested" &&
      (await runFollowUpTimingReengageGate({
        clientId: client.id,
        leadId: lead.id,
        messageText: messageBody,
      }).then((gate) => gate.decision === "deferral")));

  if (shouldRunTimingScheduler) {
    const timingResult = await scheduleFollowUpTimingFromInbound({
      clientId: client.id,
      leadId: lead.id,
      messageId: message.id,
      messageText: messageBody,
      sentimentTag: "Follow Up",
      inboundChannel: "linkedin",
    });
    timingFollowUpScheduled = timingResult.scheduled;
  }

  await maybeAssignLead({
    leadId: lead.id,
    clientId: client.id,
    sentimentTag: finalSentiment,
    channel: "linkedin",
  });

  // 3. Pause Follow-Ups on Reply
  await pauseFollowUpsOnReply(lead.id);

  // 4. Auto-Booking Check
  const autoBook = await processMessageForAutoBooking(lead.id, messageBody, {
    channel: "linkedin",
    messageId: message.id,
    sentimentTag: finalSentiment,
  });
  if (autoBook.booked) {
    console.log(`[LinkedIn Post-Process] Auto-booked appointment for lead ${lead.id}: ${autoBook.appointmentId}`);
  }

  // 5. Auto-Start Follow-Up Sequences & Clay Enrichment
  // Reload lead to get updated sentiment after classification
  const updatedLead = await prisma.lead.findUnique({
    where: { id: lead.id },
    select: {
      id: true,
      sentimentTag: true,
      phone: true,
      email: true,
      linkedinUrl: true,
      enrichmentStatus: true,
    },
  });

  const newSentiment = updatedLead?.sentimentTag || lead.sentimentTag;

  notifyOnLeadSentimentChange({
    clientId: client.id,
    leadId: lead.id,
    previousSentimentTag: previousSentiment,
    newSentimentTag: newSentiment,
    messageId: message.id,
    latestInboundText: messageBody,
  }).catch(() => undefined);

  upsertLeadCrmRowOnInterest({
    leadId: lead.id,
    messageId: message.id,
    messageSentAt: message.sentAt ?? new Date(),
    channel: message.channel,
    sentimentTag: newSentiment,
  }).catch((error) => {
    console.warn(`[LinkedIn Post-Process] Failed to upsert CRM row for lead ${lead.id}:`, error);
  });

  handleLeadSchedulerLinkIfPresent({
    leadId: lead.id,
    latestInboundText: messageBody,
    observedSchedulerLink: schedulerLink,
  }).catch(() => undefined);

  let actionSignals = EMPTY_ACTION_SIGNAL_RESULT;
  let actionSignalCallRequested = false;
  try {
    const workspaceBookingLink = await resolveBookingLink(client.id, null)
      .then((result) => result.bookingLink)
      .catch(() => null);
    actionSignals = await detectActionSignals({
      strippedText: messageBody,
      fullText: messageBody,
      sentimentTag: newSentiment,
      workspaceBookingLink,
      clientId: client.id,
      leadId: lead.id,
      channel: "linkedin",
      provider: "unipile",
      aiRouteBookingProcessEnabled: client.settings?.aiRouteBookingProcessEnabled ?? true,
    });
    actionSignalCallRequested = hasActionSignal(actionSignals, "call_requested");
    if (actionSignals.signals.length > 0) {
      console.log("[LinkedIn Post-Process] Action signals:", actionSignals.signals.map((signal) => signal.type).join(", "));
      notifyActionSignals({
        clientId: client.id,
        leadId: lead.id,
        messageId: message.id,
        signals: actionSignals.signals,
        latestInboundText: messageBody,
        route: actionSignals.route,
      }).catch((error) => console.warn("[LinkedIn Post-Process] Action signal notify failed:", error));
    }
  } catch (error) {
    console.warn("[LinkedIn Post-Process] Action signal detection failed (non-fatal):", error);
  }

  // If booking-process routing indicates a lead-provided scheduler flow (Process 5),
  // run the scheduler-link handler with router force to avoid missing task creation
  // when deterministic “explicit instruction” matching is too strict.
  if (actionSignals.route?.processId === 5) {
    handleLeadSchedulerLinkIfPresent({
      leadId: lead.id,
      latestInboundText: messageBody,
      observedSchedulerLink: schedulerLink,
      forceBookingProcess5: true,
    }).catch(() => undefined);
  }

  // Create call task when booking-process routing detects callback intent (Process 4),
  // even if sentiment classification picked a different tag.
  if (actionSignalCallRequested || newSentiment === "Call Requested") {
    ensureCallRequestedTask({
      leadId: lead.id,
      latestInboundText: messageBody,
      force: actionSignalCallRequested,
    }).catch(() => undefined);
  }

  // Phase 66: Removed sentiment-based Meeting Requested auto-start.
  // Meeting Requested is now triggered by setter email reply only
  // (see autoStartMeetingRequestedSequenceOnSetterEmailReply in lib/followup-automation.ts)

  // 5. Clay Enrichment (if positive sentiment and missing phone)
  if (isPositiveSentiment(newSentiment) && updatedLead) {
    const shouldSkipEnrichment =
      updatedLead.enrichmentStatus === "enriched" ||
      updatedLead.enrichmentStatus === "pending" ||
      updatedLead.enrichmentStatus === "not_needed";

    if (!shouldSkipEnrichment && updatedLead.email && !updatedLead.phone) {
      console.log(`[LinkedIn Post-Process] Triggering Clay phone enrichment for lead ${lead.id}`);

      // Mark as pending
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          enrichmentStatus: "pending",
          enrichmentLastRetry: new Date(),
        },
      });

      try {
        const fullName = `${lead.firstName || ""} ${lead.lastName || ""}`.trim();
        const enrichmentRequest = {
          leadId: lead.id,
          emailAddress: updatedLead.email,
          firstName: lead.firstName || undefined,
          lastName: lead.lastName || undefined,
          fullName: fullName || undefined,
          linkedInProfile: updatedLead.linkedinUrl || undefined,
        };

        // Trigger Clay enrichment for phone only (we already have LinkedIn)
        await triggerEnrichmentForLead(enrichmentRequest, false, true);
        console.log(`[LinkedIn Post-Process] Clay enrichment triggered`);

        // Resume follow-ups that were waiting for enrichment
        await resumeAwaitingEnrichmentFollowUpsForLead(lead.id).catch(() => undefined);
      } catch (error) {
        console.error(`[LinkedIn Post-Process] Clay enrichment failed:`, error);
        // Non-fatal: continue processing
      }
    }
  }

  // 6. GHL Contact Sync (ensure contact exists in GHL)
  if (client.ghlLocationId && client.ghlPrivateKey) {
    try {
      await ensureGhlContactIdForLead(lead.id, { allowCreateWithoutPhone: true });
    } catch (error) {
      console.error(`[LinkedIn Post-Process] GHL sync failed:`, error);
      // Non-fatal
    }
  }

  // 7. AI Draft Generation
  let schedulingHandled = false;
  const shouldAttemptFollowUpRouting = newSentiment === "Follow Up" && timingFollowUpScheduled;
  if (shouldAttemptFollowUpRouting) {
    try {
      const backfill = await backfillMissingFollowUpTaskDrafts({ leadId: lead.id, limit: 10, lookbackDays: 120 });
      if (backfill.errors.length > 0) {
        console.warn("[LinkedIn Post-Process] FollowUpTask draft backfill errors:", backfill.errors.slice(0, 3));
      }
    } catch (error) {
      console.warn("[LinkedIn Post-Process] FollowUpTask draft backfill failed:", error);
    }

    const hasPendingRoutedDraft = await hasPendingEligibleFollowUpTaskDraft({
      leadId: lead.id,
      limit: 50,
      lookbackDays: 120,
    }).catch(() => true);

    if (!hasPendingRoutedDraft) {
      console.warn(
        "[LinkedIn Post-Process] follow-up timing scheduled but no eligible pending routed draft found; falling back to normal draft generation"
      );
    } else {
      schedulingHandled = true;
      console.log("[LinkedIn Post-Process] Skipping draft generation; scheduling follow-up task already created");
    }
  }
  const shouldDraft = !autoBook.booked && !schedulingHandled && newSentiment && shouldGenerateDraft(newSentiment);

  if (shouldDraft) {
    console.log(`[LinkedIn Post-Process] Generating draft for message ${message.id}`);

    const webhookDraftTimeoutMs =
      Number.parseInt(process.env.OPENAI_DRAFT_WEBHOOK_TIMEOUT_MS || "30000", 10) || 30_000;

    let leadPhoneOnFileForCallPolicy = Boolean((updatedLead?.phone || lead.phone || "").trim());
    if (actionSignalCallRequested && !leadPhoneOnFileForCallPolicy) {
      // Best-effort: phone may have been enriched asynchronously; re-check once before suppressing.
      leadPhoneOnFileForCallPolicy = await prisma.lead
        .findUnique({ where: { id: lead.id }, select: { phone: true } })
        .then((row) => Boolean((row?.phone || "").trim()))
        .catch(() => leadPhoneOnFileForCallPolicy);
    }

    const callRequestedFlow =
      (actionSignalCallRequested || newSentiment === "Call Requested") &&
      actionSignals.route?.processId !== 5;

    const suppressDraftForCallRequestedNoPhone = callRequestedFlow && !leadPhoneOnFileForCallPolicy;

    if (suppressDraftForCallRequestedNoPhone) {
      console.log("[LinkedIn Post-Process] Skipping draft generation; call requested but no phone on file (notify-only policy)");
      // Notify-only policy: rely on Slack action-signal + enrichment ops handoff.
    } else {
    const draftResult = await generateResponseDraft(
      lead.id,
      transcript || `Lead: ${messageBody}`,
      newSentiment,
      "linkedin",
      {
        timeoutMs: webhookDraftTimeoutMs,
        triggerMessageId: message.id,
        autoBookingContext: autoBook.context?.schedulingDetected ? autoBook.context : null,
        actionSignals: actionSignals.signals.length > 0 || actionSignals.route ? actionSignals : null,
      }
    );

    if (!draftResult.success) {
      console.error(`[LinkedIn Post-Process] Draft generation failed: ${draftResult.error}`);
    } else {
      console.log(`[LinkedIn Post-Process] Generated AI draft: ${draftResult.draftId}`);
      // Note: LinkedIn drafts typically require manual review (no auto-send)
      // because LinkedIn has stricter anti-spam policies
    }
    }
  } else {
    console.log(`[LinkedIn Post-Process] Skipping draft generation (sentiment: ${newSentiment})`);
  }

  // 8. Update Lead Rollups
  await bumpLeadMessageRollup({
    leadId: lead.id,
    direction: "inbound",
    sentAt: messageSentAt,
  });

  // 9. Enqueue lead scoring job (non-blocking, fire-and-forget)
  try {
    await enqueueLeadScoringJob({
      clientId: client.id,
      leadId: lead.id,
      messageId: message.id,
    });
  } catch (error) {
    // Don't fail the job if scoring enqueue fails
    console.error(`[LinkedIn Post-Process] Failed to enqueue lead scoring job for lead ${lead.id}:`, error);
  }

  console.log(`[LinkedIn Post-Process] Completed for message ${params.messageId}`);
}
