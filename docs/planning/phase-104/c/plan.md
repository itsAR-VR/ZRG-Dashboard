# Phase 104c — Runtime Wiring + Tests Update

## Focus
Make Step 3 verifier use the workspace setting (with env override) and update tests to reflect the new behavior.

## Inputs
- `lib/ai-drafts.ts` (Step 3 verifier)
- `lib/ai-drafts/config.ts` (coercion helpers)
- `lib/ai/prompt-runner/runner.ts` (reasoning coercion stays; Step 3 model override may be removed)
- `lib/__tests__/prompt-runner-temperature-reasoning.test.ts`

## Work
- Add coercion helper for verifier model (default `gpt-5.2`).
- In Step 3 verifier:
  - Determine model with precedence:
    1) `OPENAI_EMAIL_VERIFIER_MODEL` (if non-empty)
    2) `WorkspaceSettings.emailDraftVerificationModel` (if set)
    3) default `gpt-5.2`
- Remove prompt-runner Step 3 model override so UI selection is respected.
- Update unit tests to focus on reasoning-effort compatibility (no Step 3 model override in runner).

## Validation
- `npm test`

## Output
Runtime wiring completed:
- `lib/ai-drafts.ts` Step 3 verifier now chooses model via:
  1) `OPENAI_EMAIL_VERIFIER_MODEL` (env, if set)
  2) `WorkspaceSettings.emailDraftVerificationModel`
  3) default `gpt-5.2`
- `lib/ai/prompt-runner/runner.ts` no longer overrides Step 3 model; it only enforces model-compatible reasoning-effort behavior (prevents `gpt-5-mini` + `temperature` from using `none`).
- Updated `lib/__tests__/prompt-runner-temperature-reasoning.test.ts` to focus on reasoning-effort compatibility (removed Step 3 model override tests).

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added verifier model coercion helper and wired Step 3 to respect workspace setting.
  - Removed prompt-runner special-casing for Step 3 model to ensure UI selection is honored.
- Commands run:
  - `npm test` — pass
- Blockers:
  - None
- Next concrete steps:
  - Run full quality gates and record rollout notes.

## Handoff
Proceed to Phase 104d for full validations + rollout notes.
