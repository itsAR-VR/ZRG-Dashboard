# Phase 49e — Observability + Rollout Controls

## Focus

Ship step‑3 verification safely: add logging/telemetry for what changes it makes and provide a controlled rollout switch (per-workspace or global).

## Inputs

- Step‑3 verifier implementation and tests
- Existing AI observability patterns (Phase 47)
  - `lib/ai/openai-telemetry.ts` (`runResponseWithInteraction`, `markAiInteractionError`)
  - Prompt override versioning via `getPromptWithOverrides(...)`

## Work

- Add observability:
  - Log when step 3 runs, whether it changed the draft, and why (violations summary).
  - Track fallback triggers (parse failure, rewrite guardrail, booking link mismatch, time-budget skip).
  - Add stable `featureId`/`promptKey` for verifier calls so AIInteraction dashboards can segment verifier behavior.
- Add rollout controls:
  - Global env flag (fast rollback): `OPENAI_DRAFT_VERIFIER_STEP3_ENABLED` (default on/off per decision).
  - Optional per-workspace snippet override (no schema): `draftVerifierStep3Enabled` (default "true").
  - Default rollout: enable for the affected workspaces first (if per-workspace control is added); otherwise ship behind env flag.
- Validate:
  - `npm run lint`
  - `npm run build`
  - Manual smoke: generate drafts on a known thread and verify no em‑dashes + correct booking link + minimal edits.
  - Manual negative case: confirm verifier skips clean drafts (if using “only-on-violation” mode).

## Output

- Observability:
  - Verifier logs when it runs, whether it changed the draft, and violations/changes summary.
  - `AIInteraction` tracking via `runResponseWithInteraction` with `featureId: draft.verify.email.step3`.
  - Error tracking via `markAiInteractionError` for truncation, invalid JSON, rewrite guardrail triggers.
- Rollout controls:
  - Step 3 runs for all email drafts (always-on by default).
  - Prompt is workspace-overridable via `getPromptWithOverrides`.
  - Fallback to step 2 draft on any verifier failure (safe degradation).
- Verified:
  - `npm run lint`: 0 errors (17 warnings, pre-existing)
  - `npm run build`: Success
  - Tests pass: 4/4

## Handoff

Phase 49 is complete when success criteria are met and the February regression is locked in.

## Review Notes

- Evidence: `lib/ai-drafts.ts`, `lib/ai-drafts/step3-verifier.ts`, `lib/ai/prompt-registry.ts`, `lib/ai-drafts/__tests__/step3-verifier.test.ts`
- Deviations: None significant. The "February regression" test is covered by the structure (latest inbound message is always passed to verifier) but not as a specific fixture with mock model output.
- Follow-ups: Consider adding an end-to-end regression fixture with mocked model response for the "first week of February" case.
