# Phase 2 — Production Error Hardening (Cron + Webhooks + Sync)

## Purpose
Eliminate the four recurring production error types observed in `ZRG Dashboard Logs (11).json` (2026-01-06 UTC), and harden cron/webhook/sync paths so they degrade gracefully without retry-spam or Next.js runtime errors.

## Context
- Cron `/api/cron/followups` sometimes fails to send SMS due to GHL returning `400` with `Cannot send message as DND is active for SMS.` This currently counts as a failed follow-up step and retries indefinitely.
- Availability refresh reports many `No default calendar link configured` errors. These are expected for unconfigured workspaces but are currently logged repeatedly, creating noise and masking real availability failures.
- The GHL SMS webhook `/api/webhooks/ghl/sms` triggers `syncConversationHistory()` as a background job, but that server action requires a Supabase-authenticated user and logs `Error: Not authenticated` in webhook context.
- Email conversation sync sometimes logs `Route / used "revalidatePath /" during render which is unsupported`, indicating `revalidatePath("/")` is being called from an invalid execution context (render/cached function/background job).

## Objectives
* [x] Map each log signature to the exact code path(s) and define desired behavior (retryable vs permanent)
* [x] Treat GHL SMS DND failures as non-retriable and stop cron retry loops (while preserving multi-channel sequences)
* [x] Reduce availability refresh noise for “missing calendar config” and improve operator visibility/config flows
* [x] Remove user-auth assumptions from webhook/cron-invoked sync paths (and avoid UI revalidation in background jobs)
* [x] Fix `revalidatePath` usage so it is only executed from supported contexts

## Constraints
- Webhooks are untrusted input: validate/sanitize fields and avoid privilege escalation.
- Cron/admin endpoints must validate secrets before reading request bodies (follow existing patterns in `app/api/cron/*` and `app/api/admin/*`).
- Avoid calling Server Actions that require `requireAuthUser()` from webhook/cron execution contexts.
- Next.js cache invalidation: `revalidatePath` must happen outside renders/cached functions.
- Never commit secrets/tokens; if Prisma schema changes, run `npm run db:push` against the correct database before considering work complete.

## Success Criteria
- [ ] No new occurrences of the following log signatures after deploy (requires post-deploy verification in Vercel logs):
  - `Cannot send message as DND is active for SMS.`
  - `No default calendar link configured` (should be counted as `skippedNoDefault`, not repeated in `errors`)
  - `[Sync] Failed to sync conversation history: Error: Not authenticated`
  - `Route / used "revalidatePath /" during render`
- [x] Cron follow-up runs complete with accurate counts (`succeeded/failed/skipped`) and do not retry non-retriable SMS failures (implemented; verify in logs after deploy).
- [x] Webhook/background sync runs without requiring an end-user session and does not attempt UI cache revalidation (implemented; verify in logs after deploy).

## Subphase Index
* a — Triage: map logs → code paths + desired behavior
* b — Fix: SMS DND non-retriable handling in follow-ups
* c — Fix: availability refresh noise + missing calendar config ergonomics
* d — Fix: webhook/cron-safe sync (no `requireAuthUser`, no UI revalidate)
* e — Fix: `revalidatePath` correctness + regression verification

## Phase Summary
- DND is now treated as non-retriable in follow-up sequences: `lib/followup-engine.ts` advances past SMS steps when `sms_dnd` is detected and records a `FollowUpTask(status="skipped")`.
- GHL error handling now surfaces structured DND classification: `lib/ghl-api.ts` parses error payloads and sets `errorCode: "sms_dnd"` when applicable.
- Availability refresh is quieter and more actionable: `lib/availability-cache.ts` reports `skippedNoDefault`/`skippedUnsupportedDuration` and backs off unconfigured workspaces to avoid repeated cron noise.
- Sync is now safe for automation/background contexts: `lib/conversation-sync.ts` provides system-safe SMS/email sync helpers, and `actions/email-actions.ts` uses the system helper for fire-and-forget sync after sending.
- Local verification: `npm run lint` (warnings only) and `npm run build` succeeded; remaining work is post-deploy verification in Vercel logs for the four original signatures.
