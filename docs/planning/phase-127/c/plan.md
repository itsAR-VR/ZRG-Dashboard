# Phase 127c — Pruning + Tests + Docs

## Focus
Keep persistent run artifacts bounded via pruning, finalize tests for memory governance + observability, and document operational knobs.

## Inputs
- Phase 127a schema changes
- Phase 127b persistence + telemetry changes
- Existing cron entrypoints:
  - `app/api/cron/background-jobs/route.ts`

## Work
1. Prune `DraftPipelineRun` + `DraftPipelineArtifact`:
   - Add a bounded prune step in cron/background jobs:
     - Delete runs older than `DRAFT_PIPELINE_RUN_RETENTION_DAYS` (default 30).
     - Batch limit per invocation (e.g., 500) to stay within cron budget.
     - Artifacts cascade via `onDelete: Cascade`.
2. Prune expired inferred lead memory:
   - Delete `LeadMemoryEntry` rows where `expiresAt < now` and `source = INFERENCE`.
   - Batch per invocation; avoid hot-path coupling.
3. Prune expired inferred workspace memory:
   - Delete `WorkspaceMemoryEntry` rows where `expiresAt < now` and `source = INFERENCE`.
   - Batch per invocation; avoid hot-path coupling.
4. Final quality gates:
   - `npm test`
   - `npm run lint`
   - `npm run build`
   - `npm run db:push` (if schema changed)
5. Documentation:
   - Document env vars:
      - `DRAFT_PIPELINE_RUN_RETENTION_DAYS`
      - `AUTO_SEND_EVALUATOR_MODEL`
      - `AUTO_SEND_EVALUATOR_REASONING_EFFORT`
      - `AUTO_SEND_REVISION_MODEL`
      - `AUTO_SEND_REVISION_REASONING_EFFORT`
   - Document memory categories + approval rules + safety constraints.
   - Document UI location: Settings → Admin (Super Admin only).

## Validation (RED TEAM)
- Manual DB verification:
  - Insert (or backdate) a run older than retention and confirm it is pruned.
  - Insert an expired inferred memory row and confirm it is pruned.
- `npm run build` passes with pruning enabled.

## Output
- Pruning/retention implemented (best-effort, bounded per invocation):
  - `app/api/cron/background-jobs/route.ts`
    - `DRAFT_PIPELINE_RUN_RETENTION_DAYS` (default 30) deletes old `DraftPipelineRun` rows (artifacts cascade).
    - Deletes expired inferred `LeadMemoryEntry` + `WorkspaceMemoryEntry` rows (batched).
- Tests added and wired into `npm test`:
  - `lib/__tests__/memory-governance.test.ts` (policy + redaction + TTL cap)
  - `lib/__tests__/draft-pipeline-retention-cron.test.ts` (static guard: retention hooks present)
  - `lib/auto-send/__tests__/orchestrator.test.ts` (loop stopReason persistence checks)
  - `scripts/test-orchestrator.ts` (includes the new tests)
- Docs updated:
  - `README.md` (documents: `AUTO_SEND_EVALUATOR_*`, `AUTO_SEND_REVISION_*`, `AUTO_SEND_REVISION_LOOP_TIMEOUT_MS`, `DRAFT_PIPELINE_RUN_RETENTION_DAYS`)
- One-time rollout backfill:
  - `scripts/backfill-memory-allowlist-defaults.ts` (sets default allowlist for workspaces with empty allowlist)

## Handoff
Phase 127 is ready for review/merge:
- Create `docs/planning/phase-127/review.md` with the quality-gate evidence and final checklist.
- Optional follow-up phase:
  - workspace-admin (non-super-admin) visibility into memory policy or loop metrics
  - drill-down UI from loop summary → artifact JSON (read-only)
  - decision on whether to surface PENDING memory entries outside of Super Admin

## Progress This Turn (Terminus Maximus)
- Work done:
  - Wired the pruning/retention test into the test orchestrator.
  - Updated README env var docs for the new knobs.
  - Ran full quality gates for this phase.
- Commands run:
  - `npm test` — pass
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Blockers:
  - None
- Next concrete steps:
  - Write `docs/planning/phase-127/review.md` and mark Phase 127 success criteria complete.
