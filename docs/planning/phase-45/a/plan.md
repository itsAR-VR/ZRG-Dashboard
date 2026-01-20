# Phase 45a — Booking Link Null Case Fix

## Focus

Fix the root cause of Bug 1 where AI generates literal placeholder text like `{insert booking link}` when no booking link is configured. The fix adds an explicit instruction telling the AI **not** to use placeholders when the booking link is null.

## Inputs

- Root plan analysis: `lib/booking-process-instructions.ts:177-193` is the source of the bug
- Current behavior: When `stage.includeBookingLink` is true but `getBookingLink()` returns null, no instruction is added (silent skip)
- AI behavior: Without explicit guidance, AI hallucinates a placeholder based on training data patterns

## Work

### 1. Read current file state

Read `lib/booking-process-instructions.ts` to confirm the exact location and structure of the `if (bookingLink)` block.

### 2. Add else branch

After the existing `if (bookingLink)` block (around line 191), add an `else` branch that:

1. Pushes an explicit instruction to the `instructions` array telling the AI NOT to use any placeholder text
2. Logs a warning so operators can identify workspaces with missing booking links
3. Suggests alternative language the AI should use instead (ask for availability, offer to send times)

### 3. Code change

```typescript
// After the existing if (bookingLink) { ... } block
} else {
  // No booking link configured - explicitly tell AI not to use placeholder
  instructions.push(
    `IMPORTANT: No booking link is configured for this workspace. Do NOT include any placeholder text like "{booking link}", "{insert booking link}", "[booking link]", or similar. Instead, ask the lead for their availability or offer to send specific times.`
  );
  console.warn(
    `[BookingProcess] Stage ${stage.stageNumber} requests booking link but none configured for client ${clientId}`
  );
}
```

### 4. Verify no TypeScript errors

Run `npx tsc --noEmit` on the file to catch any type issues.

## Output

- Modified `lib/booking-process-instructions.ts` with explicit "no placeholder" instruction when booking link is null
- Warning log added for operator visibility

## Handoff

Subphase b will add post-processing sanitization in `lib/ai-drafts.ts` as a safety net to catch any placeholders or truncated URLs that slip through despite the prompt fix.
