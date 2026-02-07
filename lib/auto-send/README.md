# Auto-Send Architecture

This module consolidates the auto-send decision tree for AI-generated drafts. It is used by the inbound post-process background jobs (Email, SMS, SmartLead, Instantly) to decide whether to:

- send immediately
- schedule a delayed send
- hold for human review (Slack DM)
- skip sending entirely

## Modes (Precedence Contract)

Auto-send is precedence-based (not enforced by DB constraints):

1) **EmailCampaign AI auto-send (modern)**

- Trigger: `lead.emailCampaign?.responseMode === "AI_AUTO_SEND"`
- Evaluator: `evaluateAutoSend()` (`lib/auto-send-evaluator.ts`)
- Threshold: `emailCampaign.autoSendConfidenceThreshold` (default 0.9)
- Delay: optional via `getCampaignDelayConfig()` + `scheduleDelayedAutoSend()` (Phase 47l)

2) **Legacy per-lead auto-reply**

- Trigger: `!lead.emailCampaign && lead.autoReplyEnabled === true`
- Evaluator: `decideShouldAutoReply()` (`lib/auto-reply-gate.ts`)
- Delay: not supported (immediate only)

3) **Disabled**

- Any other configuration is treated as “draft-only”.
- `CampaignResponseMode` is `SETTER_MANAGED | AI_AUTO_SEND` (no `DRAFT_ONLY` enum). `SETTER_MANAGED` behaves like draft-only.

Important nuance: if a campaign exists but is not `AI_AUTO_SEND` (e.g. `SETTER_MANAGED`), the legacy per-lead path does **not** run.

## Delay Scheduling Semantics

- Delay configuration comes from `getCampaignDelayConfig(campaignId)`.
- If a delay window exists, we schedule a `BackgroundJobType.AI_AUTO_SEND_DELAYED` via `scheduleDelayedAutoSend()`.
- If scheduling returns `scheduled: false` (e.g. `"already_scheduled"`), we **do not** fall back to immediate send (preserves Phase 47l behavior).
- For immediate sends (no delay configured), callers can enable `validateImmediateSend` to run `validateDelayedAutoSend()` before sending (prevents sending if the conversation has advanced).

## Review Flow (Slack DM)

If the AI evaluation is not safe or is below threshold, we send a Slack DM for review:

- Recipients are configured per workspace via `WorkspaceSettings.slackAutoSendApprovalRecipients`.
- If no recipients (or no workspace Slack token), the review DM is skipped.
- The Slack `blocks` structure is treated as a “golden master” to avoid behavior drift.
- Some jobs include a draft preview in the Slack message (`includeDraftPreviewInSlack`), matching historical behavior.

## Revision Loop (AI_AUTO_SEND only)

When the auto-send evaluator returns a confidence below the campaign threshold (and the evaluation is model-based, not a deterministic hard block), the system may attempt a **single** bounded revision:

- Step 1: select relevant optimization learnings (Message Performance + Insights packs) via `auto_send.context_select.v1`
- Step 2: revise the draft via `auto_send.revise.v1`
- Step 3: re-run `auto_send.evaluate.v1` once on the revised draft

Guardrails:
- Fail-closed: any selector/reviser error falls back to the normal Slack review flow.
- Persistence: revised draft is only persisted when it improves evaluator confidence.
- Kill-switch: set `AUTO_SEND_REVISION_DISABLED=1` to disable selector/reviser while leaving evaluation unchanged.

## API

Main entrypoint:

```ts
import { executeAutoSend } from "@/lib/auto-send";

const result = await executeAutoSend({
  clientId,
  leadId,
  triggerMessageId,
  draftId,
  draftContent,
  channel,
  latestInbound,
  subject,
  conversationHistory,
  sentimentTag,
  messageSentAt,
  emailCampaign: lead.emailCampaign,
  autoReplyEnabled: lead.autoReplyEnabled,
  validateImmediateSend: true,
  includeDraftPreviewInSlack: true,
});
```

## Files

- `lib/auto-send/types.ts` — shared types
- `lib/auto-send/orchestrator.ts` — decision + execution logic
- `lib/auto-send/index.ts` — public exports
- `lib/auto-send/__tests__/orchestrator.test.ts` — unit tests (Vitest)
