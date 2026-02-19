# Kurt Incident Analysis — 2026-02-19

## Lead / Message Context
- Primary lead email: `kurt@restorationchurchsd.com`
- Inbound reply email sender captured: `kurtduggleby@gmail.com`
- Inbound message id: `26b23e8e-e74c-44b2-bd6f-e659cd6cb403`
- Inbound received at: `2026-02-18 23:11:13 UTC`

## What Happened (timeline)
- `EMAIL_INBOUND_POST_PROCESS`
  - created: `2026-02-18 23:11:16`
  - runAt: `2026-02-18 23:11:35`
  - started: `2026-02-19 01:37:06`
  - delay to start: ~`2h 25m`
- `CONVERSATION_SYNC`
  - created/runAt: `2026-02-18 23:32:32`
  - started: `2026-02-19 01:53:47`
  - delay to start: ~`2h 21m`
- `LEAD_SCORING_POST_PROCESS`
  - created/runAt: `2026-02-19 01:37:19`
  - started: `2026-02-19 02:45:12`
  - delay to start: ~`1h 08m`
- During email post-process, a scheduling follow-up task was created:
  - `FollowUpTask.id`: `fb1c47e4-7c80-4a0f-975c-545c8c8ec790`
  - created/due: `2026-02-19 01:37:14`
  - status: `pending`
  - suggestedMessage: `Before we schedule, can you confirm the key booking detail you want us to use?`

## Why AI Draft + Slack Review Did Not Appear
1. Queue liveness degradation delayed job execution for hours.
2. When the delayed job finally ran, booking-route logic created a follow-up task and intentionally skipped AI draft generation.
3. This skip path had no explicit Slack visibility event, so it looked like a silent failure.

## Fixes Applied
1. Stale-run watchdog + inline recovery in cron path (clears stale `process-background-jobs` runs).
2. Bounded parallel queue drain (`batchSize=20`, worker concurrency default `4`).
3. Queue health telemetry and operator query/runbook artifacts.
4. New draft-skip Slack visibility guard in `email-inbound-post-process`:
   - if scheduling flow or call-without-phone suppresses draft generation and no action-signal alert exists, emit deduped Slack ops notification.

## Current State
- Stale function-run cluster was recovered live (`recovered=11`), and post-recovery stale count is now zero.
- Dispatch remains healthy (`ENQUEUED=60`, `ENQUEUE_FAILED=0`, `INLINE_EMERGENCY=0` over last 60 minutes).
