# Phase 63e — AI Drafts: Centralized Retries + Reduced Noise

## Focus
Reduce “reasoning-only incomplete output” failures and stop logging recoverable failures as errors by centralizing retry behavior in the prompt runner and adjusting SMS/LinkedIn draft settings.

## Inputs
- `lib/ai/prompt-runner/types.ts`
- `lib/ai/prompt-runner/runner.ts`
- `lib/ai-drafts.ts`

## Work
- [ ] Extend `runTextPrompt()` to support multi-attempt retries (similar to structured JSON runner).
- [ ] Update SMS/LinkedIn draft generation to use lower reasoning effort and retry budgets without logging per-attempt errors.
- [ ] Allow small OpenAI SDK retries for email fallback paths where safe.

## Output
- Extended `runTextPrompt()` (`lib/ai/prompt-runner/runner.ts`) to support multi-attempt retries via `attempts`, with optional `retryReasoningEffort` and configurable `retryOn` categories.
- Updated SMS/LinkedIn draft generation (`lib/ai-drafts.ts`) to:
  - use lower reasoning effort by default,
  - run a single retry-capable prompt call with escalating output budgets,
  - avoid logging per-attempt failures as `console.error` (logs once after exhausting retries).
- Enabled small OpenAI SDK retries for email single-step fallback (`lib/ai-drafts.ts`, `maxRetries: 1`) to reduce transient timeout failures.

## Handoff
Proceed to Phase 63f to add targeted tests, add a runbook, run `npm test`/`lint`/`build`, and mark Phase 63 success criteria complete.
