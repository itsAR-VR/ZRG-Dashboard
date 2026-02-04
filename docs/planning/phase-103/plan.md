# Phase 103 — Fix Email Draft Verification (Step 3) 400s + Make Model Selection Obvious

## Purpose
Stop the recurring OpenAI 400s in Email Draft Verification (Step 3) and make the verifier’s model choice obviously configurable (default: `gpt-5.2`, `reasoning.effort="none"`, low temperature).

## Context
Observed errors (2026-02-04):
- `400 Unsupported value: 'none' is not supported with the 'gpt-5-mini' model. Supported values are: 'minimal', 'low', 'medium', and 'high'.`

Repo history / prior phases:
- Phase 49 introduced `draft.verify.email.step3.v1` running on `gpt-5-mini` with low temperature.
- Phase 77/94 adjusted budgets/timeouts, but did not prevent this new “reasoning none” 400.
- Phase 100 identified root cause: prompt runner forced `reasoning.effort="none"` when `temperature` is set for `gpt-5*`, which breaks `gpt-5-mini`.

Decision locked in this conversation:
- Step 3 verifier should run on **`gpt-5.2`** with **`reasoning.effort="none"`** and **low temperature** (deterministic), and the model should be easy to override without editing call sites.

## Concurrent Phases / Working Tree State

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Working tree | Uncommitted | `actions/email-actions.ts`, `lib/email-send.ts`, `lib/followup-engine.ts` (email send/dedupe concurrency) | Do not alter these files in this phase unless required for build correctness. Still validate lint/build against combined state. |
| Phase 101 (planning) | Uncommitted docs | Mentions the same email send files | Keep Phase 103 scoped to prompt runner + tests; do not mix outcome-tracking work here. |

## Objectives
* [x] Ensure `gpt-5-mini` never receives `reasoning.effort="none"` (coerce to `minimal` when needed)
* [x] Default `draft.verify.email.step3.*` prompts to **`gpt-5.2`** via prompt runner (not call sites)
* [x] Make Step 3 model override obvious via env var `OPENAI_EMAIL_VERIFIER_MODEL`
* [x] Add/restore unit tests to prevent regression
* [x] Run `npm test`, `npm run lint`, `npm run build`

## Constraints
- Do not modify the Step 3 call site (`lib/ai-drafts.ts`) for this fix.
- Keep changes surgical: only prompt runner + tests + test orchestrator + planning docs.
- Do not touch unrelated files beyond the already-modified concurrency files in the working tree.

## Success Criteria
- Step 3 requests are sent with `model="gpt-5.2"` by default (telemetry reflects effective model).
- Step 3 requests use `reasoning.effort="none"` with low temperature (for `gpt-5.2`).
- `gpt-5-mini` requests never include `reasoning.effort="none"`; they use `minimal|low|medium|high` only.
- `OPENAI_EMAIL_VERIFIER_MODEL` overrides the Step 3 model without code changes.
- `npm test`, `npm run lint`, and `npm run build` all pass.

## Subphase Index
* a — Audit current Step 3 request parameters + root cause
* b — Wire model override + reasoning-effort coercion into prompt runner execution
* c — Restore tests + register in orchestrator
* d — Validate (lint/test/build) + rollout notes

## Repo Reality Check (RED TEAM)
- What exists today:
  - Step 3 verifier prompt key is `draft.verify.email.step3.v1` (call site remains `gpt-5-mini`, `temperature: 0`).
  - Prompt runner can override model + reasoning effort at execution time.
- Verified touch points:
  - `lib/ai/prompt-runner/runner.ts` exports `resolveModelForPromptRunner` + `resolveTemperatureAndReasoning`.
  - Step 3 model override env var: `OPENAI_EMAIL_VERIFIER_MODEL` (default `gpt-5.2`).
  - `gpt-5-mini` rejects `reasoning.effort="none"` (matches observed 400s); models before `gpt-5.1` do not support `none`.

## RED TEAM Findings (Gaps / Weak Spots)
### Highest-risk failure modes
- Misconfigured env override (`OPENAI_EMAIL_VERIFIER_MODEL`) → Step 3 may run on an unintended model; mitigation: confirm telemetry `model` for `featureId=draft.verify.email.step3` post-deploy.

### Documentation gaps
- `OPENAI_EMAIL_VERIFIER_MODEL` is not yet documented in repo env docs; follow-up: add to README/Vercel env var notes (out of scope for this phase).

## Phase Summary (running)
- 2026-02-04 12:02 EST — Finished Step 3 verifier fix (effective model override + reasoning-effort coercion) and locked it in with tests (files: `lib/ai/prompt-runner/runner.ts`, `lib/__tests__/prompt-runner-temperature-reasoning.test.ts`, `scripts/test-orchestrator.ts`).
