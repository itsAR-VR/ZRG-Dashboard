# Phase 72d — AI Draft Context Enhancement

## Focus

Update AI draft generation to be aware of who actually sent the inbound message, so drafts address the correct person (CC replier vs original lead).

## Inputs

- Phase 72c: Lead now has `currentReplierEmail`, `currentReplierName` populated when CC person replies
- Message records have `fromEmail`, `fromName` for actual sender
- `lib/ai-drafts.ts` is the main draft generation file

## Work

### 1. Fetch Trigger Message Context

In `generateResponseDraft()` (around where `triggerMessageId` is used), fetch the sender info:

```typescript
// If we have a trigger message, get the actual sender
let replierContext: {
  replierEmail: string | null;
  replierName: string | null;
  isAlternateReplier: boolean;
} = {
  replierEmail: null,
  replierName: null,
  isAlternateReplier: false,
};

if (options?.triggerMessageId) {
  const triggerMessage = await prisma.message.findUnique({
    where: { id: options.triggerMessageId },
    select: { fromEmail: true, fromName: true, direction: true },
  });

  if (triggerMessage?.direction === "inbound" && triggerMessage.fromEmail) {
    const { isCcReplier } = detectCcReplier({
      leadEmail: lead.email,
      inboundFromEmail: triggerMessage.fromEmail,
    });

    replierContext = {
      replierEmail: triggerMessage.fromEmail,
      replierName: triggerMessage.fromName,
      isAlternateReplier: isCcReplier,
    };
  }
}
```

### 2. Adjust Greeting Name

When building the AI prompt, use the replier's name if they're a CC replier:

```typescript
// In resolvePersona or buildEmailDraftStrategyInstructions
const greetingName = replierContext.isAlternateReplier && replierContext.replierName
  ? extractFirstName(replierContext.replierName)
  : firstName;
```

### 3. Add Replier Context to Strategy Instructions

In `buildEmailDraftStrategyInstructions()` or similar, add context about who the reply is addressing:

```typescript
const replierSection = replierContext.isAlternateReplier
  ? `
REPLIER CONTEXT:
The most recent reply came from ${replierContext.replierName || "a CC'd recipient"} (${replierContext.replierEmail}).
This person is CC'd on the thread — they are NOT the original lead (${firstName} ${lastName}, ${lead.email}).
Address your response appropriately:
- Use "${extractFirstName(replierContext.replierName) || "the replier"}" in your greeting
- Acknowledge you're responding to their message specifically
- The original lead (${firstName}) is CC'd and will see this response
`
  : "";
```

### 4. Thread Through to Prompt Templates

Ensure the replier context flows through to:
- `getAIPromptTemplate()` calls
- Strategy generation prompts
- Final draft generation

## Output

- `lib/ai-drafts.ts` now selects `currentReplier*` fields and uses them to resolve greeting name for email drafts.
- Strategy instructions include “Current Replier” when a CC replier is active.
- Email draft greetings avoid misaddressing the original lead when a CC contact replied.

## Coordination Notes

**Potential conflicts with:** Phase 66/69/67 (AI draft pipeline edits)
**Files affected:** `lib/ai-drafts.ts`
**Integration notes:** Added optional context fields only; prompt keys and model selection unchanged.

## Handoff

AI drafts now address the correct person. Phase 72e will ensure outbound emails are routed correctly (TO/CC resolution).
