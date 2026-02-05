# Phase 106n — Validation: Tests, Lint/Build, QA Checklist

## Focus
Run required quality gates and document evidence.

## Inputs
- New/updated tests from subphases i–m
- Repo quality gates: `npm test`, `npm run lint`, `npm run build`

## Work
1. Run unit tests for website extraction + slot selection.
2. Run `npm test`, `npm run lint`, `npm run build`.
3. If Prisma schema changed, run `npm run db:push`.
4. Document results in phase summary + review.

## Output
- Validation evidence recorded: `npm test` passed; `npm run lint` completed with existing warnings; `npm run build` succeeded; `npm run db:push` succeeded.

## Handoff
Run `phase-review` for Phase 106 and capture evidence/remaining warnings.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Executed full test, lint, build, and Prisma db push validations.
  - Re-ran test/lint/build after confirmation + prompt updates.
  - Re-ran test/lint/build after “more info” prompt updates.
- Commands run:
  - `npm test` — pass (152 tests, 0 failures).
  - `npm run lint` — pass with warnings (existing hook/img warnings; no errors).
  - `npm run build` — pass (Next.js build succeeded; baseline-browser-mapping + CSS warnings).
  - `npm run db:push` — pass (schema synced).
  - `npm test` (rerun) — pass.
  - `npm run lint` (rerun) — pass with warnings (unchanged).
  - `npm run build` (rerun) — pass.
  - `npm test` (more-info rerun) — pass (152 tests, 0 failures).
  - `npm run lint` (more-info rerun) — pass with warnings (baseline-browser-mapping + existing hook/img warnings).
  - `npm run build` (more-info rerun) — pass (baseline-browser-mapping + CSS warnings + middleware deprecation).
- Blockers:
  - None (validation completed; warnings recorded).
- Next concrete steps:
  - Run Phase 106 review and capture warning list + any follow-up actions.
