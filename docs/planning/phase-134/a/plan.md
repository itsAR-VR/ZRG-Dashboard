# Phase 134a — Sentiment Guard Implementation

## Focus

Add sentiment guards at three layers to prevent auto-booking on Out of Office, Automated Reply, and Blacklist messages. The primary fix is at the pipeline level (Layer 1); Layers 2-3 are defense-in-depth.

## Inputs

- Root plan analysis: three missing guards identified
- Existing block patterns in `lib/auto-reply-gate.ts:47` and `lib/auto-send-evaluator.ts:236`
- Current `processMessageForAutoBooking()` signature: `(leadId, messageBody, meta?: { channel?, messageId? })`

## Work

### Define blocked sentiments constant

Create a reusable constant (in `lib/sentiment-shared.ts` or inline) for sentiments that should block auto-booking:

```typescript
const AUTO_BOOKING_BLOCKED_SENTIMENTS = ["Out of Office", "Automated Reply", "Blacklist"];
```

### Layer 1 — Pipeline guard (`lib/inbound-post-process/pipeline.ts:~294`)

Before the `processMessageForAutoBooking()` call, add a sentiment check:

```typescript
pushStage("auto_booking");
const autoBookBlockedSentiments = ["Out of Office", "Automated Reply", "Blacklist"];
const skipAutoBook = sentimentTag != null && autoBookBlockedSentiments.includes(sentimentTag);
const autoBook = !skipAutoBook && inboundReplyOnly
  ? await processMessageForAutoBooking(lead.id, inboundReplyOnly, {
      channel: "email",
      messageId: message.id,
      sentimentTag,
    })
  : { booked: false as const };
```

Key details:
- `sentimentTag` is already in scope (classified at ~line 214)
- Only block on KNOWN bad sentiments; null/undefined sentiment still proceeds
- Pass `sentimentTag` through meta for Layer 2

### Layer 2 — Function signature guard (`lib/followup-engine.ts:~3500`)

Expand the `meta` parameter type and add an early-return:

```typescript
export async function processMessageForAutoBooking(
  leadId: string,
  messageBody: string,
  meta?: { channel?: "sms" | "email" | "linkedin"; messageId?: string | null; sentimentTag?: string | null }
): Promise<...> {
  // Defense-in-depth: block known non-scheduling sentiments
  const blocked = ["Out of Office", "Automated Reply", "Blacklist"];
  if (meta?.sentimentTag && blocked.includes(meta.sentimentTag)) {
    return { booked: false };
  }
  // ... existing logic
```

This is defense-in-depth — even if a future caller bypasses the pipeline check, the function itself blocks.

### Layer 3 — Meeting Overseer guard (`lib/meeting-overseer.ts:~145`)

Add a negative sentiment check at the top of `shouldRunMeetingOverseer()`:

```typescript
export function shouldRunMeetingOverseer(opts: {
  messageText: string;
  sentimentTag?: string | null;
  offeredSlotsCount?: number;
}): boolean {
  // Block non-scheduling sentiments from triggering overseer
  const blockedSentiments = ["Out of Office", "Automated Reply", "Blacklist"];
  if (opts.sentimentTag && blockedSentiments.includes(opts.sentimentTag)) return false;

  // ... existing logic
```

Note: `shouldRunMeetingOverseer()` is currently only called from `ai-drafts.ts` (not from the auto-booking path), but adding this guard prevents future regressions if the function is ever called from auto-booking code.

### Verify all callers

Confirm no other callers of `processMessageForAutoBooking()` are affected:
- `lib/inbound-post-process/pipeline.ts` — primary caller (guard added)
- `lib/background-jobs/email-inbound-post-process.ts` — may call directly; check and add `sentimentTag` passthrough if present
- `lib/background-jobs/sms-inbound-post-process.ts` — may call directly; check and add `sentimentTag` passthrough if present

## Output

- Three-layer sentiment guard preventing auto-booking on OOO/Automated/Blacklist messages
- `sentimentTag` flows through the auto-booking pipeline for observability
- No behavioral change for positive-sentiment or unknown-sentiment messages

## Handoff

Phase 134b adds unit tests verifying the guards work for all blocked and allowed sentiment combinations.
