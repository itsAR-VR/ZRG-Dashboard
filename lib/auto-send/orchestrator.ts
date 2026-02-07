import "server-only";

import { approveAndSendDraftSystem } from "@/actions/message-actions";
import { decideShouldAutoReply } from "@/lib/auto-reply-gate";
import { evaluateAutoSend } from "@/lib/auto-send-evaluator";
import { getPublicAppUrl } from "@/lib/app-url";
import {
  computeDelayedAutoSendRunAt,
  getCampaignDelayConfig,
  scheduleAutoSendAt,
  scheduleDelayedAutoSend,
  validateDelayedAutoSend,
} from "@/lib/background-jobs/delayed-auto-send";
import { sendSlackDmByUserIdWithToken } from "@/lib/slack-dm";
import { sanitizeSlackCodeBlockText, truncateSlackText } from "@/lib/slack-format";
import { maybeReviseAutoSendDraft } from "@/lib/auto-send/revision-agent";
import {
  getNextAutoSendWindow,
  isWithinAutoSendSchedule,
  resolveAutoSendScheduleConfig,
} from "@/lib/auto-send-schedule";
import { getSlackAutoSendApprovalConfig } from "./get-approval-recipients";
import type { AutoSendContext, AutoSendMode, AutoSendResult } from "./types";
import { AUTO_SEND_CONSTANTS } from "./types";
import { recordAutoSendDecision, type AutoSendDecisionRecord } from "./record-auto-send-decision";

/**
 * Check for global kill-switch. Set `AUTO_SEND_DISABLED=1` to disable all auto-send globally.
 * This is an emergency lever to stop all automated sending without a deployment.
 */
export function isAutoSendGloballyDisabled(): boolean {
  return process.env.AUTO_SEND_DISABLED === "1";
}

export function determineAutoSendMode(context: AutoSendContext): AutoSendMode {
  // Global kill-switch takes precedence over all other logic
  if (isAutoSendGloballyDisabled()) {
    return "DISABLED";
  }

  if (context.emailCampaign && context.emailCampaign.responseMode === "AI_AUTO_SEND") {
    return "AI_AUTO_SEND";
  }

  if (!context.emailCampaign && context.autoReplyEnabled) {
    return "LEGACY_AUTO_REPLY";
  }

  return "DISABLED";
}

function buildLeadName(context: AutoSendContext): string {
  const parts = [context.leadFirstName, context.leadLastName].filter((p): p is string => Boolean(p));
  return parts.join(" ") || "Unknown";
}

function buildCampaignLabel(context: AutoSendContext): string {
  const campaign = context.emailCampaign;
  return campaign ? `${campaign.name} (${campaign.bisonCampaignId})` : "Unknown campaign";
}

export type AutoSendDependencies = {
  approveAndSendDraftSystem: typeof approveAndSendDraftSystem;
  decideShouldAutoReply: typeof decideShouldAutoReply;
  evaluateAutoSend: typeof evaluateAutoSend;
  maybeReviseAutoSendDraft?: typeof maybeReviseAutoSendDraft;
  getPublicAppUrl: typeof getPublicAppUrl;
  getCampaignDelayConfig: typeof getCampaignDelayConfig;
  scheduleAutoSendAt: typeof scheduleAutoSendAt;
  scheduleDelayedAutoSend: typeof scheduleDelayedAutoSend;
  validateDelayedAutoSend: typeof validateDelayedAutoSend;
  sendSlackDmByUserIdWithToken: typeof sendSlackDmByUserIdWithToken;
  getSlackAutoSendApprovalConfig: typeof getSlackAutoSendApprovalConfig;
  recordAutoSendDecision: typeof recordAutoSendDecision;
};

