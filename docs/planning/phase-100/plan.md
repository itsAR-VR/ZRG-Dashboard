# Phase 100 — Fix GPT-5-mini "reasoning none" 400s (Email Draft Verification Step 3)

## Purpose
Stop OpenAI 400s in Email Draft Verification (Step 3) caused by sending `reasoning.effort="none"` to `gpt-5-mini`, which only supports `minimal|low|medium|high`.

## Context
Error dashboard (2026-02-04) shows repeated failures:
- `400 Unsupported value: 'none' is not supported with the 'gpt-5-mini' model. Supported values are: 'minimal', 'low', 'medium', and 'high'.`

Updated decision (2026-02-04): Step 3 verifier should run on **`gpt-5.2`** with **no reasoning** (`reasoning.effort="none"`) and **low temperature**.

Relevant prior phases:
- Phase 49 — Step-3 Draft Verification Pass: Step 3 verifier uses `gpt-5-mini`, `temperature: 0`, `reasoningEffort: "low"`.
- Phase 77 — AI Pipeline Error Fixes: included a rule to force `reasoning="none"` when `temperature` is set for GPT-5 models.
- Phase 94 — Timeout + Token Budget Mitigations: reduced timeouts/truncations for Step 3 but did not address this new 400.

## Repo Reality Check (RED TEAM)

### What Exists Today

| Component | File Path | Verified |
|-----------|-----------|----------|
| Step 3 verifier call site | `lib/ai-drafts.ts` | ✓ Uses `model="gpt-5-mini"`, `temperature: 0`, `reasoningEffort: "low"` |
| Prompt runner sampling resolver | `lib/ai/prompt-runner/runner.ts` | ✓ Uses model-compatible lowest effort with `temperature` (`none` or `minimal`), coerces unsupported `none` → `minimal`, and defaults Step 3 to `gpt-5.2` |

### Root Cause
`resolveTemperatureAndReasoning()` used to force `reasoning.effort="none"` for `gpt-5*` models when `temperature` is set. `gpt-5-mini` rejects `none`, so Step 3 verification requests failed with a 400.

## Objectives
* [x] Use a model-compatible lowest reasoning effort when `temperature` is set for `gpt-5*` models (`none` or `minimal`)
* [x] Coerce unsupported `reasoningEffort="none"` to `minimal` for models that do not support `none`
* [x] Default Step 3 verifier to `gpt-5.2` (configurable via `OPENAI_EMAIL_VERIFIER_MODEL`)
* [x] Add a unit test covering `gpt-5-mini` + temperature + reasoning effort behavior
* [x] Run `npm test`, `npm run lint`, `npm run build`

## Constraints
- Minimal change: touch only prompt runner + unit tests.
- No schema changes.
- Do not modify prompt content or verifier logic beyond request parameters.

## Success Criteria
- [x] `gpt-5-mini` never uses `reasoning.effort="none"` (unit test)
- [x] `gpt-5-mini` uses `reasoning.effort="minimal"` when `temperature` is set (unit test)
- [x] Step 3 verifier runs on `gpt-5.2` by default (prompt runner override)
- [x] Step 3 verifier model is configurable via `OPENAI_EMAIL_VERIFIER_MODEL`
- [x] `npm test` passes
- [x] `npm run lint` passes
- [x] `npm run build` passes

## Subphase Index
* a — Audit + confirm root cause
* b — Implement fix + tests
* c — Validate + rollout notes

## Assumptions (Agent)
1. `gpt-5-mini` rejects `reasoning.effort="none"` and accepts `minimal|low|medium|high` (confidence ~95%).
   - Mitigation: unit test + validate by exercising the Step 3 path in production telemetry after deploy.

## Phase Summary

### Shipped
- **Model-aware reasoning effort coercion** in prompt runner (`lib/ai/prompt-runner/runner.ts`)
  - `supportsNoneReasoningEffort()` — identifies `gpt-5.1`/`gpt-5.2` as supporting `none`
  - `coerceReasoningEffortForModel()` — coerces `none` → `minimal` for unsupported models
  - Updated `resolveTemperatureAndReasoning()` to use model-compatible lowest effort
- **Step 3 model override** in prompt runner (`lib/ai/prompt-runner/runner.ts`)
  - Defaults `draft.verify.email.step3.*` prompts to `gpt-5.2`
  - Env override: `OPENAI_EMAIL_VERIFIER_MODEL`
- **Unit tests** (`lib/__tests__/prompt-runner-temperature-reasoning.test.ts`)
  - 5 tests covering `gpt-5-mini` and `gpt-5.2` reasoning effort + Step 3 model override
- **Test registration** (`scripts/test-orchestrator.ts`)

### Verified
- `npm run lint` — Pass (warnings only, unrelated)
- `npm run build` — Pass
- `npm test` — Pass (136 tests, 0 failures)

### Key Files
- `lib/ai/prompt-runner/runner.ts` — Core fix
- `lib/__tests__/prompt-runner-temperature-reasoning.test.ts` — Tests
- `scripts/test-orchestrator.ts` — Test registration

### Notes
- See `review.md` for full evidence mapping and implementation verification
- Post-deploy: Monitor `AIInteraction` for `draft.verify.email.step3` — 400 errors should drop to zero
