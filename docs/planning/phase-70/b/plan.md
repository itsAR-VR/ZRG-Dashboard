# Phase 70b — Orchestrator Update (Persist Evaluation Data)

## Focus

Modify `lib/auto-send/orchestrator.ts` to save the confidence score, threshold, reason, and action to the `AIDraft` record after each auto-send evaluation.

## Inputs

- 70a: Updated `AIDraft` schema with new fields
- Current orchestrator logic in `lib/auto-send/orchestrator.ts`
- `AutoSendEvaluation` return type from evaluator

## Work

1. In `executeAiAutoSendPath()`, after evaluation completes:

```typescript
// After evaluation and before returning result
await prisma.aIDraft.update({
  where: { id: draft.id },
  data: {
    autoSendEvaluatedAt: new Date(),
    autoSendConfidence: evaluation.confidence,
    autoSendThreshold: threshold,
    autoSendReason: evaluation.reason,
    autoSendAction: result.action,
    autoSendSlackNotified: result.action === 'needs_review',
  },
});
```

2. Ensure all code paths (immediate, delayed, needs_review, skip, error) update the draft

3. Test with backfill script to verify data is persisted

## Output

- Updated `lib/auto-send/orchestrator.ts` with evaluation persistence
- All new auto-send evaluations now save confidence/reason to database

## Handoff

Pass to 70c. The sidebar filters can now query `autoSendAction` to filter leads.
