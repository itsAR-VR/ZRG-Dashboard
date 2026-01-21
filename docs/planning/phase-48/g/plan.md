# Phase 48g — Documentation and Observability

## Focus

Add documentation explaining the auto-send architecture, update CLAUDE.md with the new structure, and enhance observability logging to make debugging easier.

## Inputs

- Completed orchestrator implementation (subphase b)
- All 4 migrated background job files (subphases d-f)
- Passing tests (subphase c)

## Work

### 1. Create Architecture Documentation

Create `lib/auto-send/README.md`:

```markdown
# Auto-Send Architecture

This module handles automatic sending of AI-generated draft responses based on campaign and lead configuration.

## Overview

The auto-send system evaluates whether to automatically send an AI-generated draft in response to an inbound message. There are two mutually exclusive modes:

### 1. EmailCampaign AI_AUTO_SEND Mode (Modern)

- **Trigger**: Lead belongs to an EmailCampaign with `responseMode === "AI_AUTO_SEND"`
- **Evaluator**: `evaluateAutoSend()` returns confidence score (0-1) and safety check
- **Threshold**: Configurable per-campaign via `autoSendConfidenceThreshold` (default: 0.9)
- **Delay**: Optional delayed sending via `autoSendDelayMinSeconds`/`autoSendDelayMaxSeconds`
- **Review**: Low-confidence drafts trigger Slack notification for human review

### 2. Legacy Per-Lead Auto-Reply Mode

- **Trigger**: No EmailCampaign AND `lead.autoReplyEnabled === true`
- **Evaluator**: `decideShouldAutoReply()` returns boolean decision
- **Delay**: Not supported (always immediate)
- **Review**: Not supported (binary send/skip)

## Mutual Exclusion Contract

```
IF emailCampaign.responseMode === "AI_AUTO_SEND"
  → Use EmailCampaign path (ignores autoReplyEnabled flag)
ELSE IF !emailCampaign AND autoReplyEnabled
  → Use legacy per-lead path
ELSE
  → Auto-send disabled (draft created but not sent)
```

**Important**: EmailCampaign mode takes precedence. If a lead has both an AI_AUTO_SEND campaign AND `autoReplyEnabled=true`, the campaign mode is used.

## Files

| File | Purpose |
|------|---------|
| `types.ts` | Shared types and interfaces |
| `orchestrator.ts` | Main decision logic and execution |
| `index.ts` | Public exports |
| `__tests__/orchestrator.test.ts` | Unit tests |

## Dependencies

This module depends on:
- `lib/auto-send-evaluator.ts` - AI confidence evaluation
- `lib/auto-reply-gate.ts` - Legacy boolean decision
- `lib/background-jobs/delayed-auto-send.ts` - Delay scheduling
- `actions/message-actions.ts` - Draft sending
- `lib/slack-dm.ts` - Review notifications

## Usage

```typescript
import { executeAutoSend } from "@/lib/auto-send";

const result = await executeAutoSend({
  clientId: "...",
  leadId: "...",
  triggerMessageId: "...",
  draftId: "...",
  draftContent: "...",
  channel: "email",
  // ... other context fields
  emailCampaign: lead.emailCampaign,
  autoReplyEnabled: lead.autoReplyEnabled,
});

switch (result.outcome.action) {
  case "send_immediate": /* Draft sent immediately */
  case "send_delayed": /* Scheduled for later */
  case "needs_review": /* Slack notification sent */
  case "skip": /* Skipped (disabled or decision=no) */
  case "error": /* Send failed */
}
```

## Telemetry

The `result.telemetry` object contains:
- `path`: Which code path was taken
- `evaluationTimeMs`: Time spent in AI evaluation
- `confidence`: Confidence score (AI_AUTO_SEND only)
- `threshold`: Configured threshold (AI_AUTO_SEND only)
- `delaySeconds`: Scheduled delay (if delayed)
- `skipReason`: Why auto-send was skipped

## Configuration

### Campaign-Level Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `responseMode` | `"AI_AUTO_SEND" \| "SETTER_MANAGED" \| null` | null | Campaign response mode (`SETTER_MANAGED` behaves like “draft-only”) |
| `autoSendConfidenceThreshold` | number | 0.9 | Minimum confidence to send |
| `autoSendDelayMinSeconds` | number | 180 | Minimum delay (3 min) |
| `autoSendDelayMaxSeconds` | number | 420 | Maximum delay (7 min) |

### Lead-Level Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `autoReplyEnabled` | boolean | false | Enable legacy auto-reply |

## Troubleshooting

### Draft not auto-sending

1. Check `responseMode` on the lead's EmailCampaign
2. If no campaign, check `lead.autoReplyEnabled`
3. Check confidence score vs threshold in telemetry
4. Check for Slack notifications (may be held for review)

### Delayed send not firing

1. Check `BackgroundJob` table for `AI_AUTO_SEND_DELAYED` jobs
2. Verify cron is running (`/api/cron/background-jobs`)
3. Check job status and error messages

### Slack notifications not sending

1. Verify `SLACK_BOT_TOKEN` is configured
2. Check `jon@zeroriskgrowth.com` has a Slack account
3. Check `SlackNotification` table for errors
```

