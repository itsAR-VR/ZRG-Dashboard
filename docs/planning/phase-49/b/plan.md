# Phase 49b — Add Verifier Prompt Template + Config

## Focus

Create an editable prompt template for the step‑3 verifier and wire it to the existing prompt registry/override system, with a configurable small-model selection (requested: GPT‑5 mini medium).

## Inputs

- Phase 49a verifier contract
- Prompt registry / prompt override infrastructure (Phase 47):
  - `lib/ai/prompt-registry.ts` (templates + `getPromptWithOverrides`)
  - `prisma/schema.prisma` (`PromptOverride`, `PromptSnippetOverride`)
  - `lib/ai/prompt-snippets.ts` (workspace snippet overrides)

## Work

- Add a new prompt key (example: `draft.verify.step3.v1`) in `lib/ai/prompt-registry.ts`.
- Define prompt structure:
  - System message: “You are a verifier. Make minimal edits. Only fix violations.”
  - User message: provide:
    - latest inbound message
    - (optional) small “conversation state” summary (deterministic, not model-written)
    - canonical booking link
    - booking-process instruction block
    - forbidden rules
    - allowed availability slots (if applicable) with “do not invent/change” rule
    - step‑2 draft
    - explicit rubric of allowed edits (remove em‑dashes, fix booking link, remove forbidden terms, remove repetition, fix obvious logical contradiction)
  - Output format: strict JSON per Phase 49a.
- Add config for:
  - model name: `gpt-5-mini` (default) and reasoning effort `medium` (to match existing SMS/LinkedIn draft path)
  - temperature: default near 0 for determinism (explicitly set, unlike SMS/LinkedIn draft path)
  - max tokens: sized for short rewrite only (small budgets; avoid long rewrites)
- Ensure the prompt is editable via the Settings → AI Dashboard prompt editor (if Phase 47 UI exists).
- Optional (recommended): add a snippet key for rollout/disable switch (no schema change):
  - `draftVerifierStep3Enabled` default `"true"` in `lib/ai/prompt-snippets.ts`

## Validation (RED TEAM)

- Confirm the new prompt key shows up in template listing:
  - `rg -n "draft.verify.step3.v1" lib/ai/prompt-registry.ts`
- Confirm override plumbing will work:
  - `rg -n "getPromptWithOverrides\\(" lib/ai/prompt-registry.ts`

## Output

- Added prompt key `draft.verify.email.step3.v1` to `lib/ai/prompt-registry.ts`.
- Defined `EMAIL_DRAFT_VERIFY_STEP3_SYSTEM` system prompt with non-negotiable rules:
  - Fix wrong/placeholder/invalid booking links
  - Replace em-dashes with ", "
  - Remove forbidden terms
  - Remove repetition
  - Correct factual/proprietary info only when explicitly supported
  - Fix date/time logic contradictions with latest inbound
- Configured model: `gpt-5-mini` with `reasoning.effort="medium"`, temperature 0.
- JSON output schema: `{ finalDraft, changed, violationsDetected[], changes[] }`.
- Prompt is editable via `getPromptWithOverrides` (workspace overrides supported).

## Handoff

Subphase 49c calls this prompt + model config from `generateResponseDraft` (or equivalent) and enforces guardrails.
