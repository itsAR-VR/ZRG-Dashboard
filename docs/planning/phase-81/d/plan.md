# Phase 81d — Orchestrator: Multi-Recipient DM Sending

## Focus

Modify the auto-send orchestrator to send approval DMs to all configured recipients, with fallback to the hardcoded email when no recipients are configured.

## Inputs

- Phase 81b: `sendSlackDmByUserId()` function available
- Phase 81c: `getConfiguredApprovalRecipients()` helper available
- Existing code: `lib/auto-send/orchestrator.ts` has `sendReviewNeededSlackDm()` function

## Work

### 1. Update Imports in `lib/auto-send/orchestrator.ts`

```typescript
import { sendSlackDmByEmail, sendSlackDmByUserId } from "@/lib/slack-dm";
import { getConfiguredApprovalRecipients, type SlackApprovalRecipient } from "./get-approval-recipients";
```

### 2. Update Dependencies Type

Add the new function to the dependencies interface:

```typescript
export type AutoSendDependencies = {
  // ... existing deps ...
  sendSlackDmByEmail: typeof sendSlackDmByEmail;
  sendSlackDmByUserId: typeof sendSlackDmByUserId;  // NEW
  getConfiguredApprovalRecipients: typeof getConfiguredApprovalRecipients;  // NEW
  // ... rest ...
};
```

### 3. Modify `sendReviewNeededSlackDm()` Function

Replace the current single-recipient logic with multi-recipient support:

```typescript
async function sendReviewNeededSlackDm(params: {
  context: AutoSendContext;
  confidence: number;
  threshold: number;
  reason: string;
}): Promise<{
  success: boolean;
  skipped?: boolean;
  error?: string;
  messageTs?: string;
  channelId?: string;
  recipientResults?: Array<{ userId: string; success: boolean; error?: string }>;
}> {
  const { context, confidence, threshold, reason } = params;

  // Build message content (existing code)
  const leadName = buildLeadName(context);
  const campaignLabel = buildCampaignLabel(context);
  const dashboardUrl = `${deps.getPublicAppUrl()}/?view=inbox&clientId=${encodeURIComponent(context.clientId)}&leadId=${encodeURIComponent(context.leadId)}&draftId=${encodeURIComponent(context.draftId)}`;
  const blocks = [/* ... existing blocks ... */];
  const text = `AI Auto-Send: Review needed for ${leadName}...`;

  // NEW: Fetch configured recipients
  const recipients = await deps.getConfiguredApprovalRecipients(context.clientId);

  // If no recipients configured, fall back to hardcoded email
  if (!recipients || recipients.length === 0) {
    console.log(`[AutoSend] No approval recipients configured for workspace ${context.clientId}, using fallback`);

    return deps.sendSlackDmByEmail({
      email: AUTO_SEND_CONSTANTS.REVIEW_NOTIFICATION_EMAIL,
      dedupeKey: `auto_send_review:${context.draftId}`,
      text,
      blocks,
    });
  }

  // Send to all configured recipients
  const recipientResults: Array<{ userId: string; success: boolean; error?: string }> = [];
  let firstSuccess: { messageTs?: string; channelId?: string } | null = null;

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];

    // Add delay between sends to avoid rate limiting (500ms after first)
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const result = await deps.sendSlackDmByUserId({
      userId: recipient.id,
      dedupeKey: `auto_send_review:${context.draftId}:${recipient.id}`,
      text,
      blocks,
    });

    recipientResults.push({
      userId: recipient.id,
      success: result.success,
      error: result.error,
    });

    // Capture first successful send for return value
    if (result.success && !result.skipped && !firstSuccess) {
      firstSuccess = { messageTs: result.messageTs, channelId: result.channelId };
    }
  }

  // Success if at least one recipient received the message
  const anySuccess = recipientResults.some((r) => r.success);
  const allSkipped = recipientResults.every((r) => r.success && r.skipped);

  return {
    success: anySuccess,
    skipped: allSkipped,
    error: anySuccess ? undefined : recipientResults.map((r) => r.error).filter(Boolean).join("; "),
    messageTs: firstSuccess?.messageTs,
    channelId: firstSuccess?.channelId,
    recipientResults,
  };
}
```

### 4. Update Default Dependencies

In the default dependencies object (used when not testing):

```typescript
const defaultDeps: AutoSendDependencies = {
  // ... existing ...
  sendSlackDmByEmail,
  sendSlackDmByUserId,  // NEW
  getConfiguredApprovalRecipients,  // NEW
  // ... rest ...
};
```

### 5. Validation

- [ ] Run `npm run lint` — should pass
- [ ] Run `npm run build` — should pass
- [ ] Verify existing tests still pass (if any exist for orchestrator)

## Output

- `lib/auto-send/orchestrator.ts`: Multi-recipient approval DMs via workspace token + skip-on-missing config
- `lib/auto-send/__tests__/orchestrator.test.ts`: Updated deps to include approval config + token-based DM sender
- `scripts/backfill-ai-auto-send.ts`: Updated executor deps for new Slack approval config

## Handoff

Orchestrator is ready. Phase 81e will add the UI for selecting recipients, which will populate the `slackAutoSendApprovalRecipients` field that the orchestrator reads.
