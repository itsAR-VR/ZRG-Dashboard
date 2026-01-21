# Phase 48e — Migration: sms-inbound-post-process.ts

## Focus

Migrate `lib/background-jobs/sms-inbound-post-process.ts` from duplicated inline auto-send logic to using the new `executeAutoSend()` orchestrator. This file has ~118 lines of auto-send logic.

## Inputs

- Orchestrator from subphase b: `lib/auto-send/orchestrator.ts`
- Migration pattern from subphase d: email-inbound-post-process.ts
- Current `lib/background-jobs/sms-inbound-post-process.ts` (lines 264-382 contain auto-send logic)

## Work

### 1. Pre-Migration: Identify SMS-Specific Differences

Compare SMS logic to email logic to catch any channel-specific behavior:

| Aspect | Email | SMS | Action |
|--------|-------|-----|--------|
| Subject | Has subject | Always null | Pass `subject: null` |
| Transcript fallback | `transcript \|\| latestInbound` | `transcript \|\| "Lead: ${messageBody}"` | Pass conversation history as-is |
| automatedReply flag | null | null | Same |
| Channel | "email" | "sms" | Pass correct channel |

SMS uses a slightly different transcript fallback but this is handled before calling auto-send.

### 2. Add Import

At top of file, add:
```typescript
import { executeAutoSend } from "@/lib/auto-send";
```

### 3. Replace Auto-Send Block (Lines ~254-382)

**Current code to replace:**
```typescript
// Lines 254-382: Auto-send evaluation and execution
if (draftResult.success && draftResult.draftId && draftResult.content) {
  const draftId = draftResult.draftId;
  const draftContent = draftResult.content;

  console.log(`[SMS Post-Process] Generated AI draft: ${draftId}`);

  const responseMode = lead.emailCampaign?.responseMode ?? null;
  const autoSendThreshold = lead.emailCampaign?.autoSendConfidenceThreshold ?? 0.9;

  // 8. Auto-Send Evaluation (EmailCampaign mode)
  if (responseMode === "AI_AUTO_SEND" && draftId && draftContent) {
    // ... evaluation + delay + Slack logic ...
  } else if (!lead.emailCampaign && lead.autoReplyEnabled && draftId) {
    // ... legacy auto-reply logic ...
  }
}
```

**New code:**
```typescript
if (draftResult.success && draftResult.draftId && draftResult.content) {
  console.log(`[SMS Post-Process] Generated AI draft: ${draftResult.draftId}`);

  const autoSendResult = await executeAutoSend({
    clientId: client.id,
    leadId: lead.id,
    triggerMessageId: message.id,
    draftId: draftResult.draftId,
    draftContent: draftResult.content,
    channel: "sms",
    latestInbound: messageBody,
    subject: null, // SMS has no subject
    conversationHistory: transcript || `Lead: ${messageBody}`,
    sentimentTag: newSentiment,
    messageSentAt: messageSentAt,
    automatedReply: null,
    leadFirstName: lead.firstName,
    leadLastName: lead.lastName,
    leadEmail: lead.email,
    emailCampaign: lead.emailCampaign,
    autoReplyEnabled: lead.autoReplyEnabled,
  });

  // Log outcome
  switch (autoSendResult.outcome.action) {
    case "send_immediate":
      console.log(`[SMS Post-Process] Auto-sent draft ${draftResult.draftId} (immediate)`);
      break;
    case "send_delayed":
      console.log(
        `[SMS Post-Process] Scheduled delayed send for draft ${draftResult.draftId}, runAt: ${autoSendResult.outcome.runAt.toISOString()}`
      );
      break;
    case "needs_review":
      console.log(
        `[SMS Post-Process] Auto-send blocked for draft ${draftResult.draftId}: ${autoSendResult.outcome.reason}`
      );
      break;
    case "skip":
      console.log(`[SMS Post-Process] Auto-send skipped: ${autoSendResult.outcome.reason}`);
      break;
    case "error":
      console.error(`[SMS Post-Process] Auto-send error: ${autoSendResult.outcome.error}`);
      break;
  }
} else {
  console.error(`[SMS Post-Process] Failed to generate AI draft: ${draftResult.error}`);
}
```

### 4. Remove Old Imports

Remove these imports that are no longer needed:
```typescript
// REMOVE (now handled by orchestrator)
import { evaluateAutoSend } from "@/lib/auto-send-evaluator";
import { decideShouldAutoReply } from "@/lib/auto-reply-gate";
import { scheduleDelayedAutoSend, getCampaignDelayConfig } from "@/lib/background-jobs/delayed-auto-send";
import { sendSlackDmByEmail } from "@/lib/slack-dm";
import { getPublicAppUrl } from "@/lib/app-url";
```

Keep `approveAndSendDraftSystem` import only if used elsewhere in the file (check before removing).

### 5. Verify Lead Query Includes Required Fields

Check the lead inclusion in the message query (around line 29-52):

```typescript
const message = await prisma.message.findUnique({
  where: { id: params.messageId },
  include: {
    lead: {
      include: {
        client: {
          select: {
            id: true,
            settings: true,
          },
        },
        emailCampaign: {
          select: {
            id: true,
            name: true,
            bisonCampaignId: true,
            responseMode: true,
            autoSendConfidenceThreshold: true,
          },
        },
      },
    },
  },
});
```

Verify the lead object has:
- `firstName` ✅ (included by default with `include`)
- `lastName` ✅ (included by default)
- `email` ✅ (included by default)
- `autoReplyEnabled` ✅ (included by default)
- `sentimentTag` ✅ (included by default)

Note: Since SMS uses `include` instead of `select`, all lead fields are available.

### 6. Check `newSentiment` vs `lead.sentimentTag`

The SMS file uses `newSentiment` (the updated sentiment after classification) rather than `lead.sentimentTag`. Make sure we pass the correct one:

```typescript
// Earlier in the file:
const newSentiment = updatedLead?.sentimentTag || lead.sentimentTag;

// In auto-send call:
sentimentTag: newSentiment, // ✅ Use the updated value
```

### 7. Validation

1. Run `npm run lint`
2. Run `npm run build`
3. Manual smoke test:
   - Send test SMS to lead with AI_AUTO_SEND campaign
   - Verify draft is generated
   - Verify auto-send behavior matches expected outcome

### 8. Line Count Comparison

**Before:** ~128 lines of auto-send related code (lines 254-382)
**After:** ~30 lines (context building + switch statement)
**Reduction:** ~98 lines removed

## Output

- `lib/background-jobs/sms-inbound-post-process.ts` updated to use orchestrator
- SMS-specific behavior preserved (null subject, transcript fallback)
- Code is simpler and more maintainable
- Build and lint pass

## Handoff

Second migration complete. Subphase f will migrate the remaining two files (`smartlead-inbound-post-process.ts` and `instantly-inbound-post-process.ts`) together since they're nearly identical.
