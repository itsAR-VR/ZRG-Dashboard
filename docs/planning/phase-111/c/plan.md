# Phase 111c — Harden Stale-Recovery Concurrency

## Focus
Fix `recoverStaleSendingDrafts` to count recovered drafts based on actual DB update results rather than unconditionally incrementing, preventing inflated metrics when concurrent cron invocations race on the same stale drafts.

## Inputs
- `lib/ai-drafts/stale-sending-recovery.ts` — `recoverStaleSendingDrafts()` function (lines 11-62)
  - Current pattern: `findMany` stale drafts → loop → `updateMany` per draft → unconditional `result.recovered++`
  - The `updateMany` with `where: { status: "sending" }` is already atomic (safe for data), but the counter inflates when two invocations recover the same draft
- Called from `app/api/cron/background-jobs/route.ts:83` unconditionally after `processBackgroundJobs()`

## Work

### 1. Count recovered based on update result (line 50-55)
```diff
-     await prisma.aIDraft.updateMany({
+     const updated = await prisma.aIDraft.updateMany({
        where: { id: draft.id, status: "sending" },
        data: { status: "approved", responseDisposition },
      });

-     result.recovered++;
+     if (updated.count > 0) result.recovered++;
```

This is the minimal change. If `updated.count === 0`, another cron invocation already recovered this draft — skip silently.

### Validation
- `node --import tsx --test lib/__tests__/stale-sending-recovery.test.ts` passes
- The function signature and return type are unchanged
- The cron route integration (`app/api/cron/background-jobs/route.ts:83`) requires no changes

## Output
- `recoverStaleSendingDrafts` reports accurate recovered count even under concurrent invocations
- No structural changes; minimal diff

## Handoff
Proceed to Phase 111d to update regression tests and run full validation.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Updated `recoverStaleSendingDrafts()` to increment `recovered` only when `updateMany()` actually updates a row (`updated.count > 0`).
- Commands run:
  - `node --import tsx --test lib/__tests__/stale-sending-recovery.test.ts` — pass
- Blockers:
  - None
- Next concrete steps:
  - Execute Phase 111d (flip regression assertions + run lint/build/tests).
