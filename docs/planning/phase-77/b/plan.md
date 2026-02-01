# Phase 77b — Increase Follow-up Parsing Token Budgets

## Focus

Fix `max_output_tokens` errors in `parseAcceptedTimeFromMessage()` and `detectMeetingAcceptedIntent()` by increasing token budgets to accommodate reasoning model overhead.

## Inputs

- Phase 77a complete (signature extraction fixed)
- Error logs showing: `Post-process error: hit max_output_tokens (incomplete=max_output_tokens output_types=reasoning)`
- Current token budgets:
  - `parseAcceptedTimeFromMessage()`: max 400 tokens
  - `detectMeetingAcceptedIntent()`: max 256 tokens

## Work

### Pre-Flight

1. Check git status for `lib/followup-engine.ts`
2. Re-read current file contents (Phase 75 may have modified it)

### Implementation

1. Locate `parseAcceptedTimeFromMessage()` (around line 2133)
2. Update budget configuration (base budget + retry cap; prompt runner auto-retries with +20% tokens per attempt):
   ```typescript
   budget: {
     min: 800,
     max: 1200,
     retryMax: 1600,
     overheadTokens: 128,
     outputScale: 0.1,
     preferApiCount: true,
   }
   ```

3. Locate `detectMeetingAcceptedIntent()` (around line 2297)
4. Update budget configuration (base budget + retry cap; prompt runner auto-retries with +20% tokens per attempt):
   ```typescript
   budget: {
     min: 512,
     max: 800,
     retryMax: 1200,
     overheadTokens: 96,
     outputScale: 0.1,
     preferApiCount: true,
   }
   ```

5. Run `npm run lint` to verify no errors

## Output

- `lib/followup-engine.ts` updated with increased token budgets
- Follow-up parsing should complete without token exhaustion

## Handoff

Subphase 77c will address the Email Draft Strategy and Verification token budget issues in `lib/ai-drafts.ts`.

## Review Notes

- **Evidence:**
  - `lib/followup-engine.ts:2133-2140` — parseAcceptedTimeFromMessage budget: min 800, max 1200, retryMax 1600
  - `lib/followup-engine.ts:2298-2305` — detectMeetingAcceptedIntent budget: min 512, max 800, retryMax 1200
- **Deviations:** None — implemented as planned
- **Status:** Complete
