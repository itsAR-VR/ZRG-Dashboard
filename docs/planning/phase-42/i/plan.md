# Phase 42i — Off-Request-Path Conversation Sync (BackgroundJobs)

## Focus
Eliminate `POST /` Server Action timeouts by moving long-running SMS/Email conversation sync work off the request path and into BackgroundJobs (cron-processed), while keeping “Sync” controls available in the UI.

## Inputs
- Phase 42 review follow-up: auto-sync in `components/dashboard/inbox-view.tsx` calls `smartSyncConversation()` every 5 minutes
- BackgroundJobs cron runner: `app/api/cron/background-jobs/route.ts` → `lib/background-jobs/runner.ts`
- System sync implementation: `lib/conversation-sync.ts` (logs `[Sync] …`, `[EmailSync] …`)

## Work
- Add new BackgroundJob type for conversation sync (SMS + Email) and implement handler using system sync functions.
- Add enqueue server actions:
  - enqueue a per-lead conversation sync job (dedupe within a short window; skip if a job is already pending/running)
  - (optional) enqueue “sync all conversations” by enqueueing jobs for eligible leads
- Update InboxView:
  - replace auto-sync `smartSyncConversation()` with enqueue-only call (no await, no long request)
  - update manual “Sync” UI to enqueue instead of running sync inline
- Ensure BackgroundJob processing stays within cron budget (one lead per job; bounded retries; safe logs).
- Re-run `npm run lint` + `npm run build`.

## Output
- Moved conversation sync off request path:
  - Schema: added `BackgroundJobType.CONVERSATION_SYNC` in `prisma/schema.prisma`.
  - Background job implementation: `lib/background-jobs/conversation-sync.ts` runs SMS + Email sync for a single lead (best-effort GHL contact ID resolution; throws only for retryable/network/timeouts).
  - Runner: `lib/background-jobs/runner.ts` now executes `CONVERSATION_SYNC` jobs.
  - Enqueue action: `actions/message-actions.ts:enqueueConversationSync()` dedupes within `CONVERSATION_SYNC_DEDUPE_WINDOW_MS` (default 5m) and skips if a pending/running job already exists for the lead.
  - UI: `components/dashboard/inbox-view.tsx` now enqueues sync (auto + manual “Sync”) instead of running `smartSyncConversation()` inline, preventing 300s `POST /` timeouts.
- Validation:
  - `npm run lint` (warnings only) and `npm run build` succeeded.

## Handoff
Update Phase 42 root plan + review to mark follow-ups complete and leave a short ship checklist (deploy + verify with runbook).
