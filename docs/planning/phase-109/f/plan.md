# Phase 109f — Insights Cron: Retry/Budget Bump on max_output_tokens + Validation

## Focus
Reduce noisy failures in `/api/cron/insights/booked-summaries` caused by insight extraction hitting `max_output_tokens`.

## Inputs
- Logs artifact: `logs_result (2).json` shows repeated:
  - `[Insights Cron] Failed to compute booked summary` with `Post-process error: hit max_output_tokens (incomplete=max_output_tokens ...)`
- Cron route: `app/api/cron/insights/booked-summaries/route.ts`
- Extractor: `lib/insights-chat/thread-extractor.ts` → `extractConversationInsightForLead` (line 233)

## RED TEAM Finding: Retry Logic Already Exists

**Critical discovery:** The prompt-runner (`lib/ai/prompt-runner/runner.ts`) **already handles `max_output_tokens` retries** (lines 300-306, 573-579). When a response is incomplete due to token exhaustion, it automatically retries with higher budget using:
- `retryMax` budget cap
- `retryExtraTokens` per retry
- Exponential budget expansion via `retryOutputTokensMultiplier`

**Current thread-extractor budget (lines 489-497):**
```typescript
budget: {
  min: 800,
  max: 2400,
  retryMax: 3200,        // Already has retry budget
  retryExtraTokens: 900, // Already configured
  overheadTokens: 520,
  outputScale: 0.25,
  preferApiCount: true,
},
```

## Revised Work (Minimal Change)

Since retry logic already exists, the issue is likely that `retryMax: 3200` is insufficient for complex threads. Options:

1. **Bump `retryMax`** from 3200 → 4000 or 4800 (preferred, simple)
2. **(Rejected)** Add `retryReasoningEffort: "low"` to preserve output tokens on retry
   - Not available for `StructuredJsonPromptParams` (`pattern: "structured_json"`) — only supported on `TextPromptParams`.

## Work (Revised)
1. **In `lib/insights-chat/thread-extractor.ts`** (around line 489), update the extraction budget:
   ```typescript
   budget: {
     min: 800,
     max: 2400,
     retryMax: 4800,        // Bumped from 3200
     retryExtraTokens: 1200, // Bumped from 900
     overheadTokens: 520,
     outputScale: 0.25,
     preferApiCount: true,
   },
   ```

2. Keep the change small and localized:
   - Do NOT refactor the whole insights pipeline.
   - Do NOT change schemas or stored insight shape.
   - Do NOT add duplicate retry logic in `extractConversationInsightForLead`.

3. Confirm behavior:
   - Cron still returns `status=200` but counts failures; failures should be reduced.

## Validation (RED TEAM)
- [x] Verified `retryReasoningEffort` is **not** a valid param in `StructuredJsonPromptParams` (see `lib/ai/prompt-runner/types.ts`)
- [ ] Manual test: run insights cron on lead with long transcript → verify retry behavior
- [ ] Monitor: check `AIInteraction` table for retry attempts (look for `.retry2`, `.retry3` suffixes)
- [x] `npm test`, `npm run lint`, `npm run build` pass

## Output
- Fewer booked-summaries failures due to max token exhaustion.
- Code changes:
  - `lib/insights-chat/thread-extractor.ts` (bump `retryMax` from 3200 → 4800; bump `retryExtraTokens` from 900 → 1200)
  - No new retry logic added: relies on `lib/ai/prompt-runner/runner.ts` existing incomplete-output retry path

## Handoff
After this subphase, run the end-to-end smoke steps:
- Mark a lead Interested and verify drafts appear.
- Confirm email webhook no longer errors on null bytes.
- Observe Insights cron logs for reduced token-exhaustion failures.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Confirmed prompt-runner already retries on `max_output_tokens` incomplete outputs.
  - Increased the structured-json retry budget in the insights thread extractor to reduce chronic booked-summaries failures.
  - Confirmed `retryReasoningEffort` is not available for structured-json prompts (only text prompts).
- Commands run:
  - `npm test` — pass (174 tests)
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass (warnings only)
- Blockers:
  - Live cron verification (post-deploy) is still pending to confirm error volume materially drops in production logs.
- Next concrete steps:
  - Write `docs/planning/phase-109/review.md` with evidence mapping and multi-agent notes.
