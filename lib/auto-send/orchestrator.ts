import "server-only";

import { approveAndSendDraftSystem } from "@/actions/message-actions";
import { decideShouldAutoReply } from "@/lib/auto-reply-gate";
import { evaluateAutoSend } from "@/lib/auto-send-evaluator";
import { getPublicAppUrl } from "@/lib/app-url";
import {
  getCampaignDelayConfig,
  scheduleDelayedAutoSend,
  validateDelayedAutoSend,
} from "@/lib/background-jobs/delayed-auto-send";
import { sendSlackDmByEmail } from "@/lib/slack-dm";
import type { AutoSendContext, AutoSendMode, AutoSendResult } from "./types";
import { AUTO_SEND_CONSTANTS } from "./types";

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
  getPublicAppUrl: typeof getPublicAppUrl;
  getCampaignDelayConfig: typeof getCampaignDelayConfig;
  scheduleDelayedAutoSend: typeof scheduleDelayedAutoSend;
  validateDelayedAutoSend: typeof validateDelayedAutoSend;
  sendSlackDmByEmail: typeof sendSlackDmByEmail;
};

export function createAutoSendExecutor(deps: AutoSendDependencies): { executeAutoSend: (context: AutoSendContext) => Promise<AutoSendResult> } {
  async function sendReviewNeededSlackDm(params: {
    context: AutoSendContext;
    confidence: number;
    threshold: number;
    reason: string;
  }): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
    const { context, confidence, threshold, reason } = params;

    const leadName = buildLeadName(context);
    const campaignLabel = buildCampaignLabel(context);
    const url = `${deps.getPublicAppUrl()}/?view=inbox&leadId=${context.leadId}`;
    const confidenceText = `${confidence.toFixed(2)} < ${threshold.toFixed(2)}`;

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
      ...(context.includeDraftPreviewInSlack
        ? ([
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Draft Preview:*\n\`\`\`\n${context.draftContent.slice(0, 1400)}\n\`\`\``,
              },
            },
          ] as const)
        : ([] as const)),
      {
        type: "section",
        text: { type: "mrkdwn", text: `<${url}|Open lead in dashboard>` },
      },
    ] as const;

    return await deps.sendSlackDmByEmail({
      email: AUTO_SEND_CONSTANTS.REVIEW_NOTIFICATION_EMAIL,
      dedupeKey: `auto_send_review:${context.draftId}`,
      text: `AI auto-send review needed (${confidenceText})`,
      blocks: blocks as unknown as Parameters<typeof sendSlackDmByEmail>[0]["blocks"],
    });
  }

  async function executeAiAutoSendPath(context: AutoSendContext, startTimeMs: number): Promise<AutoSendResult> {
    if (!context.draftContent.trim()) {
      return {
        mode: "AI_AUTO_SEND",
        outcome: { action: "skip", reason: "missing_draft_content" },
        telemetry: { path: "campaign_ai_auto_send" },
      };
    }

    const threshold = context.emailCampaign?.autoSendConfidenceThreshold ?? AUTO_SEND_CONSTANTS.DEFAULT_CONFIDENCE_THRESHOLD;

    const evaluation = await deps.evaluateAutoSend({
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

    const evaluationTimeMs = Date.now() - startTimeMs;

    if (evaluation.safeToSend && evaluation.confidence >= threshold) {
      const delayConfig = context.emailCampaign?.id ? await deps.getCampaignDelayConfig(context.emailCampaign.id) : null;

      if (delayConfig && (delayConfig.delayMinSeconds > 0 || delayConfig.delayMaxSeconds > 0)) {
        const scheduleResult = await deps.scheduleDelayedAutoSend({
          clientId: context.clientId,
          leadId: context.leadId,
          triggerMessageId: context.triggerMessageId,
          draftId: context.draftId,
          delayMinSeconds: delayConfig.delayMinSeconds,
          delayMaxSeconds: delayConfig.delayMaxSeconds,
          inboundSentAt: context.messageSentAt,
        });

        if (scheduleResult.scheduled && scheduleResult.runAt) {
          const delaySeconds = Math.max(
            0,
            Math.round((scheduleResult.runAt.getTime() - context.messageSentAt.getTime()) / 1000)
          );

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

      if (context.validateImmediateSend) {
        const validation = await deps.validateDelayedAutoSend({
          leadId: context.leadId,
          triggerMessageId: context.triggerMessageId,
          draftId: context.draftId,
        });

        if (!validation.proceed) {
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

    return {
      mode: "AI_AUTO_SEND",
      outcome: {
        action: "needs_review",
        draftId: context.draftId,
        reason: evaluation.reason,
        confidence: evaluation.confidence,
        threshold,
        slackDm: { sent: dmResult.success, skipped: dmResult.skipped, error: dmResult.error },
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
  getPublicAppUrl,
  getCampaignDelayConfig,
  scheduleDelayedAutoSend,
  validateDelayedAutoSend,
  sendSlackDmByEmail,
});

export const executeAutoSend = defaultExecutor.executeAutoSend;
