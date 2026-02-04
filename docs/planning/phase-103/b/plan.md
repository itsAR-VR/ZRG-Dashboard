# Phase 103b — Wire Model Override + Effort Coercion into Prompt Runner Execution

## Focus
Ensure the prompt runner actually sends:
- Step 3 verifier prompts (`draft.verify.email.step3.*`) on `gpt-5.2` by default (env override supported)
- model-compatible `reasoning.effort` (never `none` for `gpt-5-mini`)

## Inputs
- `lib/ai/prompt-runner/runner.ts`
- Env var: `OPENAI_EMAIL_VERIFIER_MODEL` (default `gpt-5.2`)

## Work
- In `runStructuredJsonPrompt` and `runTextPrompt`:
  - Compute `effectiveModel = resolveModelForPromptRunner({ promptKey: params.promptKey, model: params.model })`
  - Use `effectiveModel` for:
    - `computeAdaptiveMaxOutputTokens({ model: ... })`
    - `resolveTemperatureAndReasoning({ model: ... })`
    - OpenAI request `params.model`
    - telemetry `buildTelemetryBase({ model: ... })`
- Keep behavior unchanged for non-Step 3 prompts (no override).

## Validation
- Typecheck via `npm run build` (Next.js compile)
- Unit tests added in Phase 103c cover resolver behavior and Step 3 override.

## Output
Shipped prompt-runner execution wiring:
- Step 3 model override is now applied via `effectiveModel` inside:
  - `runStructuredJsonPrompt(...)`
  - `runTextPrompt(...)`
- `effectiveModel` is used consistently for:
  - `computeAdaptiveMaxOutputTokens({ model })` (budgeting)
  - `resolveTemperatureAndReasoning({ model })` (sampling + reasoning effort)
  - OpenAI request params `model`
  - telemetry `model` field (so monitoring reflects actual model used)

Notes:
- Default Step 3 model is `gpt-5.2`, configurable via `OPENAI_EMAIL_VERIFIER_MODEL`.
- When `temperature` is provided on GPT‑5 family models:
  - `gpt-5.2` uses `reasoning.effort="none"`
  - `gpt-5-mini` uses `reasoning.effort="minimal"` (never `none`)

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented `effectiveModel = resolveModelForPromptRunner({ promptKey, model })` and threaded it through OpenAI calls + telemetry.
- Commands run:
  - (Covered in Phase 103d) build/test validation run after code changes.
- Blockers:
  - None
- Next concrete steps:
  - Add/restore regression tests and register them in the test orchestrator.

## Handoff
Proceed to Phase 103c to restore unit tests and register them in the test orchestrator.
