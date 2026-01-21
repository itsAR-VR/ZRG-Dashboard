# Phase 48h — Test Harness + Coverage Gating (Repo-Aligned)

## Focus

Make the Phase 48 “>90% coverage” requirement executable by aligning the test harness and scripts with repo reality (no existing `npm run test` / coverage scripts today), and fix any repo-mismatched assumptions in the test plan (e.g. `CampaignResponseMode` values).

## Inputs

- Root phase plan: `docs/planning/phase-48/plan.md` (Open Questions + constraints)
- Subphase c test plan (immutable, but contains mismatches to correct during implementation): `docs/planning/phase-48/c/plan.md`
- Repo scripts and tooling: `package.json` (currently has `lint`, `build`, `typecheck`, and `tsx` but no tests)
- Prisma enum reality: `prisma/schema.prisma` → `CampaignResponseMode = SETTER_MANAGED | AI_AUTO_SEND`

## Work

### 1. Test harness strategy (Decision: Vitest dev-only)

- Add dev dependencies:
  - `vitest`
  - `@vitest/coverage-v8`
- Add `package.json` scripts:
  - `test`: `vitest run`
  - `test:coverage`: `vitest run --coverage`
- Add `vitest.config.ts`:
  - `test.environment = "node"`
  - `resolve.alias` for `@` → repo root (so `@/lib/...` imports work)
  - Coverage provider `v8`, reporter `text` + `lcov`
  - Enforce `lines >= 90` (and optionally set the same threshold for `statements`/`functions` for simplicity)
  - Limit coverage scope to orchestrator module(s) (so the gating matches Phase 48 intent)

### 2. Fix repo-mismatched assumptions in tests (without rewriting subphase c docs)

- During implementation of the test file(s), replace any use of `"DRAFT_ONLY"` with `"SETTER_MANAGED"` for “campaign exists but not AI mode” cases.
- Ensure the tests assert **behavioral outputs** (outcomes + key Slack block fields), not internal implementation details.

### 3. Enforce the >90% coverage requirement

- Define what “coverage” means for this phase:
  - Scope: `lib/auto-send/orchestrator.ts` (and any helper(s) in `lib/auto-send/`)
  - Threshold: >90% line coverage (as stated in phase constraints)
- Add an explicit validation step:
  - `npm run test:coverage` must fail if below the threshold.

### 4. Validation (RED TEAM)

- `npm run lint`
- `npm run build`
- `npm run test`
- `npm run test:coverage` (verify it reports line coverage and enforces the threshold)

## Output

- A runnable test harness is present (`npm run test`, `npm run test:coverage`)
- Coverage gating is enforced for the orchestrator scope
- Any repo-mismatched test assumptions are corrected (notably `CampaignResponseMode` values)

## Handoff

With the test harness wired and coverage enforced, Phase 48 can be completed with a credible “ready to ship” signal (lint + build + unit tests + manual smoke tests).
