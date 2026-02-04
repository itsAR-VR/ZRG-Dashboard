# Phase 103c — Restore Tests + Register in Test Orchestrator

## Focus
Lock the resolver behavior in with regression tests and ensure the tests run in CI/local via the repo’s test orchestrator.

## Inputs
- `lib/ai/prompt-runner/runner.ts` exported helpers:
  - `resolveModelForPromptRunner`
  - `resolveTemperatureAndReasoning`
- `scripts/test-orchestrator.ts`

## Work
- Add `lib/__tests__/prompt-runner-temperature-reasoning.test.ts` with coverage:
  - `gpt-5-mini` + temperature => `reasoning.effort="minimal"`
  - `gpt-5-mini` + `reasoningEffort="none"` => coerces to `"minimal"`
  - `gpt-5.2` + temperature => `reasoning.effort="none"`
  - Step 3 promptKey defaults to `gpt-5.2`
  - Env override via `OPENAI_EMAIL_VERIFIER_MODEL`
- Register the test file path in `scripts/test-orchestrator.ts` so it runs with `npm test`.

## Validation
- `npm test` passes.

## Output
Added regression tests and ensured they run under `npm test`:
- New test file: `lib/__tests__/prompt-runner-temperature-reasoning.test.ts`
  - Covers:
    - `gpt-5-mini` + temperature => `reasoning.effort="minimal"`
    - `gpt-5-mini` + `reasoningEffort="none"` => coerces to `"minimal"`
    - `gpt-5.2` + temperature => `reasoning.effort="none"`
    - Step 3 default model override => `gpt-5.2`
    - Env override `OPENAI_EMAIL_VERIFIER_MODEL`
- Registered in `scripts/test-orchestrator.ts`

## Progress This Turn (Terminus Maximus)
- Work done:
  - Restored test coverage for prompt-runner temperature/reasoning + Step 3 model override.
  - Registered test file in the orchestrator to prevent regressions.
- Commands run:
  - `npm test` — pass (includes new tests)
- Blockers:
  - None
- Next concrete steps:
  - Run full quality gates and capture rollout notes.

## Handoff
Proceed to Phase 103d for full repo quality gates + rollout notes.
