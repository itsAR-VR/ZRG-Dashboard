# Phase 17 — SMS Sync Reliability + Inbox “New” Badge Fix

## Purpose
Make inbound SMS replies from GoHighLevel show up in ZRG Dashboard reliably (minutes, not days), and fix the Inbox “X new” refresh badge so it only reflects relevant workspace activity.

## Context
- Jam `681b2765-7977-4faf-9d20-33732951a3e6` showed the Inbox “new” badge inflating and then collapsing after clicking; the client was subscribing to global `Message`/`Lead` changes with no workspace filter.
- Vercel logs showed `POST /` server-action requests timing out at **300s** (504), consistent with bulk/slow actions (e.g., “Sync All”) doing too much work in one invocation.
- For “Owen”, Supabase data shows no SMS messages in our DB after **2025-12-13**, despite activity in GHL per report — indicating an ingestion/sync gap that needs better reliability and diagnostics.

## Objectives
* [x] Fix Inbox “new” badge to be workspace-scoped and low-noise
* [x] Improve SMS sync freshness (avoid relying on stale export results)
* [x] Prevent bulk sync from hitting Vercel 300s timeouts (chunk/resume)
* [x] Investigate Owen workspace sync gap with concrete evidence + next steps
* [x] Reduce noise from secondary issues (EmailBison sender ID, calendar link errors)

## Constraints
- Never log secrets (GHL keys, EmailBison API keys) or leak message bodies via client realtime subscriptions.
- Vercel serverless runtime is **300 seconds**; long-running sync work must be chunked/resumable.
- Prefer minimal changes that align with existing patterns (`lib/ghl-api.ts`, `lib/conversation-sync.ts`, server actions).

## Success Criteria
- [x] Inbox “X new” badge reflects only the currently selected workspace and is stable.
- [x] “Sync All” no longer attempts to do unbounded work in a single request (cursor + time budget).
- [ ] “Sync conversation” pulls latest SMS replies quickly even when export lags (improved logic; needs deploy verification).
- [x] Owen: root cause narrowed with DB evidence; remaining confirmation requires webhook log coverage / GHL credential validation.

## Subphase Index
* a — Fix Inbox “new” badge (Realtime scoping)
* b — Harden GHL SMS sync (timeouts + fallback paths)
* c — Eliminate 300s timeouts (bulk sync redesign)
* d — Owen workspace deep-dive + diagnostics
* e — Secondary issues triage (EmailBison, calendars, enrichment)

## Phase Summary
- Realtime “new” badge is now workspace-scoped and derived from `Lead.lastMessageAt/lastMessageDirection` (no client-side `Message` subscription): `lib/supabase.ts`, `components/dashboard/inbox-view.tsx`, `components/dashboard/crm-view.tsx`.
- SMS sync now prefers GHL conversation messages (typically fresher) and uses export as fallback; GHL fetches are bounded with timeouts: `lib/ghl-api.ts`, `lib/conversation-sync.ts`, `app/api/webhooks/ghl/sms/route.ts`.
- Bulk “Sync All” is now chunked (cursor + 60s client chunk / 90s server default) and no longer bundles heavy side-effects: `actions/message-actions.ts`, `components/dashboard/inbox-view.tsx`.
- Owen workspace evidence: 42 leads, 88 total SMS messages, latest SMS in DB at `2025-12-13` (none last 30 days). Remaining work is confirming webhook coverage and/or GHL API validity, then running chunked “Sync All” post-deploy.
