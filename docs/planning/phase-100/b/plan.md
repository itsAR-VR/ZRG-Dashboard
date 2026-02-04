# Phase 100b — Implement Fix + Tests

## Focus
Fix prompt runner model-parameter resolution so:
- `gpt-5-mini` never receives `reasoning.effort="none"` (use `minimal` as the lowest supported effort instead)
- Email Draft Verification (Step 3) defaults to `gpt-5.2` (no reasoning + low temperature)

## Inputs
- `lib/ai/prompt-runner/runner.ts` has `resolveTemperatureAndReasoning()` that currently forces `none` for `gpt-5*` when temperature is provided.
- Step 3 verifier call site: `lib/ai-drafts.ts` uses `model="gpt-5-mini"`, `temperature: 0`, `reasoningEffort: "low"`.

## Work
- Update `resolveTemperatureAndReasoning()`:
  - When `temperature` is set for `gpt-5*` models, use a model-compatible “lowest” reasoning effort:
    - `none` for models that support it (`gpt-5.1`, `gpt-5.2`)
    - `minimal` for older GPT-5 family models that reject `none` (e.g., `gpt-5-mini`)
  - If caller requests `reasoningEffort="none"` for models that don’t support `none`, coerce to `"minimal"`.
  - Keep behavior for models that support `none` (e.g., `gpt-5.1`, `gpt-5.2`).
- Add unit tests validating:
  - `gpt-5-mini` + `temperature` yields `effort="minimal"` (not `none`).
  - `gpt-5-mini` + `reasoningEffort="none"` coerces to `"minimal"`.
  - `gpt-5.2` + `temperature` (no explicit reasoning) defaults to `effort="none"` (compat behavior).
- Register the new test file in `scripts/test-orchestrator.ts`.
- Add a Step 3 model override (prompt runner):
  - Default `draft.verify.email.step3.*` prompts to `gpt-5.2`
  - Allow env override via `OPENAI_EMAIL_VERIFIER_MODEL`

## Validation
- `npm test`
- `npm run lint`
- `npm run build`

## Output
Shipped:
- Prompt runner now:
  - Uses model-compatible lowest reasoning effort when `temperature` is set for `gpt-5*` models (`none` or `minimal`).
  - Coerces `reasoningEffort="none"` to `"minimal"` for `gpt-5*` models that don’t support `none` (e.g., `gpt-5-mini`).
  - Defaults Step 3 verifier to `gpt-5.2` (env override: `OPENAI_EMAIL_VERIFIER_MODEL`).
- Added unit test coverage for the resolver behavior and registered it in the test orchestrator.

Files changed:
- `lib/ai/prompt-runner/runner.ts`
- `lib/__tests__/prompt-runner-temperature-reasoning.test.ts`
- `scripts/test-orchestrator.ts`

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented model-aware reasoning-effort coercion so `gpt-5-mini` no longer receives `reasoning.effort="none"`.
  - Added unit tests to prevent regressions for `gpt-5-mini` (and keep `gpt-5.2` temperature compatibility behavior).
- Commands run:
  - `npm test` — pass
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Blockers:
  - None
- Next concrete steps:
  - Document rollout verification steps (monitor Step 3 verifier 400s) in Phase 100c.

## Handoff
Proceed to Phase 100c for post-change verification notes + rollout guidance.
