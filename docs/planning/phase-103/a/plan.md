# Phase 103a — Audit Step 3 Request Parameters + Root Cause

## Focus
Confirm the exact Step 3 prompt key, call path, and why `reasoning.effort="none"` was being sent to `gpt-5-mini`.

## Inputs
- Error dashboard entry (2026-02-04): `Unsupported value: 'none' ... gpt-5-mini`
- Step 3 prompt key: `draft.verify.email.step3.v1`
- Prompt runner: `lib/ai/prompt-runner/runner.ts`

## Work
- Verify Step 3 uses `draft.verify.email.step3.v1` and `temperature: 0` at the call site.
- Confirm prompt runner overrides reasoning when temperature is set for GPT‑5 family models.
- Identify the minimal patch point: ensure model override and effort coercion are applied to the **effective model** actually sent to OpenAI.

## Validation
- `rg -n "draft\\.verify\\.email\\.step3" lib/ai-drafts.ts lib/ai/prompt-registry.ts lib/ai/prompt-runner -S`
- Inspect `resolveTemperatureAndReasoning()` and how `params.model` is used in OpenAI request params.

## Output
Confirmed root cause + call path:
- Step 3 prompt key is `draft.verify.email.step3.v1` (call site in `lib/ai-drafts.ts`).
- Prompt runner was previously using `params.model` everywhere and was forcing a temperature-compatible reasoning effort (`none`) for GPT‑5 family when `temperature` is set.
- OpenAI rejects `reasoning.effort="none"` for `gpt-5-mini` (expects `minimal|low|medium|high`), producing the observed 400s.
- Fix must be applied to the **effective model actually sent** to OpenAI (and reflected in telemetry), not just the resolver helper.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Verified Step 3 prompt key and call path: `draft.verify.email.step3.v1`.
  - Confirmed the 400s were caused by `reasoning.effort="none"` being sent to `gpt-5-mini`.
- Commands run:
  - `rg -n "draft\\.verify\\.email\\.step3" lib/ai-drafts.ts lib/ai/prompt-registry.ts lib/ai/prompt-runner -S` — pass (confirmed prompt key + runner touch point)
  - `git status --porcelain` — pass (identified unrelated modified UI file and reverted it)
- Blockers:
  - None
- Next concrete steps:
  - Wire Step 3 model override + effort coercion into prompt runner execution (`runStructuredJsonPrompt`, `runTextPrompt`).

## Handoff
Proceed to Phase 103b to wire the model override and reasoning-effort coercion into the actual request execution path.
