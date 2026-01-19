# Phase 42e — Verification Runbook + Regression Coverage

## Focus
Prove the fixes work end-to-end and keep them from regressing by adding lightweight tests and a verification runbook aligned to the observed log errors.

## Inputs
- Outputs from Phases 42a–42d (call sites, error mappings, job enqueue semantics)
- Existing lint/build/test setup and any existing integration test patterns

## Work
- Add targeted regression coverage where it fits the repo:
  - job enqueue idempotency (duplicate enqueue does not throw)
  - EmailBison error mapping (`401` produces actionable error)
  - inbox counts unauth behavior (safe empty response)
- Write a verification runbook:
  - how to reproduce each failure mode safely (without secrets)
  - what log lines should disappear or downgrade in severity
  - how to validate in Vercel logs after deploy (specific endpoints/flows)
- Define a short “post-deploy watch” checklist for the next 24 hours.

## Output
- Added a runnable verification checklist: `docs/planning/phase-42/e/runbook.md`.
- Validation:
  - `npm run typecheck` passes.
  - `npm run lint` passes (warnings only; no errors).
  - `npm run build` passes.

## Handoff
Close Phase 42 once verification passes and production logs stay clean (no repeat of the Jan 19, 2026 error signatures).
