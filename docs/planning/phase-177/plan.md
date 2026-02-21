# Phase 177 — Booking Process 4/5 Routing + Notification Eligibility (FC)

## Purpose
Identify why an FC lead (leadId `370b29c7-3370-4bfc-824b-5c4b7172d72a`) did not follow the expected Booking Process 5 handling, then fix routing + notification logic so Booking Process 4/5 signals work for Interested leads (and other sentiments) without creating false “Call Requested” paths.

## Context
User-reported production issues in the Founders Club (FC) workspace:

* Lead `370b29c7-3370-4bfc-824b-5c4b7172d72a` did not get sent to Booking Process 5 handling when expected.
* Notifications for Booking Process 4/5 appear to be gated too narrowly (currently missing Interested leads and potentially other sentiments).
* Lead `29c19fe2-8142-45f5-9f3e-795de1ae13b1` was tagged with a “call requested” sentiment even though the message reads like a normal scheduling request (“open to a quick call next week”), and should have gone down the standard meeting pipeline.

Working hypothesis (to confirm in Phase 177a):
* Booking-process routing can succeed (ex: Process 5), but downstream notifications are gated on sentiment events and are missing Process 4/5-specific notifications (especially for Interested and other sentiments).
* “Soft call” language (“open to a quick call next week”) is being interpreted as callback intent rather than meeting-scheduling intent, causing Process 4 misroutes.

Phase 177a evidence (Supabase):
* Lead `370b29c7-3370-4bfc-824b-5c4b7172d72a` routed to `processId=5` with `hasExternalCalendarSignal=true`.
* Lead `29c19fe2-8142-45f5-9f3e-795de1ae13b1` routed to `processId=4` with `sentimentTag=Call Requested` and a sentiment `NotificationEvent` was created.

## Concurrent Phases
Recent planning work touches overlapping inbound processing and scheduling domains; treat as high-conflict and re-read file state immediately before edits.

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 176 | Active (untracked) | scheduling / booking related policies | Avoid mixing scheduling window changes into this phase; keep edits scoped to booking-process routing + notifications + sentiment disambiguation. |
| Phase 175 | Recent | inbound post-process wiring; follow-up logic | If Phase 177 touches inbound post-process entry points, preserve Phase 175 sequencing and safety gates. |
| Phase 174 | Recent | AI routing/extraction patterns + Slack alerting conventions | Reuse existing structured-prompt + observability patterns; do not introduce new ad-hoc logging. |

## Objectives
* [x] Confirm, via Supabase, the exact messages/AI decisions for leadId `370b29c7-3370-4bfc-824b-5c4b7172d72a` and leadId `29c19fe2-8142-45f5-9f3e-795de1ae13b1` (FC) and capture thread/message IDs for replay.
* [x] Ensure Booking Process 4/5 route outcomes emit notifications even when sentiment is Interested (or other non-call/meeting sentiments).
* [x] Verify (and only if needed) adjust booking-process routing eligibility so Interested leads and other required sentiments invoke the router.
* [x] Reduce false “Call Requested” classification for soft scheduling language (call-as-meeting), without breaking true callback-request behavior.
* [x] Add regression coverage (tests + replay manifest) and run NTTAN gates.

## Constraints
* No secrets or PII in repo docs (use IDs only; do not paste raw message bodies).
* Prefer AI-based intent disambiguation over deterministic regex/phrase matching.
* Keep changes surgical: only touch files necessary to fix routing + notification eligibility.

## Success Criteria
* Lead `370b29c7-3370-4bfc-824b-5c4b7172d72a` relevant inbound thread routes to Booking Process 5 (or the intended process per confirmed policy) and produces the correct notification/tasking behavior.
* Lead `29c19fe2-8142-45f5-9f3e-795de1ae13b1` “open to a quick call next week” style inbound message is treated as meeting scheduling (not callback/call-request), and does not create an incorrect call-request task/notification.
* Booking Process 4/5 notifications trigger when the router selects 4/5, even if the lead sentiment is Interested (or other allowed sentiments), without spamming/duplicating notifications.
* Validation gates pass (NTTAN is required because this touches AI/message routing behavior):
  * `npm run test:ai-drafts`
  * `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-177/replay-case-manifest.json --dry-run`
  * `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-177/replay-case-manifest.json --concurrency 3`

## Subphase Index
* a — Supabase Investigation (leadId 370b… + leadId 29c…) + Repro IDs + Replay Manifest
* b — Locate Current Booking Process Router + Notification Gates (Code Trace)
* c — Implement Routing Eligibility Fixes (Interested + other sentiments) for Process 4/5
* d — Implement Call-Intent Disambiguation (soft-call vs callback) and prevent false Call Requested
* e — Tests + NTTAN Gates + Phase Review

## Repo Reality Check
* Booking-process router implementation: `lib/action-signal-detector.ts` (prompt key `action_signal.route_booking_process.v1` + `.outcome.v1` registered in `lib/ai/prompt-registry.ts`).
* Booking-process route notifications are surfaced via action-signal notifications (see `notifyActionSignals` in `lib/action-signal-detector.ts`) and deduped via `NotificationSendLog.kind='action_signal'`. Sentiment-driven notifications persist as `NotificationEvent` rows (Prisma model in `prisma/schema.prisma`).

## RED TEAM Findings (Gaps / Weak Spots)
* `NotificationEvent` has no explicit `processId` column; booking-process-specific notifications likely need to encode `processId` into `kind` and/or `dedupeKey` (avoid schema change unless proven necessary).
* Booking-process routing can run multiple times per lead/message (leadId `29c19fe2-8142-45f5-9f3e-795de1ae13b1` has multiple close-together route outcomes). Notification dedupe must be explicit and keyed to `messageId + processId`.
* Phase 177e should capture replay artifact diagnostics in the review:
  * artifact path(s)
  * `judgePromptKey` and `judgeSystemPrompt`
  * per-case `failureType` counts

## Phase Summary (running)
- 2026-02-20 — Phase created; initial Supabase investigation confirms leadId `370b29c7-3370-4bfc-824b-5c4b7172d72a` routed to Process 5; replay manifest created (files: `docs/planning/phase-177/plan.md`, `docs/planning/phase-177/a/plan.md`, `docs/planning/phase-177/replay-case-manifest.json`).
- 2026-02-21 — Implemented booking-process eligibility + scheduler-link handling + callback-vs-scheduled-call disambiguation; added Call Requested time-clarification guard; NTTAN + repo gates pass (files: `lib/action-signal-detector.ts`, `lib/lead-scheduler-link.ts`, `lib/scheduling-link.ts`, `lib/call-requested.ts`, `lib/sentiment.ts`, `lib/ai-drafts.ts`, `docs/planning/phase-177/review.md`).
