# Phase 100a — Audit + Confirm Root Cause

## Focus
Confirm where `reasoning.effort="none"` is coming from and why it is being sent to `gpt-5-mini` for Email Draft Verification (Step 3).

## Inputs
- Error: `Unsupported value: 'none' is not supported with the 'gpt-5-mini' model. Supported values are: 'minimal', 'low', 'medium', and 'high'.`
- Call site: `lib/ai-drafts.ts` Step 3 verifier uses `temperature: 0` and `reasoningEffort: "low"`.
- Prompt runner: `lib/ai/prompt-runner/runner.ts` decides what to send to OpenAI.

## Work
- Identify all occurrences of `effort: "none"` and confirm the call path for Step 3.
- Verify current logic in `resolveTemperatureAndReasoning()` overrides caller-provided reasoning when `temperature` is set.
- Capture which previous phases introduced/justified the behavior (Phase 77 decision).

## Validation
- `rg "effort:\\s*\\\"none\\\"" -n lib`
- Read `lib/ai-drafts.ts` Step 3 verifier config and `lib/ai/prompt-runner/runner.ts` resolver.

## Output
Confirmed root cause and call path:
- Step 3 verifier (`lib/ai-drafts.ts`) sets `model="gpt-5-mini"`, `reasoningEffort="low"`, and `temperature: 0`.
- Prompt runner (`lib/ai/prompt-runner/runner.ts`) was overriding reasoning when temperature is set, forcing `reasoning.effort="none"` for all `gpt-5*` models.
- OpenAI rejects `none` for `gpt-5-mini` (expects `minimal|low|medium|high`), producing the observed 400s.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Traced the 400 error to `resolveTemperatureAndReasoning()` forcing `effort="none"` for `gpt-5-mini` when `temperature` is set.
  - Confirmed Step 3 verifier is a high-volume call site for this behavior (`draft.verify.email.step3`).
- Commands run:
  - `rg -n "effort:\\s*\\"none\\"" -S lib` — pass (found only prompt runner)
  - Read `lib/ai-drafts.ts` and `lib/ai/prompt-runner/runner.ts` — pass
- Blockers:
  - None
- Next concrete steps:
  - Update prompt runner to avoid `effort="none"` for models that reject it (use `minimal` for `gpt-5-mini`).

## Handoff
Proceed to Phase 100b to implement the prompt-runner fix and add a regression test.
