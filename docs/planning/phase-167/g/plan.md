# Phase 167g — Surgical Multi-Path Patch Plan (Webhook + Inbox + Response-Timing)

## Focus
Apply minimal, path-specific changes that reduce timeout failures without changing unrelated behavior.

## Inputs
- Phase 167f timeout contract + patch list
- Current code state in overlapping files:
  - `app/api/webhooks/email/route.ts`
  - `actions/lead-actions.ts`
  - `app/api/inbox/conversations/route.ts`
  - `app/api/inbox/counts/route.ts`
  - `app/api/cron/response-timing/route.ts`
  - `lib/response-timing/processor.ts`
- Coordination context from overlapping phases (`161`, `164`, `165`, `166`).

## Work
1. Re-read each target file immediately before edits to merge with concurrent working-tree changes.
2. Implement webhook path hardening:
   - reduce synchronous work on critical path where possible,
   - ensure long-latency tasks are queued/deferred when safe,
   - preserve webhook dedupe and auth semantics.
3. Implement inbox path hardening:
   - keep existing auth/flag behavior unchanged,
   - reduce query/runtime timeout exposure in heavy search/list paths,
   - preserve existing pagination/result contracts.
4. Implement response-timing hardening:
   - align transaction timeout envelope with expected work budget,
   - reduce per-transaction work/batch pressure if needed,
   - preserve correctness of `inserted/updatedSetter/updatedAi` outputs.
5. Keep Inngest changes limited to verified timeout controls only if evidence requires it.
6. Add/adjust targeted regression tests when logic changes.

## Validation (RED TEAM)
- `npx eslint` on changed files passes.
- Any new/updated tests for touched timeout logic pass.
- For each changed path, document the exact timeout control before and after.
- Confirm no auth/secret/idempotency regressions on cron/webhook routes.

## Output
Surgical patch set applied with explicit before/after behavior:

1. `app/api/webhooks/email/route.ts`
   - Before: `maxDuration = 60`
   - After: `maxDuration = 800`

2. `app/api/cron/availability/route.ts`
   - Before: `maxDuration = 60`, route-side configured budget clamp max `55_000ms`
   - After: `maxDuration = 800`, configured clamp max `10 * 60_000ms` (default unchanged at `55_000ms`)

3. `app/api/cron/emailbison/availability-slot/route.ts`
   - Before: `maxDuration = 60`
   - After: `maxDuration = 800`

4. `app/api/inbox/conversations/route.ts`
   - Before: no explicit route `maxDuration`
   - After: explicit `maxDuration = 800`

5. `app/api/inbox/counts/route.ts`
   - Before: no explicit route `maxDuration`
   - After: explicit `maxDuration = 800`

6. `actions/lead-actions.ts`
   - Before: interactive transaction used default Prisma timeout envelope (5s) despite larger statement timeout.
   - After: explicit transaction options (`timeout/maxWait`) aligned to statement budget in `findLeadsWithStatementTimeout`.

7. `lib/response-timing/processor.ts`
   - Before: interactive transaction default timeout could expire before route-level max.
   - After: explicit transaction options (`timeout/maxWait`) added for processor transaction scope.

## Handoff
Pass changed files and validation checklist to Phase 167h for NTTAN + rollout evidence collection.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Re-read overlapping timeout files and merged targeted edits only.
  - Applied route-level `maxDuration` hardening on webhook/inbox/cron paths.
  - Applied DB interactive transaction timeout hardening in inbox + response-timing logic.
  - Preserved cron/webhook auth checks and queue/idempotency behavior.
- Commands run:
  - `apply_patch` on 7 files — pass.
  - `git diff -- <touched files>` — pass (scoped timeout changes only).
  - `npx eslint app/api/inbox/counts/route.ts app/api/inbox/conversations/route.ts app/api/webhooks/email/route.ts app/api/cron/availability/route.ts app/api/cron/emailbison/availability-slot/route.ts actions/lead-actions.ts lib/response-timing/processor.ts` — pass.
- Blockers:
  - None for implementation.
- Next concrete steps:
  - Run full validation + replay diagnostics and collect Vercel evidence (Phase 167h).
