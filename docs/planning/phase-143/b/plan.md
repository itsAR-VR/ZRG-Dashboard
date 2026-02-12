# Phase 143b — Pipeline Type + Email Pipeline Integration

## Focus

Add the `"action_signal_detection"` stage to the pipeline type union, then wire detection + notification into the shared email pipeline, gated by `isPositiveSentiment()`.

## Inputs

- `lib/action-signal-detector.ts` from Phase 143a
- `lib/inbound-post-process/types.ts` (pipeline stage union)
- `lib/inbound-post-process/pipeline.ts` (email pipeline)
- `lib/meeting-booking-provider.ts` → `resolveBookingLink()`

## Work

### 1. Update `lib/inbound-post-process/types.ts`

Add `"action_signal_detection"` between `"resume_enrichment_followups"` and `"draft_generation"`.

### 2. Wire into `lib/inbound-post-process/pipeline.ts`

Import `detectActionSignals`, `notifyActionSignals`, `EMPTY_ACTION_SIGNAL_RESULT`, `isPositiveSentiment`, and `resolveBookingLink`.

Insert between `resume_enrichment_followups` (line ~344) and `draft_generation` (line ~346):

```
pushStage("action_signal_detection");
let actionSignals = EMPTY_ACTION_SIGNAL_RESULT;
try {
  if (isPositiveSentiment(sentimentTag)) {
    const workspaceBookingLink = await resolveBookingLink(client.id, null)
      .then(r => r.bookingLink).catch(() => null);
    actionSignals = await detectActionSignals({
      strippedText: inboundReplyOnly,    // ← already stripped of signatures
      fullText: rawText,                  // ← full message including signature
      sentimentTag,
      workspaceBookingLink,
      clientId: client.id,
      leadId: lead.id,
    });
    if (actionSignals.signals.length > 0) {
      console.log(prefix, "Action signals:", actionSignals.signals.map(s => s.type).join(", "));
      notifyActionSignals({
        clientId: client.id, leadId: lead.id, messageId: message.id,
        signals: actionSignals.signals, latestInboundText: messageBody,
      }).catch(err => console.warn(prefix, "Action signal notify failed:", err));
    }
  }
} catch (err) {
  console.warn(prefix, "Action signal detection failed (non-fatal):", err);
}
```

Pass `actionSignals` to `generateResponseDraft` opts.

**Key design point:** `inboundReplyOnly` (line 277) is already computed from `stripEmailQuotedSectionsForAutomation(inboundText)` and used for snooze detection and auto-booking. We reuse it for Tier 1 heuristic detection. `rawText` (line 158) is the full message for Tier 2 comparison.

## Output

- Pipeline types updated
- Email pipeline has gated detection + notification + pass-through

## Handoff

Email pipeline complete. Phase 143c applies identical pattern to SMS and LinkedIn pipelines. Phase 143d adds `actionSignals` to `DraftGenerationOptions`.
