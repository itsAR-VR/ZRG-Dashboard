# Phase 48b — AutoSendOrchestrator Core Implementation

## Focus

Implement the `AutoSendOrchestrator` in `lib/auto-send/orchestrator.ts`. This module encapsulates the complete auto-send decision tree, replacing the duplicated logic across 4 background job files.

## Inputs

- Types from subphase a: `AutoSendMode`, `AutoSendOutcome`, `AutoSendContext`, `AutoSendResult`
- Existing evaluator functions:
  - `evaluateAutoSend()` from `lib/auto-send-evaluator.ts`
  - `decideShouldAutoReply()` from `lib/auto-reply-gate.ts`
- Existing actions:
  - `scheduleDelayedAutoSend()`, `getCampaignDelayConfig()` from `lib/background-jobs/delayed-auto-send.ts`
  - `approveAndSendDraftSystem()` from `actions/message-actions.ts`
- Existing utilities:
  - `sendSlackDmByEmail()` from `lib/slack-dm.ts`
  - `getPublicAppUrl()` from `lib/app-url.ts`

## Work

### 1. Create `lib/auto-send/orchestrator.ts`

```typescript
import "server-only";

import { evaluateAutoSend } from "@/lib/auto-send-evaluator";
import { decideShouldAutoReply } from "@/lib/auto-reply-gate";
import { scheduleDelayedAutoSend, getCampaignDelayConfig } from "@/lib/background-jobs/delayed-auto-send";
import { approveAndSendDraftSystem } from "@/actions/message-actions";
import { sendSlackDmByEmail } from "@/lib/slack-dm";
import { getPublicAppUrl } from "@/lib/app-url";
import type {
  AutoSendMode,
  AutoSendContext,
  AutoSendResult,
  AutoSendTelemetry,
} from "./types";
import { AUTO_SEND_CONSTANTS } from "./types";
```

### 2. Implement `determineAutoSendMode()`

```typescript
/**
 * Determines which auto-send mode applies based on campaign and lead settings.
 *
 * MUTUAL EXCLUSION RULES:
 * 1. If lead has EmailCampaign with responseMode === "AI_AUTO_SEND" → AI_AUTO_SEND
 * 2. Else if no EmailCampaign AND lead.autoReplyEnabled === true → LEGACY_AUTO_REPLY
 * 3. Otherwise → DISABLED
 *
 * Note: If both conditions could be true (campaign AI mode + autoReplyEnabled),
 * EmailCampaign takes precedence. This is intentional.
 */
export function determineAutoSendMode(context: AutoSendContext): AutoSendMode {
  // Check for EmailCampaign AI_AUTO_SEND mode first (takes precedence)
  if (
    context.emailCampaign &&
    context.emailCampaign.responseMode === "AI_AUTO_SEND"
  ) {
    // Log if legacy flag is also true (unusual state)
    if (context.autoReplyEnabled) {
      console.log(
        `[AutoSend] Lead ${context.leadId} has both AI_AUTO_SEND campaign and autoReplyEnabled=true; using campaign mode`
      );
    }
    return "AI_AUTO_SEND";
  }

  // Check for legacy per-lead auto-reply
  if (!context.emailCampaign && context.autoReplyEnabled) {
    return "LEGACY_AUTO_REPLY";
  }

  return "DISABLED";
}
```

### 3. Implement `executeAutoSend()` main entry point

```typescript
/**
 * Main orchestrator function. Evaluates and optionally executes auto-send.
 *
 * @param context - All context needed to make the auto-send decision
 * @returns Result indicating what action was taken (or skipped)
 */
export async function executeAutoSend(
  context: AutoSendContext
): Promise<AutoSendResult> {
  const startTime = Date.now();

  // Validate required fields
  if (!context.draftId || !context.draftContent) {
    return {
      mode: "DISABLED",
      outcome: { action: "skip", reason: "missing_draft" },
      telemetry: { path: "disabled", skipReason: "missing_draft" },
    };
  }

  // Determine which mode to use
  const mode = determineAutoSendMode(context);

  if (mode === "DISABLED") {
    return {
      mode,
      outcome: { action: "skip", reason: "auto_send_disabled" },
      telemetry: { path: "disabled" },
    };
  }

  // Route to appropriate handler
  if (mode === "AI_AUTO_SEND") {
    return await executeAiAutoSendPath(context, startTime);
  } else {
    return await executeLegacyAutoReplyPath(context, startTime);
  }
}
```

### 4. Implement `executeAiAutoSendPath()` for EmailCampaign mode

