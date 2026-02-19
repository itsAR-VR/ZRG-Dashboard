# Phase 172h — WorkspaceSettings Tier Migration + Quota Source Cutover

## Focus
Move workspace tier/quota source-of-truth from env allowlist to Prisma-backed `WorkspaceSettings.highQuotaEnabled`, while preserving existing scheduler safety and rollout controls.

## Inputs
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-172/plan.md`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/fair-scheduler.ts`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/prisma/schema.prisma`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/actions/settings-actions.ts`

## Work
1. Add `WorkspaceSettings.highQuotaEnabled` boolean in Prisma with cutover-safe defaults and apply schema sync.
   - existing workspace backfill: set `highQuotaEnabled=true` for all existing workspaces
   - new workspace default: `highQuotaEnabled=false` (baseline quota `64`)
verify: `npm run db:push` succeeds, existing rows are backfilled as intended, and Prisma client reads/writes the new field.

2. Replace env-based enterprise workspace identification in scheduler quota resolution with DB-backed tier source.
verify: runner resolves quota eligibility from `WorkspaceSettings.highQuotaEnabled`; env allowlist remains temporary one-release fallback and is removed on first stable post-canary release.

3. Keep quota baseline at `64` global default and preserve `100` only for promoted tiers under gate policy.
verify: no path defaults to `32`; promotion/demotion logic still enforces numeric guardrails.

4. Add/adjust unit tests for tier resolution + runner behavior under DB-backed tier source.
verify: tests cover tier flag true/false branches and remain green under existing dispatch/dedupe constraints.

5. Update env/docs references to reflect DB-first tier policy.
verify: README + `.env.example` mark env allowlist as deprecated fallback only and define removal on the first stable production release after canary passes with no rollback.

## Validation (RED TEAM)
- `npm run db:push` with updated schema — pass and verify column exists on `WorkspaceSettings`.
- SQL/Prisma verification query — confirms existing-workspace backfill and new default behavior.
- `npm run lint` + targeted scheduler tests — pass with `highQuotaEnabled` read path.
- README/`.env.example` diff check — env allowlist documented as deprecated fallback, not source-of-truth.

## Output
- Added Prisma schema field `WorkspaceSettings.highQuotaEnabled` with default `false` for new workspaces (`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/prisma/schema.prisma`).
- Cut over runner quota eligibility source to DB-first (`WorkspaceSettings.highQuotaEnabled`) with one-release deprecated env fallback via `BACKGROUND_JOB_ENTERPRISE_CLIENT_IDS` (`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/fair-scheduler.ts`).
- Locked tier semantics in runtime: `highQuotaEnabled=true` grants eligibility only; promotion to high quota remains gated in later subphase (`172d`) and is not immediate.
- Updated scheduler unit coverage for new quota helpers and fallback semantics (`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/__tests__/background-job-fair-scheduler.test.ts`).
- Updated operator docs/env guidance for DB-first tier source and deprecation window (`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/README.md`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/.env.example`).
- Coordination note: shared-file overlap with active phase-171 persisted on `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`; changes were additive and preserved existing stale-run, claim, and dedupe flows.

## Handoff
Resume `172c`/`172d` autoscale and escalation implementation with DB-backed tier semantics locked.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Locked tier-source migration wording to `WorkspaceSettings.highQuotaEnabled`.
  - Added explicit backfill/new-default policy to enforce new-workspace baseline quota `64`.
  - Added deprecation expectation for env allowlist after cutover validation.
- Commands run:
  - `rg -n "highQuotaEnabled|globalTarget|workspaceQuotaDefault" docs/planning/phase-172` — pass (consistency sweep completed after targeted updates).
- Blockers:
  - None for this planning slice.
- Next concrete steps:
  - Execute schema + runtime cutover implementation for `highQuotaEnabled`.
  - Run db push + targeted tests, then finalize env fallback removal timing.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented schema + runtime quota-tier cutover from env allowlist to `WorkspaceSettings.highQuotaEnabled`.
  - Applied user-locked migration semantics: backfill all existing workspaces to `highQuotaEnabled=true`, new workspaces default `false`.
  - Kept `BACKGROUND_JOB_ENTERPRISE_CLIENT_IDS` as explicit one-release deprecated fallback in runtime/docs.
  - Locked runtime behavior so `highQuotaEnabled` is eligibility-only (no immediate jump to quota `100`).
- Commands run:
  - `npm run db:push` — pass (schema synced to Supabase Postgres).
  - `node --import tsx --test lib/__tests__/background-job-fair-scheduler.test.ts` — pass (`3/3` tests).
  - `node --import tsx --test lib/__tests__/background-dispatch.test.ts lib/__tests__/background-jobs-cron-no-advisory-lock.test.ts` — pass (`4/4` tests).
  - `npx eslint lib/background-jobs/fair-scheduler.ts lib/background-jobs/runner.ts lib/__tests__/background-job-fair-scheduler.test.ts` — pass.
- Blockers:
  - None for `172h` implementation slice.
- Coordination notes:
  - Multi-agent overlap remains on `lib/background-jobs/*` and `lib/inngest/*`; this turn touched only `runner.ts` in shared runtime scope and retained existing behavior outside quota-tier resolution.
- Next concrete steps:
  - Start `172c` autoscale control-loop implementation with conservative ramp contract (`+64/5m`, step-down `50%` on guardrail breach).
  - Add reason-code decision logging + operator override controls for canary-safe rollout.
