# Phase 48f — Migration: smartlead + instantly inbound post-process

## Focus

Migrate the remaining two background job files from duplicated inline auto-send logic to using the orchestrator:
- `lib/background-jobs/smartlead-inbound-post-process.ts` (~115 lines)
- `lib/background-jobs/instantly-inbound-post-process.ts` (~113 lines)

These files are nearly identical and can be migrated together.

## Inputs

- Orchestrator from subphase b: `lib/auto-send/orchestrator.ts`
- Migration pattern from subphases d & e
- Current files with auto-send logic at lines ~280-395

## Work

### Part A: smartlead-inbound-post-process.ts

#### A1. Add Import

```typescript
import { executeAutoSend } from "@/lib/auto-send";
```

#### A2. Replace Auto-Send Block (Lines ~277-398)

**Current code to replace:**
```typescript
if (draftResult.success) {
  const draftId = draftResult.draftId;
  const draftContent = draftResult.content || undefined;

  const responseMode = emailCampaign?.responseMode ?? null;
  const autoSendThreshold = emailCampaign?.autoSendConfidenceThreshold ?? 0.9;

  // EmailCampaign AI Auto-Send Path
  if (responseMode === "AI_AUTO_SEND" && draftId && draftContent) {
    // ... 100+ lines of evaluation, delay, Slack logic ...
  } else if (!emailCampaign && lead.autoReplyEnabled && draftId) {
    // ... legacy auto-reply logic ...
  } else {
    console.log("[SmartLead Post-Process] Draft created:", draftId, "(no auto-send)");
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
    latestInbound: messageBody,
    subject: subject,
    conversationHistory: transcript,
    sentimentTag: sentimentTag,
    messageSentAt: messageSentAt,
    automatedReply: null,
    leadFirstName: lead.firstName,
    leadLastName: lead.lastName,
    leadEmail: lead.email,
    emailCampaign: emailCampaign,
    autoReplyEnabled: lead.autoReplyEnabled,
  });

  // Log outcome
  switch (autoSendResult.outcome.action) {
    case "send_immediate":
      console.log(`[SmartLead Post-Process] Auto-sent draft ${draftResult.draftId}`);
      break;
    case "send_delayed":
      console.log(
        `[SmartLead Post-Process] Scheduled delayed send for draft ${draftResult.draftId}, runAt: ${autoSendResult.outcome.runAt.toISOString()}`
      );
      break;
    case "needs_review":
      console.log(`[SmartLead Post-Process] Auto-send blocked: ${autoSendResult.outcome.reason}`);
      break;
    case "skip":
      // This handles both disabled auto-send and cases where conditions aren't met
      if (autoSendResult.mode === "DISABLED") {
        console.log(`[SmartLead Post-Process] Draft created: ${draftResult.draftId} (no auto-send)`);
      } else {
        console.log(`[SmartLead Post-Process] Auto-send skipped: ${autoSendResult.outcome.reason}`);
      }
      break;
    case "error":
      console.error(`[SmartLead Post-Process] Auto-send error: ${autoSendResult.outcome.error}`);
      break;
  }
} else if (!draftResult.success) {
  console.error("[SmartLead Post-Process] Failed to generate AI draft:", draftResult.error);
}
```

#### A3. Remove Old Imports

```typescript
// REMOVE
import { evaluateAutoSend } from "@/lib/auto-send-evaluator";
import { decideShouldAutoReply } from "@/lib/auto-reply-gate";
import { scheduleDelayedAutoSend, getCampaignDelayConfig } from "@/lib/background-jobs/delayed-auto-send";
import { sendSlackDmByEmail } from "@/lib/slack-dm";
import { getPublicAppUrl } from "@/lib/app-url";
```

#### A4. Verify Variables Available

Check that these variables are in scope at the auto-send block:
- `client.id` ✅ (from `message.lead.client`)
- `lead.id` ✅
- `message.id` ✅
- `messageBody` ✅ (assigned earlier)
- `subject` ✅ (assigned earlier as `message.subject ?? null`)
- `transcript` ✅ (built from messages)
- `sentimentTag` ✅ (result of classification)
- `messageSentAt` ✅ (assigned as `message.sentAt || new Date()`)
- `emailCampaign` ✅ (from `lead.emailCampaign`)
- `lead.autoReplyEnabled` ✅ (verify this field is selected)

