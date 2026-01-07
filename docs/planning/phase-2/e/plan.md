# Phase 2e — Fix: `revalidatePath` correctness + regression verification

## Focus
Eliminate `revalidatePath` runtime errors by ensuring cache invalidation happens only from supported contexts, and verify all four fixes together via lint/build and targeted manual checks.

## Inputs
- Refactors from Phase 2d that separate core sync logic from UI wrappers
- Relevant code:
  - `actions/message-actions.ts` (current `revalidatePath("/")` call sites)
  - `actions/email-actions.ts` (calls `syncEmailConversationHistory()` fire-and-forget)
  - Any UI entry points that trigger “sync” operations (e.g., inbox tools)

## Work
- Remove/relocate `revalidatePath("/")` from functions that can run:
  - during render, or
  - as background jobs (fire-and-forget)
- Ensure UI state freshness via one of:
  - Caller-owned `revalidatePath` in user-initiated server actions, or
  - `router.refresh()` in client flows where appropriate
- Add verification steps:
  - `npm run lint`
  - `npm run build`
  - Targeted manual checks:
    - Trigger a sync and confirm no `revalidatePath` runtime error.
    - Trigger webhook processing and confirm background sync runs without auth errors.
    - Trigger cron follow-ups and confirm DND is skipped (not failed).
    - Verify availability refresh logs show skipped/unconfigured rather than repeated errors.

## Output
- `revalidatePath("/")` no longer runs from background sync:
  - Background email send now invokes `syncEmailConversationHistorySystem()` (no `revalidatePath`, no auth cookies required).
  - Core sync logic lives in `lib/conversation-sync.ts` and does not perform cache invalidation.
- Local verification complete:
  - `npm run lint` (warnings only; no errors)
  - `npm run build` (success)
- Remaining verification is production-log based:
  - After deploy, confirm Vercel logs no longer contain:
    - `Route / used "revalidatePath /" during render`
    - `[Sync] Failed to sync conversation history: Error: Not authenticated`
    - `Cannot send message as DND is active for SMS.` (should be skipped/advanced instead)
    - `No default calendar link configured` (should be counted as `skippedNoDefault`, not in `errors`)

## Handoff
Proceed to Phase wrap-up:
- Update `docs/planning/phase-2/plan.md` to check off Success Criteria and append a short Phase Summary.
- No Prisma schema changes were required for this phase (no `db:push` needed).
