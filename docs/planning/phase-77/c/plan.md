# Phase 77c — Fix Email Draft Strategy and Verification Token Budgets

## Focus

Fix `max_output_tokens` error in Email Draft Strategy (Step 1) and timeout error in Email Draft Verification (Step 3) by increasing token budgets and adding retry capability.

## Inputs

- Phase 77b complete (follow-up parsing fixed)
- Error logs showing:
  - Email Draft Strategy: `hit max_output_tokens (incomplete=max_output_tokens output_types=reasoning,message)`
  - Email Draft Verification: `Request timed out.`
- Current configurations:
  - Strategy base tokens: 2000 (env: `OPENAI_EMAIL_STRATEGY_BASE_MAX_OUTPUT_TOKENS`)
  - Verification: `attempts: [1400]`, `timeoutMs: Math.max(5000, opts.timeoutMs)`, retries handled by prompt runner (+20% tokens per attempt)

## Work

### Pre-Flight

1. Check git status for `lib/ai-drafts.ts`
2. Re-read current file contents (Phase 75 and 76 have modified it)
3. Note any conflicting changes that need merging

### Implementation

1. Locate strategy token budget configuration (around line 1460)
2. Update base default from 2000 to 5000:
   ```typescript
   const strategyBaseMaxOutputTokens = Math.max(
     500,
     Number.parseInt(process.env.OPENAI_EMAIL_STRATEGY_BASE_MAX_OUTPUT_TOKENS || "5000", 10) || 5000
   );
   ```

3. Locate Step 3 verification configuration (around line 277)
4. Increase timeout floor; rely on global prompt-runner retry policy (+20% tokens per attempt):
   ```typescript
   timeoutMs: Math.max(5000, opts.timeoutMs),
   ```

5. Run `npm run lint` to verify no errors
6. Run `npm run build` to verify build passes

## Output

- `lib/ai-drafts.ts` updated with:
  - Higher base token budget for Strategy step
  - Retry capability and longer timeout for Verification step
- Email Draft Strategy should complete on first attempt
- Email Draft Verification should retry on timeout

## Handoff

Phase 77 complete. Monitor error dashboard for 24 hours to confirm all fixes are effective.

## Review Notes

- **Evidence:**
  - `lib/ai-drafts.ts:1543` — strategyBaseMaxOutputTokens default now `"5000"`
  - `lib/ai-drafts.ts:280` — timeoutMs floor now `Math.max(5000, opts.timeoutMs)`
- **Deviations:**
  - Verification retry attempts not added per revised plan (rely on prompt runner global retry)
  - Subphase d (Hardening) not implemented — deferred as optional
- **Status:** Complete