---

### Part B: instantly-inbound-post-process.ts

#### B1. Add Import

```typescript
import { executeAutoSend } from "@/lib/auto-send";
```

#### B2. Replace Auto-Send Block (Lines ~284-398)

Nearly identical to SmartLead. Replace with:

```typescript
if (draftResult.success && draftResult.draftId && draftResult.content) {
  const autoSendResult = await executeAutoSend({
    clientId: client.id,
    leadId: lead.id,
    triggerMessageId: message.id,
    draftId: draftResult.draftId,
    draftContent: draftResult.content,
    channel: "email",
    latestInbound: messageBody,
    subject: subject,
    conversationHistory: transcript,
    sentimentTag: sentimentTag,
    messageSentAt: messageSentAt,
    automatedReply: null,
    leadFirstName: lead.firstName,
    leadLastName: lead.lastName,
    leadEmail: lead.email,
    emailCampaign: emailCampaign,
    autoReplyEnabled: lead.autoReplyEnabled,
  });

  // Log outcome
  switch (autoSendResult.outcome.action) {
    case "send_immediate":
      console.log(`[Instantly Post-Process] Auto-sent draft ${draftResult.draftId}`);
      break;
    case "send_delayed":
      console.log(
        `[Instantly Post-Process] Scheduled delayed send for draft ${draftResult.draftId}, runAt: ${autoSendResult.outcome.runAt.toISOString()}`
      );
      break;
    case "needs_review":
      console.log(`[Instantly Post-Process] Auto-send blocked: ${autoSendResult.outcome.reason}`);
      break;
    case "skip":
      if (autoSendResult.mode === "DISABLED") {
        console.log(`[Instantly Post-Process] Draft created: ${draftResult.draftId} (no auto-send)`);
      } else {
        console.log(`[Instantly Post-Process] Auto-send skipped: ${autoSendResult.outcome.reason}`);
      }
      break;
    case "error":
      console.error(`[Instantly Post-Process] Auto-send error: ${autoSendResult.outcome.error}`);
      break;
  }
} else if (!draftResult.success) {
  console.error("[Instantly Post-Process] Failed to generate AI draft:", draftResult.error);
}
```

#### B3. Remove Old Imports

Same as SmartLead:
```typescript
// REMOVE
import { evaluateAutoSend } from "@/lib/auto-send-evaluator";
import { decideShouldAutoReply } from "@/lib/auto-reply-gate";
import { scheduleDelayedAutoSend, getCampaignDelayConfig } from "@/lib/background-jobs/delayed-auto-send";
import { sendSlackDmByEmail } from "@/lib/slack-dm";
import { getPublicAppUrl } from "@/lib/app-url";
```

#### B4. Verify Lead Selection

Check the lead query includes `autoReplyEnabled`:

```typescript
// Around line 84-106
const lead = message.lead;
// Verify lead.autoReplyEnabled is accessible
```

If using `include` (which includes all fields), this should work. If using `select`, ensure `autoReplyEnabled` is included.

---

### Validation

1. Run `npm run lint`
2. Run `npm run build`
3. Manual smoke tests:
   - SmartLead webhook → draft → auto-send flow
   - Instantly webhook → draft → auto-send flow

### Line Count Comparison

**SmartLead:**
- Before: ~121 lines (277-398)
- After: ~35 lines
- Reduction: ~86 lines

**Instantly:**
- Before: ~114 lines (284-398)
- After: ~35 lines
- Reduction: ~79 lines

**Combined Reduction:** ~165 lines

---

## Output

- `lib/background-jobs/smartlead-inbound-post-process.ts` updated to use orchestrator
- `lib/background-jobs/instantly-inbound-post-process.ts` updated to use orchestrator
- All behavior preserved
- Build and lint pass

## Handoff

All 4 background job files are now migrated. Subphase g will add documentation and observability improvements.
