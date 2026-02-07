# Phase 116 — Review

## Summary
- Shipped DB-backed auto-send revision tracking + retry-safe idempotency (at-most-once per `AIDraft.id`).
- Added per-workspace rollout toggle (true super-admin server action) + global env kill-switch visibility.
- Added admin snapshot visibility (kill-switch + attempted/applied counts over last 72h).
- Verified locally: `typecheck`, `test`, `lint`, `build` pass; schema synced via `db:push`.
- Remaining: run production canary (Phase 116e) and confirm metrics populate / no elevated errors.

## What Shipped
- Schema:
  - `prisma/schema.prisma` (new `AIDraft.autoSendRevision*` fields + `WorkspaceSettings.autoSendRevisionEnabled` + index)
- Runtime:
  - `lib/auto-send/revision-agent.ts` (DB claim + persistence)
  - `lib/auto-send/orchestrator.ts` (per-workspace gating before revision attempt)
  - `lib/auto-send/types.ts` (context type for `autoSendRevisionEnabled`)
  - `lib/inbound-post-process/pipeline.ts` (context propagation)
  - `lib/background-jobs/email-inbound-post-process.ts` (context propagation)
- Rollout control plane:
  - `actions/auto-send-revision-rollout-actions.ts` (true-super-admin toggle)
  - `components/dashboard/confidence-control-plane.tsx` (toggle UI + kill-switch note)
- Observability:
  - `actions/admin-dashboard-actions.ts` (kill-switch + attempted/applied counts)
  - `components/dashboard/admin-dashboard-tab.tsx` (render metrics)
- Tests:
  - `lib/__tests__/auto-send-revision-agent.test.ts`
  - `lib/auto-send/__tests__/orchestrator.test.ts`

## Verification

### Commands
- `npm run typecheck` — pass (2026-02-07 05:28 EST)
- `npm test` — pass (2026-02-07 05:28 EST)
- `npm run lint` — pass (warnings only, pre-existing) (2026-02-07 05:28 EST)
- `npm run build` — pass (2026-02-07 05:28 EST)
- `npm run db:push` — pass (2026-02-07 05:28 EST)

### Notes
- `next build` emitted known warnings (CSS optimization tokens, baseline-browser-mapping data staleness, middleware deprecation) but completed successfully.

## Success Criteria → Evidence

1. `AIDraft` has durable revision tracking fields and they are present in the database.
   - Evidence: `prisma/schema.prisma`, `npm run db:push`
   - Status: met

2. A single `AIDraft.id` cannot run the revision pipeline more than once (even across job retries).
   - Evidence: DB-backed claim in `lib/auto-send/revision-agent.ts` (`autoSendRevisionAttemptedAt` write guarded by `updateMany(... attemptedAt: null)`), unit test `lib/__tests__/auto-send-revision-agent.test.ts`
   - Status: met

3. `AIDraft.autoSendConfidence` remains the confidence that actually drove the send/review decision; new fields store pre-revision and revision-attempt values.
   - Evidence: orchestrator continues to use evaluator output and stores separate revision fields; no change to `autoSendConfidence` semantics in `lib/auto-send/orchestrator.ts`
   - Status: met

4. Unit tests cover idempotent gating + persistence semantics.
   - Evidence: `lib/__tests__/auto-send-revision-agent.test.ts`, `lib/auto-send/__tests__/orchestrator.test.ts`, `npm test`
   - Status: met

5. `npm test`, `npm run lint`, `npm run build` pass.
   - Evidence: commands above
   - Status: met

6. Launch runbook exercised in canary: enable revision for one workspace without deploy; no elevated errors/timeouts; operator visibility works.
   - Evidence: Phase 116e runbook exists (`docs/planning/phase-116/e/plan.md`)
   - Status: partial (manual production execution pending)

## Plan Adherence
- Planned vs implemented deltas:
  - UI gating still uses global-admin status in `components/dashboard/confidence-control-plane.tsx`, while the rollout server action enforces true-super-admin. Net effect: secure-by-default, but some global admins may see a toggle that errors on write if they aren’t true-super-admins.

## Risks / Rollback
- Risk: revision adds latency/cost or causes unexpected sends.
  - Mitigation: per-workspace toggle defaults to OFF; global kill-switch `AUTO_SEND_REVISION_DISABLED=1`; existing `AUTO_SEND_DISABLED=1` remains.
- Risk: fail-closed at-most-once claim means a failed attempt won’t retry.
  - Mitigation: safe fallback is human review; if retry is desired later, add a cooldown-based retry counter in a follow-up phase.

## Follow-ups
- Execute Phase 116e canary in production and confirm Admin Dashboard attempted/applied metrics populate and error rates/timeouts are stable.
- Optional hardening: add a dedicated `getTrueSuperAdminStatus()` action and gate Confidence Control Plane UI by true-super-admin, not just global admin.

