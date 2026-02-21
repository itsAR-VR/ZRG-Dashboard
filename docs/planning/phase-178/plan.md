# Phase 178 — FC Booking Process 4/5 Routing Eligibility + Call vs Meeting Disambiguation

## Purpose
Investigate why an FC lead did not follow the expected Booking Process 5 handling, then harden Booking Process 4/5 notifications/tasking so it works for Interested leads and other sentiments, while reducing false “Call Requested” paths for soft scheduling language (call-as-meeting).

## Context
FC production reports:
- A lead should have been handled as Booking Process 5 (lead-provided scheduler link), but downstream handling did not occur.
- Booking Process 4/5 notifications/tasking appear to be gated too narrowly (missing Interested leads and potentially other sentiments).
- “Open to a quick call next week” style replies are being interpreted as callback intent (Call Requested / Process 4), but they should be treated as normal meeting scheduling.

Working hypotheses (to verify in 178a):
- Process 5 can be detected, but downstream handling fails when the external scheduler link is not extracted/persisted (example: Notion scheduler links).
- Process 4/5 actions should be keyed off booking-process routing outcomes and/or explicit-instruction signals, not solely sentiment tags.
- “Call” language is overloaded; Process 4 should be reserved for explicit callback requests, not scheduled-call intent.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 176 | Active (untracked) | scheduling + draft/task behavior | Avoid mixing scheduling window policy work into this phase; keep edits scoped to booking-process routing + notifications/tasking + prompt disambiguation. |
| Phase 177 | Active (untracked) | booking-process routing + scheduler-link handling + call intent | Phase 178 should either (a) finish/verify Phase 177 changes, or (b) supersede it with a clean closeout. |

## Objectives
* [x] Confirm, via Supabase, the exact messages/AI decisions for the FC cases and capture stable thread/message IDs for replay.
* [x] Ensure Booking Process 4/5 actions (notifications/tasking) can trigger for Interested leads and other non-call/meeting sentiments when Process 4/5 is detected.
* [x] Reduce false “Call Requested” classification for scheduled-call language, without regressing true callback-request behavior.
* [x] Add/update regression coverage and run required validation gates (NTTAN).

## Constraints
- No secrets or PII in repo docs (IDs ok; do not paste raw message bodies).
- Prefer AI-based disambiguation over broad deterministic regex.
- Keep changes surgical (touch only what is necessary for this phase).

## Success Criteria
- Lead-provided scheduler links (including Notion) are extracted/persisted, and the “lead scheduler link” follow-up path triggers when the booking-process router selects `processId=5` (with deterministic explicit-instruction fallback only when AI routing is disabled/unavailable).
- Process 4 (callback intent) can trigger call tasking/notifications even if sentiment is not `Call Requested`.
- Soft scheduling phrasing (“open to a quick call next week”) is treated as meeting scheduling (not callback intent), and does not create a call-request-only task.
- Validation gates:
  - `npm run lint`
  - `npm run build`
  - `npm test`
  - NTTAN (required):
    - `npm run test:ai-drafts`
    - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-178/replay-case-manifest.json --dry-run`
    - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-178/replay-case-manifest.json --concurrency 3`

## Subphase Index
* a — Supabase Investigation + Repro IDs + Replay Manifest
* b — Code Trace + Fix: Process 4/5 Eligibility + Scheduler Link Handling + Prompt Disambiguation
* c — Tests + NTTAN Gates + Phase Review

## Repo Reality Check (RED TEAM)
- What exists today:
  - Booking-process routing + action signal detection: `detectActionSignals()` in `lib/action-signal-detector.ts` with AI router prompt `action_signal.route_booking_process.v1` and outcome telemetry `action_signal.route_booking_process.outcome.v1`.
  - Slack notifications for process-4/5 signals: `notifyActionSignals()` in `lib/action-signal-detector.ts` (dedupe via `NotificationSendLog.kind='action_signal'`).
  - Lead-provided scheduler link persistence: `extractSchedulerLinkFromText()` in `lib/scheduling-link.ts` is used across inbound processors to update `Lead.externalSchedulingLink` (best-effort, async).
  - Downstream manual tasking for lead scheduler links: `handleLeadSchedulerLinkIfPresent()` in `lib/lead-scheduler-link.ts`.
  - Call-request tasking: `ensureCallRequestedTask()` in `lib/call-requested.ts`.
- What this phase assumed:
  - Process 5 routing implies a lead-provided scheduler flow and should create a human-visible task when the lead explicitly instructs booking via that link.
  - Process 4 routing implies callback intent and should be able to create call tasks even when sentiment differs.
- Verified touch points:
  - `lib/scheduling-link.ts`
  - `lib/lead-scheduler-link.ts`
  - `lib/call-requested.ts`
  - `lib/inbound-post-process/pipeline.ts`
  - `lib/background-jobs/email-inbound-post-process.ts`
  - `lib/background-jobs/sms-inbound-post-process.ts`
  - `lib/background-jobs/linkedin-inbound-post-process.ts`
  - `lib/ai/prompt-registry.ts`
  - `lib/sentiment.ts`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Router-driven Process 5 trigger could create tasks for false positives if the router misclassifies signature-only links → keep router prompt guardrail (“signature-only link is not enough”) and require an extracted scheduler URL before creating a task.
- `externalSchedulingLink` can be persisted from signatures even when not explicitly intended → keep downstream tasking gated on `processId=5` (or explicit-instruction fallback only when AI routing is disabled/unavailable), and consider also gating draft context usage if this causes wrong booking links in AI drafts.

### Missing or ambiguous requirements
- No backfill path for historical messages where router selected Process 5 but no `lead_scheduler_link` task exists → intentionally out of scope (fix future inbounds only).

### Testing / validation
- NTTAN replay was blocked on 2026-02-20 due to DB connectivity, then rerun successfully on 2026-02-21:
  - `.artifacts/ai-replay/run-2026-02-21T14-19-31-142Z.json` (dry-run selected=3)
  - `.artifacts/ai-replay/run-2026-02-21T14-19-36-353Z.json` (evaluated=2, passed=1, failedJudge=1, zero critical invariant misses)

## Assumptions (Agent)
- Process 5 task creation should be keyed off booking-process router outcome (`processId=5`) for better phrasing coverage. (confidence ~95%)
  - Mitigation check: ensure router prompt continues to prohibit signature-only links from becoming Process 5.
- No historical backfill is required; fix for future inbounds only. (confidence ~95%)

## Phase Summary (running)
- 2026-02-20 — Verified FC cases in Supabase and created replay manifest (files: `docs/planning/phase-178/a/plan.md`, `docs/planning/phase-178/replay-case-manifest.json`).
- 2026-02-20 — Hardened Process 5 scheduler-link handling and Process 4 callback task eligibility (files: `lib/lead-scheduler-link.ts`, `lib/scheduling-link.ts`, `lib/call-requested.ts`, `lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/*-inbound-post-process.ts`, `docs/planning/phase-178/b/plan.md`).
- 2026-02-20 — Keyed Process 5 task creation off booking-process router outcome (`processId=5`) and re-ran build/tests (files: `lib/lead-scheduler-link.ts`, `lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/*-inbound-post-process.ts`, `docs/planning/phase-178/plan.md`, `docs/planning/phase-178/review.md`).
- 2026-02-21 — Re-ran phase manifest NTTAN replay after connectivity recovery:
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-178/replay-case-manifest.json --dry-run --ab-mode overseer` (selected=3)
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-178/replay-case-manifest.json --concurrency 3 --ab-mode overseer` (evaluated=2, passed=1, failedJudge=1, zero critical invariant misses)
