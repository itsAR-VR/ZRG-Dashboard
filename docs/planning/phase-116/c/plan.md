# Phase 116c — Revision Agent: Idempotency + Persistence + Tests

## Focus
Make revision attempts retry-safe and durable by claiming a one-time attempt in DB, persisting revision telemetry fields, and expanding unit tests to cover the new semantics.

## Inputs
- `lib/auto-send/revision-agent.ts`
- `lib/auto-send/orchestrator.ts` (calls `maybeReviseAutoSendDraft`)
- `prisma/schema.prisma` (new `AIDraft` fields from Phase 116b)
- Tests:
  - `lib/__tests__/auto-send-revision-agent.test.ts`
  - `lib/auto-send/__tests__/orchestrator.test.ts`

## Work
1. Fix correctness bug in revise prompt schema
   - In `lib/auto-send/revision-agent.ts`, remove duplicated `confidence` property in the `schema.properties` object (it currently appears twice).

2. Add per-workspace gating (no revision unless enabled)
   - Update `lib/auto-send/types.ts`:
     - Extend `AutoSendContext.workspaceSettings` with `autoSendRevisionEnabled?: boolean | null`.
   - Ensure all context builders that populate `workspaceSettings` include this field:
     - `lib/inbound-post-process/pipeline.ts`
       - add `autoSendRevisionEnabled: true` to the `lead.client.settings.select` include inside the message load query.
     - `lib/background-jobs/email-inbound-post-process.ts`
       - add `autoSendRevisionEnabled: true` to the `client.settings.select` in the initial `prisma.client.findUnique(...)` query.
     - `lib/background-jobs/sms-inbound-post-process.ts`
       - already loads `client.settings: true` so the new field will be present after schema update (no select changes required).
   - Update `lib/auto-send/orchestrator.ts`:
     - Add a gating condition before calling `maybeReviseAutoSendDraft(...)`:
       - `Boolean(context.workspaceSettings?.autoSendRevisionEnabled)`
     - Keep the env kill-switch in the revision agent as the emergency brake.

3. Add idempotent attempt claim in `maybeReviseAutoSendDraft()`
   - After kill-switch + hard-block + `originalConfidence < threshold` checks, atomically claim one-time attempt:
     - `updateMany` where:
       - `id = draftId`
       - `status = "pending"` (safety)
       - `autoSendRevisionAttemptedAt IS NULL`
     - set:
       - `autoSendRevisionAttemptedAt = now`
       - `autoSendOriginalConfidence = originalConfidence`
       - `autoSendRevisionApplied = false`
   - If `count === 0`, return early (no revision attempt).
   - If the claim write throws (DB error), **fail closed**: return early and do not attempt selector/reviser calls.

4. Persist selection/revision results (stats-only)
   - After selector best-effort completes:
     - update `autoSendRevisionSelectorUsed = selectorUsed` (best-effort).
   - After re-eval completes:
     - update `autoSendRevisionConfidence = revisedConfidence` (even if not applied).
   - If improved AND DB content update succeeds:
     - update `content = revisedDraft`
     - set `autoSendRevisionApplied = true`
     - ensure `autoSendRevisionConfidence` and `autoSendRevisionSelectorUsed` are set consistently.
   - Guardrail: failures to write these tracking fields must not throw and must not break the baseline auto-send decision flow (fail closed to "no revision").

5. Tests (must be deterministic)
   - `lib/__tests__/auto-send-revision-agent.test.ts`
     - New: skips when attempt already claimed (`autoSendRevisionAttemptedAt` non-null → claim updateMany count=0).
     - New: writes `attemptedAt` + `originalConfidence` on first attempt (assert update args).
     - New: writes `autoSendRevisionConfidence` after re-eval even when not improved.
   - `lib/auto-send/__tests__/orchestrator.test.ts`
     - Keep Phase 115 tests; ensure no new breakage from persistence changes.
     - Add: revision is not attempted when `workspaceSettings.autoSendRevisionEnabled=false` (even if below threshold).

6. Quality gates
   - `npm test`
   - `npm run lint`
   - `npm run build`
   - `npm run typecheck`

## Output
- Revision is at-most-once per draft across retries.
- Revision tracking fields are consistently persisted.
- Test suite proves idempotency + persistence.

## Handoff
- Phase 116d builds operator visibility on top of DB fields (and adds env kill-switch visibility for revision).

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented retry-safe, at-most-once revision attempts via DB-backed claim (`autoSendRevisionAttemptedAt`) and persisted revision tracking fields. (files: `lib/auto-send/revision-agent.ts`)
  - Added per-workspace gating for revision attempts and ensured context loaders include the new toggle. (files: `lib/auto-send/orchestrator.ts`, `lib/auto-send/types.ts`, `lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/email-inbound-post-process.ts`)
  - Expanded unit tests for idempotency + persistence semantics. (files: `lib/__tests__/auto-send-revision-agent.test.ts`, `lib/auto-send/__tests__/orchestrator.test.ts`)
- Commands run:
  - `npm test` — pass
  - `npm run typecheck` — pass
  - `npm run lint` — pass (warnings only, pre-existing)
  - `npm run build` — pass
- Blockers:
  - None
- Next concrete steps:
  - Add super-admin rollout toggle + admin snapshot visibility for revision attempts/applied (Phase 116d).