### 2. Update CLAUDE.md

Add a section about auto-send architecture in the Architecture section:

```markdown
### Auto-Send System

The auto-send system (`lib/auto-send/`) handles automatic sending of AI-generated drafts:

- **Unified Orchestrator**: `executeAutoSend()` encapsulates all auto-send logic
- **Two Modes**: EmailCampaign AI_AUTO_SEND (with confidence scoring) or legacy per-lead auto-reply
- **Mutual Exclusion**: Campaign mode takes precedence over per-lead settings
- **Delay Support**: AI_AUTO_SEND mode supports configurable delay windows
- **Review Flow**: Low-confidence drafts trigger Slack notifications

See `lib/auto-send/README.md` for detailed documentation.
```

### 3. Enhanced Observability Logging

Update `orchestrator.ts` to include structured logging:

```typescript
// At the start of executeAutoSend()
const logContext = {
  clientId: context.clientId,
  leadId: context.leadId,
  draftId: context.draftId,
  channel: context.channel,
};

console.log("[AutoSend] Starting evaluation", logContext);

// At mode determination
console.log("[AutoSend] Mode determined", {
  ...logContext,
  mode,
  hasEmailCampaign: !!context.emailCampaign,
  campaignResponseMode: context.emailCampaign?.responseMode ?? null,
  autoReplyEnabled: context.autoReplyEnabled ?? false,
});

// At end of evaluation
console.log("[AutoSend] Evaluation complete", {
  ...logContext,
  mode: result.mode,
  action: result.outcome.action,
  ...result.telemetry,
});
```

### 4. Add JSDoc Comments

Ensure all exported functions have comprehensive JSDoc:

```typescript
/**
 * Executes the auto-send decision flow for a draft response.
 *
 * This is the main entry point for auto-send logic. It:
 * 1. Determines which mode to use (AI_AUTO_SEND, LEGACY_AUTO_REPLY, or DISABLED)
 * 2. Evaluates whether the draft should be sent
 * 3. Either sends immediately, schedules for later, or skips
 * 4. Sends Slack notifications for low-confidence drafts (AI_AUTO_SEND only)
 *
 * @param context - All context needed to make the auto-send decision
 * @returns Result indicating what action was taken and telemetry data
 *
 * @example
 * ```typescript
 * const result = await executeAutoSend({
 *   clientId: client.id,
 *   leadId: lead.id,
 *   // ... other fields
 * });
 *
 * if (result.outcome.action === "send_immediate") {
 *   console.log("Draft was sent immediately");
 * }
 * ```
 */
export async function executeAutoSend(
  context: AutoSendContext
): Promise<AutoSendResult> {
  // ...
}
```

### 5. Verification

1. Run `npm run lint`
2. Run `npm run build`
3. Review documentation for completeness (including precedence contract and delay semantics)
4. Verify all telemetry logging appears in console during test runs (test harness per subphase h)

## Output

- `lib/auto-send/README.md` created with architecture documentation
- `CLAUDE.md` updated with auto-send section
- Enhanced logging in orchestrator
- JSDoc comments on all public functions
- All lint/build checks pass

## Handoff

Proceed to subphase h to finalize the test harness + coverage gating so Phase 48 can meet its “>90% coverage” success criteria without drifting from repo reality.

## Final Verification Checklist

Before considering Phase 48 complete:

- [ ] All 4 background job files use `executeAutoSend()`
- [ ] Unit tests pass with >90% coverage
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] Manual smoke tests pass:
  - [ ] Email webhook → AI_AUTO_SEND campaign → immediate send
  - [ ] Email webhook → AI_AUTO_SEND campaign → delayed send
  - [ ] Email webhook → low confidence → Slack notification
  - [ ] SMS webhook → AI_AUTO_SEND campaign → auto-send
  - [ ] Legacy per-lead auto-reply still works
- [ ] Documentation reviewed and complete
- [ ] No regression in existing functionality
