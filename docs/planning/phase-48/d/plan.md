# Phase 48d — Migration: email-inbound-post-process.ts

## Focus

Migrate `lib/background-jobs/email-inbound-post-process.ts` from duplicated inline auto-send logic to using the new `executeAutoSend()` orchestrator. This is the largest and most complex of the 4 files (~120 lines of auto-send logic).

## Inputs

- Orchestrator from subphase b: `lib/auto-send/orchestrator.ts`
- Tests from subphase c verifying orchestrator behavior
- Current `lib/background-jobs/email-inbound-post-process.ts` (lines 901-1057 contain auto-send logic)

## Work

### 1. Pre-Migration: Document Current Behavior

Before modifying, verify understanding of current flow:

```
Draft generated successfully?
├── YES: Check responseMode
│   ├── AI_AUTO_SEND: evaluateAutoSend()
│   │   ├── confidence >= threshold:
│   │   │   ├── delay configured: scheduleDelayedAutoSend()
│   │   │   └── no delay: approveAndSendDraftSystem()
│   │   └── confidence < threshold: sendSlackDmByEmail() for review
│   └── LEGACY (no campaign + autoReplyEnabled): decideShouldAutoReply()
│       ├── shouldReply: approveAndSendDraftSystem()
│       └── !shouldReply: skip
└── NO: Log error, continue
```

### 2. Add Import

At top of file, add:
```typescript
import { executeAutoSend } from "@/lib/auto-send";
```

### 3. Replace Auto-Send Block (Lines ~901-1057)

**Current code to replace:**
```typescript
// Lines 928-1057: All the auto-send logic after draft generation
if (draftResult.success && draftResult.draftId && draftResult.content) {
  const draftId = draftResult.draftId;
  const draftContent = draftResult.content;

  const responseMode = lead.emailCampaign?.responseMode ?? null;
  const autoSendThreshold = lead.emailCampaign?.autoSendConfidenceThreshold ?? 0.9;

  let autoReplySent = false;

  if (responseMode === "AI_AUTO_SEND") {
    // ... 100+ lines of evaluation, delay, slack notification logic
  } else if (!lead.emailCampaign && lead.autoReplyEnabled) {
    // ... 20+ lines of legacy auto-reply logic
  }

  if (autoReplySent) {
    console.log(`[Email PostProcess] Auto-replied for lead ${lead.id} (draft ${draftId})`);
  }
}
```

**New code:**
```typescript
if (draftResult.success && draftResult.draftId && draftResult.content) {
  const autoSendResult = await executeAutoSend({
    clientId: client.id,
    leadId: lead.id,
    triggerMessageId: message.id,
    draftId: draftResult.draftId,
    draftContent: draftResult.content,
    channel: "email",
    latestInbound: inboundText,
    subject: message.subject ?? null,
    conversationHistory: transcript,
    sentimentTag: lead.sentimentTag,
    messageSentAt: message.sentAt ?? new Date(),
    automatedReply: null, // Email webhook doesn't track this
    leadFirstName: lead.firstName,
    leadLastName: lead.lastName,
    leadEmail: lead.email,
    emailCampaign: lead.emailCampaign,
    autoReplyEnabled: lead.autoReplyEnabled,
  });

  // Log outcome
  switch (autoSendResult.outcome.action) {
    case "send_immediate":
      console.log(`[Email PostProcess] Auto-sent draft ${draftResult.draftId} (immediate)`);
      break;
    case "send_delayed":
      console.log(
        `[Email PostProcess] Scheduled delayed send for draft ${draftResult.draftId}, runAt: ${autoSendResult.outcome.runAt.toISOString()}`
      );
      break;
    case "needs_review":
      console.log(
        `[Email PostProcess] Auto-send blocked for draft ${draftResult.draftId}: ${autoSendResult.outcome.reason} (confidence: ${autoSendResult.outcome.confidence})`
      );
      break;
    case "skip":
      console.log(`[Email PostProcess] Auto-send skipped: ${autoSendResult.outcome.reason}`);
      break;
    case "error":
      console.error(`[Email PostProcess] Auto-send error: ${autoSendResult.outcome.error}`);
      break;
  }
}
```

### 4. Remove Old Imports

Remove these imports that are no longer needed directly in this file:
```typescript
// REMOVE (now handled by orchestrator)
import { evaluateAutoSend } from "@/lib/auto-send-evaluator";
import { decideShouldAutoReply } from "@/lib/auto-reply-gate";
import { scheduleDelayedAutoSend, getCampaignDelayConfig } from "@/lib/background-jobs/delayed-auto-send";
import { sendSlackDmByEmail } from "@/lib/slack-dm";
import { getPublicAppUrl } from "@/lib/app-url";
// Note: Keep approveAndSendDraftSystem if used elsewhere, otherwise remove
```

Wait - `approveAndSendDraftSystem` is still used by other parts of the codebase. Check if this file uses it for anything other than auto-send. If not, remove the import.

### 5. Verify Lead Selection Includes Required Fields

Ensure the lead query (around line 581-603) includes all fields needed by the orchestrator:

```typescript
const lead = await prisma.lead.findUnique({
  where: { id: opts.leadId },
  select: {
    id: true,
    clientId: true,
    firstName: true,       // ✅ Needed for leadFirstName
    lastName: true,        // ✅ Needed for leadLastName
    email: true,           // ✅ Needed for leadEmail
    phone: true,
    linkedinUrl: true,
    emailBisonLeadId: true,
    sentimentTag: true,    // ✅ Needed for sentimentTag
    autoReplyEnabled: true, // ✅ Needed for mode detection
    emailCampaign: {
      select: {
        id: true,          // ✅ Needed for delay config lookup
        name: true,        // ✅ Needed for Slack notification
        bisonCampaignId: true, // ✅ Needed for Slack notification
        responseMode: true,    // ✅ Needed for mode detection
        autoSendConfidenceThreshold: true, // ✅ Needed for threshold
      },
    },
  },
});
```

### 6. Update Any Re-selections After Classification

The file re-selects the lead after sentiment classification (around line 746-770). Ensure that selection also includes `autoReplyEnabled`:

```typescript
lead = await prisma.lead.update({
  where: { id: lead.id },
  data: { sentimentTag: newSentimentTag, status: newStatus },
  select: {
    // ... all existing fields ...
    autoReplyEnabled: true, // ✅ Add if missing
    emailCampaign: {
      select: {
        // ... all campaign fields ...
      },
    },
  },
});
```

### 7. Validation

1. Run `npm run lint`
2. Run `npm run build`
3. Manual smoke test:
   - Send test email to lead with AI_AUTO_SEND campaign
   - Verify draft is generated
   - Verify auto-send behavior (immediate or delayed based on config)
   - Verify Slack notification if confidence < threshold

### 8. Line Count Comparison

**Before:** ~156 lines of auto-send related code (lines 901-1057)
**After:** ~35 lines (context building + switch statement)
**Reduction:** ~121 lines removed

## Output

- `lib/background-jobs/email-inbound-post-process.ts` updated to use orchestrator
- All auto-send behavior preserved exactly
- Code is simpler and more maintainable
- Build and lint pass

## Handoff

First migration complete. Subphase e will migrate `sms-inbound-post-process.ts` using the same pattern.