```typescript
async function executeAiAutoSendPath(
  context: AutoSendContext,
  startTime: number
): Promise<AutoSendResult> {
  const threshold = context.emailCampaign?.autoSendConfidenceThreshold
    ?? AUTO_SEND_CONSTANTS.DEFAULT_CONFIDENCE_THRESHOLD;

  // Evaluate via AI
  const evaluation = await evaluateAutoSend({
    clientId: context.clientId,
    leadId: context.leadId,
    channel: context.channel,
    latestInbound: context.latestInbound,
    subject: context.subject,
    conversationHistory: context.conversationHistory,
    categorization: context.sentimentTag,
    automatedReply: context.automatedReply,
    replyReceivedAt: context.messageSentAt,
    draft: context.draftContent,
  });

  const evaluationTimeMs = Date.now() - startTime;

  // Check if safe to send with sufficient confidence
  if (evaluation.safeToSend && evaluation.confidence >= threshold) {
    // Check for delay configuration
    const delayConfig = context.emailCampaign?.id
      ? await getCampaignDelayConfig(context.emailCampaign.id)
      : null;

    if (delayConfig && (delayConfig.delayMinSeconds > 0 || delayConfig.delayMaxSeconds > 0)) {
      // Schedule delayed send
      const scheduleResult = await scheduleDelayedAutoSend({
        clientId: context.clientId,
        leadId: context.leadId,
        triggerMessageId: context.triggerMessageId,
        draftId: context.draftId,
        delayMinSeconds: delayConfig.delayMinSeconds,
        delayMaxSeconds: delayConfig.delayMaxSeconds,
        inboundSentAt: context.messageSentAt,
      });

      if (scheduleResult.scheduled && scheduleResult.runAt) {
        const delaySeconds = Math.round(
          (scheduleResult.runAt.getTime() - context.messageSentAt.getTime()) / 1000
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

      // If scheduling failed but delay was configured, still count as delayed attempt
      console.warn(
        `[AutoSend] Delay scheduling failed for draft ${context.draftId}: ${scheduleResult.skipReason}`
      );
    }

    // Immediate send (no delay or delay=0)
    const sendResult = await approveAndSendDraftSystem(context.draftId, { sentBy: "ai" });

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
      outcome: { action: "error", error: sendResult.error || "Unknown send error" },
      telemetry: { path: "campaign_ai_auto_send", evaluationTimeMs },
    };
  }

  // Confidence too low - needs human review
  await sendReviewNeededNotification(context, evaluation, threshold);

  return {
    mode: "AI_AUTO_SEND",
    outcome: {
      action: "needs_review",
      draftId: context.draftId,
      reason: evaluation.reason,
      confidence: evaluation.confidence,
    },
    telemetry: {
      path: "campaign_ai_auto_send",
      evaluationTimeMs,
      confidence: evaluation.confidence,
      threshold,
      skipReason: evaluation.reason,
    },
  };
}
```

### 5. Implement `executeLegacyAutoReplyPath()` for per-lead mode

```typescript
async function executeLegacyAutoReplyPath(
  context: AutoSendContext,
  startTime: number
): Promise<AutoSendResult> {
  const decision = await decideShouldAutoReply({
    clientId: context.clientId,
    leadId: context.leadId,
    channel: context.channel,
    latestInbound: context.latestInbound,
    subject: context.subject,
    conversationHistory: context.conversationHistory,
    categorization: context.sentimentTag,
    automatedReply: context.automatedReply,
    replyReceivedAt: context.messageSentAt,
  });

  const evaluationTimeMs = Date.now() - startTime;

  if (!decision.shouldReply) {
    return {
      mode: "LEGACY_AUTO_REPLY",
      outcome: { action: "skip", reason: decision.reason },
      telemetry: {
        path: "legacy_per_lead",
        evaluationTimeMs,
        skipReason: decision.reason,
      },
    };
  }

  // Legacy path always sends immediately (no delay support)
  const sendResult = await approveAndSendDraftSystem(context.draftId, { sentBy: "ai" });

  if (sendResult.success) {
    return {
      mode: "LEGACY_AUTO_REPLY",
      outcome: { action: "send_immediate", draftId: context.draftId, messageId: sendResult.messageId },
      telemetry: { path: "legacy_per_lead", evaluationTimeMs },
    };
  }

  return {
    mode: "LEGACY_AUTO_REPLY",
    outcome: { action: "error", error: sendResult.error || "Unknown send error" },
    telemetry: { path: "legacy_per_lead", evaluationTimeMs },
  };
}
```

### 6. Implement `sendReviewNeededNotification()` (Slack notification)

```typescript
async function sendReviewNeededNotification(
  context: AutoSendContext,
  evaluation: { confidence: number; reason: string },
  threshold: number
): Promise<void> {
  const leadName = buildLeadName(context);
  const campaignLabel = context.emailCampaign
    ? `${context.emailCampaign.name}${context.emailCampaign.bisonCampaignId ? ` (${context.emailCampaign.bisonCampaignId})` : ""}`
    : "Unknown campaign";

  const url = `${getPublicAppUrl()}/?view=inbox&leadId=${context.leadId}`;
  const confidenceText = `${evaluation.confidence.toFixed(2)} < ${threshold.toFixed(2)}`;

  try {
    await sendSlackDmByEmail({
      email: AUTO_SEND_CONSTANTS.REVIEW_NOTIFICATION_EMAIL,
      dedupeKey: `auto_send_review:${context.draftId}`,
      text: `AI auto-send review needed (${confidenceText})`,
      blocks: [
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
              text: `*Confidence:*\n${evaluation.confidence.toFixed(2)} (thresh ${threshold.toFixed(2)})`,
            },
          ],
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Reason:*\n${evaluation.reason}` },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Draft Preview:*\n\`\`\`\n${context.draftContent.slice(0, 1400)}\n\`\`\``,
          },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `<${url}|Open lead in dashboard>` },
        },
      ],
    });
  } catch (error) {
    console.error(`[AutoSend] Failed to send Slack notification for draft ${context.draftId}:`, error);
  }
}

function buildLeadName(context: AutoSendContext): string {
  const parts = [context.leadFirstName, context.leadLastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "Unknown";
}
```

### 7. Create `lib/auto-send/index.ts` barrel export

```typescript
export { executeAutoSend, determineAutoSendMode } from "./orchestrator";
export * from "./types";
```

### 8. Validation

- Run `npm run lint`
- Run `npm run build`
- Verify all imports resolve correctly

## Output

- `lib/auto-send/orchestrator.ts` created with full implementation
- `lib/auto-send/index.ts` created for public exports
- Behavior parity preserved via explicit context toggles:
  - `validateImmediateSend` (SmartLead/Instantly immediate-send validation)
  - `includeDraftPreviewInSlack` (Email/SMS Slack review preview blocks)

## Handoff

Orchestrator is ready for subphase c to add unit tests before migration begins.