export function createAutoSendExecutor(deps: AutoSendDependencies): { executeAutoSend: (context: AutoSendContext) => Promise<AutoSendResult> } {
  async function safeRecord(record: AutoSendDecisionRecord): Promise<void> {
    try {
      await deps.recordAutoSendDecision(record);
    } catch (error) {
      console.error("[AutoSend] Failed to persist auto-send decision", {
        draftId: record.draftId,
        action: record.action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function sendReviewNeededSlackDm(params: {
    context: AutoSendContext;
    confidence: number;
    threshold: number;
    reason: string;
  }): Promise<{ success: boolean; skipped?: boolean; error?: string; messageTs?: string; channelId?: string }> {
    const { context, confidence, threshold, reason } = params;

    const leadName = buildLeadName(context);
    const campaignLabel = buildCampaignLabel(context);
    // Deep-link to the correct workspace + lead (+ draft) to avoid Slack vs dashboard mismatches.
    const dashboardUrl = `${deps.getPublicAppUrl()}/?view=inbox&clientId=${encodeURIComponent(context.clientId)}&leadId=${encodeURIComponent(context.leadId)}&draftId=${encodeURIComponent(context.draftId)}`;
    const confidenceText = `${confidence.toFixed(2)} < ${threshold.toFixed(2)}`;

    const subjectLine = (context.subject || "").trim();
    const latestInbound = (context.latestInbound || "").trim();
    const inboundCombined =
      subjectLine && !/^\s*subject:/i.test(latestInbound)
        ? `Subject: ${subjectLine}\n\n${latestInbound}`
        : latestInbound || (subjectLine ? `Subject: ${subjectLine}` : "");
    const inboundPreview = truncateSlackText(sanitizeSlackCodeBlockText(inboundCombined), 1400).trim();
    const draftPreview = truncateSlackText(sanitizeSlackCodeBlockText(context.draftContent), 1400).trim();

    // Phase 70: Build button action value with IDs needed for approval webhook
    const buttonValue = JSON.stringify({
      draftId: context.draftId,
      leadId: context.leadId,
      clientId: context.clientId,
    });

    const regenerateValue = JSON.stringify({
      draftId: context.draftId,
      leadId: context.leadId,
      clientId: context.clientId,
      cycleSeed: context.draftId,
      regenCount: 0,
    });

    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: "AI Auto-Send: Review Needed", emoji: true },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Lead:*\n${leadName}${context.leadEmail ? `\n${context.leadEmail}` : ""}`,
          },
          { type: "mrkdwn", text: `*Campaign:*\n${campaignLabel}` },
          { type: "mrkdwn", text: `*Sentiment:*\n${context.sentimentTag || "Unknown"}` },
          {
            type: "mrkdwn",
            text: `*Confidence:*\n${confidence.toFixed(2)} (thresh ${threshold.toFixed(2)})`,
          },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Reason:*\n${reason}` },
      },
      ...(inboundPreview
        ? ([
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Lead Message Preview:*\n\`\`\`\n${inboundPreview}\n\`\`\``,
              },
            },
          ] as const)
        : ([] as const)),
      ...(context.includeDraftPreviewInSlack
        ? ([
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Draft Preview:*\n\`\`\`\n${draftPreview}\n\`\`\``,
              },
            },
          ] as const)
        : ([] as const)),
      // Phase 70: Add interactive buttons for quick actions
      {
        type: "actions",
        block_id: `review_actions_${context.draftId}`,
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Edit in dashboard", emoji: true },
            url: dashboardUrl,
            action_id: "view_dashboard",
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Regenerate", emoji: true },
            action_id: "regenerate_draft_fast",
            value: regenerateValue,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Approve & Send", emoji: true },
            style: "primary",
            action_id: "approve_send",
            value: buttonValue,
          },
        ],
      },
    ] as const;

    const approvalConfig = await deps.getSlackAutoSendApprovalConfig(context.clientId);
    if (approvalConfig.skipReason) {
      console.log("[AutoSend] Slack review DM skipped", {
        clientId: context.clientId,
        reason: approvalConfig.skipReason,
      });
      return { success: false, skipped: true };
    }

    const recipients = approvalConfig.recipients;
    const token = approvalConfig.token;
    if (!token || recipients.length === 0) {
      return { success: false, skipped: true };
    }

    const recipientResults: Array<{ userId: string; success: boolean; skipped?: boolean; error?: string }> = [];
    let firstSuccess: { messageTs?: string; channelId?: string } | null = null;

    for (let i = 0; i < recipients.length; i += 1) {
      const recipient = recipients[i];
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      const result = await deps.sendSlackDmByUserIdWithToken({
        token,
        userId: recipient.id,
        dedupeKey: `auto_send_review:${context.draftId}:${recipient.id}`,
        text: `AI auto-send review needed (${confidenceText})`,
        blocks: blocks as unknown as Parameters<typeof sendSlackDmByUserIdWithToken>[0]["blocks"],
      });

      recipientResults.push({
        userId: recipient.id,
        success: result.success,
        skipped: result.skipped,
        error: result.error,
      });

      if (result.success && !result.skipped && !firstSuccess) {
        firstSuccess = { messageTs: result.messageTs, channelId: result.channelId };
      }
    }

    const anySuccess = recipientResults.some((r) => r.success);
    const allSkipped = recipientResults.length > 0 && recipientResults.every((r) => r.success && r.skipped);

    return {
      success: anySuccess,
      skipped: allSkipped,
      error: anySuccess ? undefined : recipientResults.map((r) => r.error).filter(Boolean).join("; "),
      messageTs: firstSuccess?.messageTs,
      channelId: firstSuccess?.channelId,
    };
  }

  async function executeAiAutoSendPath(context: AutoSendContext, startTimeMs: number): Promise<AutoSendResult> {
    if (!context.draftContent.trim()) {
      await safeRecord({
        draftId: context.draftId,
        evaluatedAt: new Date(),
        action: "skip",
        reason: "missing_draft_content",
        threshold: context.emailCampaign?.autoSendConfidenceThreshold ?? AUTO_SEND_CONSTANTS.DEFAULT_CONFIDENCE_THRESHOLD,
      });

      return {
        mode: "AI_AUTO_SEND",
        outcome: { action: "skip", reason: "missing_draft_content" },
        telemetry: { path: "campaign_ai_auto_send" },
      };
    }

    const threshold = context.emailCampaign?.autoSendConfidenceThreshold ?? AUTO_SEND_CONSTANTS.DEFAULT_CONFIDENCE_THRESHOLD;

    let evaluation = await deps.evaluateAutoSend({
      clientId: context.clientId,
      leadId: context.leadId,
      channel: context.channel,
      latestInbound: context.latestInbound,
      subject: context.subject ?? null,
      conversationHistory: context.conversationHistory,
      categorization: context.sentimentTag,
      automatedReply: context.automatedReply ?? null,
      replyReceivedAt: context.messageSentAt,
      draft: context.draftContent,
    });

    // Optional: revision attempt when below threshold, bounded + fail-closed inside the revision agent.
    if (
      deps.maybeReviseAutoSendDraft &&
      (evaluation.source ?? "model") !== "hard_block" &&
      typeof evaluation.confidence === "number" &&
      evaluation.confidence < threshold
    ) {
      try {
        const revision = await deps.maybeReviseAutoSendDraft({
          clientId: context.clientId,
          leadId: context.leadId,
          emailCampaignId: context.emailCampaign?.id ?? null,
          draftId: context.draftId,
          channel: context.channel,
          subject: context.subject ?? null,
          latestInbound: context.latestInbound,
          conversationHistory: context.conversationHistory,
          draft: context.draftContent,
          evaluation,
          threshold,
          reEvaluate: async (draft) =>
            deps.evaluateAutoSend({
              clientId: context.clientId,
              leadId: context.leadId,
              channel: context.channel,
              latestInbound: context.latestInbound,
              subject: context.subject ?? null,
              conversationHistory: context.conversationHistory,
              categorization: context.sentimentTag,
              automatedReply: context.automatedReply ?? null,
              replyReceivedAt: context.messageSentAt,
              draft,
            }),
        });

        if (revision.revisedDraft && revision.revisedEvaluation) {
          context.draftContent = revision.revisedDraft;
          evaluation = revision.revisedEvaluation;
        }
      } catch (error) {
        console.warn("[AutoSend] Revision attempt failed; continuing without revision", {
          clientId: context.clientId,
          leadId: context.leadId,
          draftId: context.draftId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const evaluationTimeMs = Date.now() - startTimeMs;
    const evaluatedAt = new Date();

    if (evaluation.safeToSend && evaluation.confidence >= threshold) {
      const scheduleConfig = resolveAutoSendScheduleConfig(
        context.workspaceSettings ?? null,
        context.emailCampaign ?? null,
        context.leadTimezone ?? null
      );
      const delayConfig = context.emailCampaign?.id ? await deps.getCampaignDelayConfig(context.emailCampaign.id) : null;

      if (delayConfig && (delayConfig.delayMinSeconds > 0 || delayConfig.delayMaxSeconds > 0)) {
        const baseRunAt = computeDelayedAutoSendRunAt({
          triggerMessageId: context.triggerMessageId,
          inboundSentAt: context.messageSentAt,
          delayMinSeconds: delayConfig.delayMinSeconds,
          delayMaxSeconds: delayConfig.delayMaxSeconds,
        });
        const scheduleCheck = isWithinAutoSendSchedule(scheduleConfig, baseRunAt);
        const finalRunAt = scheduleCheck.withinSchedule
          ? baseRunAt
          : scheduleCheck.nextWindowStart || getNextAutoSendWindow(scheduleConfig, baseRunAt);

        const scheduleResult = scheduleCheck.withinSchedule
          ? await deps.scheduleDelayedAutoSend({
              clientId: context.clientId,
              leadId: context.leadId,
              triggerMessageId: context.triggerMessageId,
              draftId: context.draftId,
              delayMinSeconds: delayConfig.delayMinSeconds,
              delayMaxSeconds: delayConfig.delayMaxSeconds,
              inboundSentAt: context.messageSentAt,
            })
          : await deps.scheduleAutoSendAt({
              clientId: context.clientId,
              leadId: context.leadId,
              triggerMessageId: context.triggerMessageId,
              draftId: context.draftId,
              runAt: finalRunAt,
            });

        if (scheduleResult.scheduled && scheduleResult.runAt) {
          const delaySeconds = Math.max(
            0,
            Math.round((scheduleResult.runAt.getTime() - context.messageSentAt.getTime()) / 1000)
          );

          await safeRecord({
            draftId: context.draftId,
            evaluatedAt,
            confidence: evaluation.confidence,
            threshold,
            reason: evaluation.reason,
            action: "send_delayed",
            slackNotified: false,
          });

          return {
            mode: "AI_AUTO_SEND",
            outcome: { action: "send_delayed", draftId: context.draftId, runAt: scheduleResult.runAt },
            telemetry: {
              path: "campaign_ai_auto_send",
              evaluationTimeMs,
              confidence: evaluation.confidence,
              threshold,
              delaySeconds,
            },
          };
        }

        const scheduleSkipReason = scheduleResult.skipReason || "unknown";
        const shouldTreatAsAlreadyScheduled = scheduleSkipReason === "already_scheduled";

        await safeRecord({
          draftId: context.draftId,
          evaluatedAt,
          confidence: evaluation.confidence,
          threshold,
          reason: shouldTreatAsAlreadyScheduled
            ? evaluation.reason
            : `delayed_send_not_scheduled:${scheduleSkipReason}`,
          action: shouldTreatAsAlreadyScheduled ? "send_delayed" : "skip",
          slackNotified: false,
        });

        return {
          mode: "AI_AUTO_SEND",
          outcome: { action: "skip", reason: `delayed_send_not_scheduled:${scheduleResult.skipReason || "unknown"}` },
          telemetry: {
            path: "campaign_ai_auto_send",
            evaluationTimeMs,
            confidence: evaluation.confidence,
            threshold,
            delayedScheduleSkipReason: scheduleResult.skipReason,
          },
        };
      }

      const scheduleCheck = isWithinAutoSendSchedule(scheduleConfig);
      if (!scheduleCheck.withinSchedule) {
        const runAt = scheduleCheck.nextWindowStart || getNextAutoSendWindow(scheduleConfig);
        const scheduleResult = await deps.scheduleAutoSendAt({
          clientId: context.clientId,
          leadId: context.leadId,
          triggerMessageId: context.triggerMessageId,
          draftId: context.draftId,
          runAt,
        });

        if (scheduleResult.scheduled && scheduleResult.runAt) {
          const delaySeconds = Math.max(
            0,
            Math.round((scheduleResult.runAt.getTime() - context.messageSentAt.getTime()) / 1000)
          );

          await safeRecord({
            draftId: context.draftId,
            evaluatedAt,
            confidence: evaluation.confidence,
            threshold,
            reason: `outside_schedule:${scheduleCheck.reason}`,
            action: "send_delayed",
            slackNotified: false,
          });

          return {
            mode: "AI_AUTO_SEND",
            outcome: { action: "send_delayed", draftId: context.draftId, runAt: scheduleResult.runAt },
            telemetry: {
              path: "campaign_ai_auto_send",
              evaluationTimeMs,
              confidence: evaluation.confidence,
              threshold,
              delaySeconds,
            },
          };
        }

        const scheduleSkipReason = scheduleResult.skipReason || "unknown";
        const shouldTreatAsAlreadyScheduled = scheduleSkipReason === "already_scheduled";

        await safeRecord({
          draftId: context.draftId,
          evaluatedAt,
          confidence: evaluation.confidence,
          threshold,
          reason: shouldTreatAsAlreadyScheduled
            ? evaluation.reason
            : `scheduled_send_not_scheduled:${scheduleSkipReason}`,
          action: shouldTreatAsAlreadyScheduled ? "send_delayed" : "skip",
          slackNotified: false,
        });

        return {
          mode: "AI_AUTO_SEND",
          outcome: { action: "skip", reason: `scheduled_send_not_scheduled:${scheduleResult.skipReason || "unknown"}` },
          telemetry: {
            path: "campaign_ai_auto_send",
            evaluationTimeMs,
            confidence: evaluation.confidence,
            threshold,
            delayedScheduleSkipReason: scheduleResult.skipReason,
          },
        };
      }

      if (context.validateImmediateSend) {
        const validation = await deps.validateDelayedAutoSend({
          leadId: context.leadId,
          triggerMessageId: context.triggerMessageId,
          draftId: context.draftId,
        });

        if (!validation.proceed) {
          await safeRecord({
            draftId: context.draftId,
            evaluatedAt,
            confidence: evaluation.confidence,
            threshold,
            reason: `immediate_send_validation_failed:${validation.reason || "unknown_reason"}`,
            action: "skip",
            slackNotified: false,
          });

          return {
            mode: "AI_AUTO_SEND",
            outcome: {
              action: "skip",
              reason: `immediate_send_validation_failed:${validation.reason || "unknown_reason"}`,
            },
            telemetry: {
              path: "campaign_ai_auto_send",
              evaluationTimeMs,
              confidence: evaluation.confidence,
              threshold,
              immediateValidationSkipReason: validation.reason || "unknown_reason",
            },
          };
        }
      }

      const sendResult = await deps.approveAndSendDraftSystem(context.draftId, { sentBy: "ai" });
      if (sendResult.success) {
        await safeRecord({
          draftId: context.draftId,
          evaluatedAt,
          confidence: evaluation.confidence,
          threshold,
          reason: evaluation.reason,
          action: "send_immediate",
          slackNotified: false,
        });

        return {
          mode: "AI_AUTO_SEND",
          outcome: { action: "send_immediate", draftId: context.draftId, messageId: sendResult.messageId },
          telemetry: {
            path: "campaign_ai_auto_send",
            evaluationTimeMs,
            confidence: evaluation.confidence,
            threshold,
          },
        };
      }

      await safeRecord({
        draftId: context.draftId,
        evaluatedAt,
        confidence: evaluation.confidence,
        threshold,
        reason: sendResult.error || "Failed to send draft",
        action: "error",
        slackNotified: false,
      });

      return {
        mode: "AI_AUTO_SEND",
        outcome: { action: "error", error: sendResult.error || "Failed to send draft" },
        telemetry: {
          path: "campaign_ai_auto_send",
          evaluationTimeMs,
          confidence: evaluation.confidence,
          threshold,
        },
      };
    }

    const dmResult = await sendReviewNeededSlackDm({
      context,
      confidence: evaluation.confidence,
      threshold,
      reason: evaluation.reason,
    });

    await safeRecord({
      draftId: context.draftId,
      evaluatedAt,
      confidence: evaluation.confidence,
      threshold,
      reason: evaluation.reason,
      action: "needs_review",
      slackNotified: dmResult.success,
      // Phase 70: Persist Slack message metadata for interactive button updates
      slackNotificationChannelId: dmResult.channelId,
      slackNotificationMessageTs: dmResult.messageTs,
    });

    return {
      mode: "AI_AUTO_SEND",
      outcome: {
        action: "needs_review",
        draftId: context.draftId,
        reason: evaluation.reason,
        confidence: evaluation.confidence,
        threshold,
        slackDm: {
          sent: dmResult.success,
          skipped: dmResult.skipped,
          error: dmResult.error,
          // Phase 70: Include message metadata in result for testing/debugging
          messageTs: dmResult.messageTs,
          channelId: dmResult.channelId,
        },
      },
      telemetry: {
        path: "campaign_ai_auto_send",
        evaluationTimeMs,
        confidence: evaluation.confidence,
        threshold,
      },
    };
  }

  async function executeLegacyAutoReplyPath(context: AutoSendContext, startTimeMs: number): Promise<AutoSendResult> {
    const decision = await deps.decideShouldAutoReply({
      clientId: context.clientId,
      leadId: context.leadId,
      channel: context.channel,
      latestInbound: context.latestInbound,
      subject: context.subject ?? null,
      conversationHistory: context.conversationHistory,
      categorization: context.sentimentTag,
      automatedReply: context.automatedReply ?? null,
      replyReceivedAt: context.messageSentAt,
    });

    const evaluationTimeMs = Date.now() - startTimeMs;

    if (!decision.shouldReply) {
      return {
        mode: "LEGACY_AUTO_REPLY",
        outcome: { action: "skip", reason: `legacy_auto_reply_skip:${decision.reason}` },
        telemetry: { path: "legacy_per_lead", evaluationTimeMs },
      };
    }

    const sendResult = await deps.approveAndSendDraftSystem(context.draftId, { sentBy: "ai" });
    if (sendResult.success) {
      return {
        mode: "LEGACY_AUTO_REPLY",
        outcome: { action: "send_immediate", draftId: context.draftId, messageId: sendResult.messageId },
        telemetry: { path: "legacy_per_lead", evaluationTimeMs },
      };
    }

    return {
      mode: "LEGACY_AUTO_REPLY",
      outcome: { action: "error", error: sendResult.error || "Failed to send draft" },
      telemetry: { path: "legacy_per_lead", evaluationTimeMs },
    };
  }

  async function executeAutoSend(context: AutoSendContext): Promise<AutoSendResult> {
    const debug = process.env.AUTO_SEND_DEBUG === "1";
    const startTimeMs = Date.now();

    const mode = determineAutoSendMode(context);
    if (mode === "DISABLED") {
      // Distinguish between global kill-switch and per-context disabled
      const reason = isAutoSendGloballyDisabled()
        ? "globally_disabled_via_env"
        : "auto_send_disabled";
      const result: AutoSendResult = {
        mode,
        outcome: { action: "skip", reason },
        telemetry: { path: "disabled" },
      };
      if (debug) {
        console.log("[AutoSend] Complete", {
          clientId: context.clientId,
          leadId: context.leadId,
          draftId: context.draftId,
          channel: context.channel,
          mode: result.mode,
          action: result.outcome.action,
          ...result.telemetry,
        });
      }
      return result;
    }

    if (debug) {
      console.log("[AutoSend] Starting", {
        clientId: context.clientId,
        leadId: context.leadId,
        draftId: context.draftId,
        channel: context.channel,
        hasEmailCampaign: Boolean(context.emailCampaign),
        campaignResponseMode: context.emailCampaign?.responseMode ?? null,
        autoReplyEnabled: Boolean(context.autoReplyEnabled),
        validateImmediateSend: Boolean(context.validateImmediateSend),
      });
    }

    const result =
      mode === "AI_AUTO_SEND"
        ? await executeAiAutoSendPath(context, startTimeMs)
        : await executeLegacyAutoReplyPath(context, startTimeMs);

    if (debug) {
      console.log("[AutoSend] Complete", {
        clientId: context.clientId,
        leadId: context.leadId,
        draftId: context.draftId,
        channel: context.channel,
        mode: result.mode,
        action: result.outcome.action,
        ...result.telemetry,
      });
    }

    return result;
  }

  return { executeAutoSend };
}

const defaultExecutor = createAutoSendExecutor({
  approveAndSendDraftSystem,
  decideShouldAutoReply,
  evaluateAutoSend,
  maybeReviseAutoSendDraft,
  getPublicAppUrl,
  getCampaignDelayConfig,
  scheduleAutoSendAt,
  scheduleDelayedAutoSend,
  validateDelayedAutoSend,
  sendSlackDmByUserIdWithToken,
  getSlackAutoSendApprovalConfig,
  recordAutoSendDecision,
});

export const executeAutoSend = defaultExecutor.executeAutoSend;
