# Phase 181 — Future-Window Deferral Autopilot (Availability-Horizon Scheduling)

## Original User Request (verbatim)
`$terminus-maximus 181`

## Purpose
Implement an end-to-end scheduling flow for leads who propose broad future windows (for example, "mid-March") so the system responds correctly now, schedules a deterministic re-contact one week before the requested window, and auto-sends with fresh availability when due.

## Context
Recent FC replay + production behavior show a reliability gap when leads express future intent without an exact time. Existing clarify flows ask for specific date/time too early or produce judge-fail draft-quality edges in broad-window cases. We need a first-class deferral mode that:
- acknowledges the requested future window,
- states availability is not yet published for that window,
- promises outreach one week before,
- schedules/executes that outreach automatically,
- respects campaign auto-send gating and existing manual-only booking invariants.

Locked policy from this conversation:
- Trigger deferral using dynamic workspace availability coverage (not static day thresholds).
- Always defer when requested window start is after current availability coverage max date.
- Re-contact timing is `window_start - 7 days`.
- Deferral reply content: "no availability yet" + "we will reach out one week before" + booking link.
- Channel split: SMS deterministic template; Email/LinkedIn AI-generated with required assertions.
- Unparseable future intent (for example, "sometime later") => immediate clarifier only (no deferred task yet).
- Availability fetch failure => auto-send deferral reply + enqueue availability refresh/retry job + Slack warning.
- Coordinator mentions (for example, "Karla to coordinate") => normal lead-facing deferral behavior (no suppression/manual-only override).

Workspace/client in scope:
- Founders Club (`clientId=ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`)

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 180 | Active (untracked) | Intentional routing suppression + meeting-requested draft behavior | Ensure this phase does not re-broaden suppression logic; deferral mode must preserve normal Meeting Requested draft path unless explicit future-window deferral applies. |
| Phase 179 | Recently implemented | Follow-up timing + Process 5 manual-only + Meeting Booked evidence gate | Keep Process 5 manual-only invariant unchanged; do not regress AI campaign gating/meaningful-activity checks. |
| Phase 176 | Active | Scheduling window enforcement + not-available handling | Reuse "not available yet" semantics and avoid proposing unavailable slots. |
| Phase 175 | Active | Timing clarifier attempts + re-engagement enrollment | Deferral tasks must compose with existing clarify attempt sequencing and cancellation behavior. |
| Phase 177/178 | Active | Booking process routing + call vs meeting disambiguation | Keep booking action-signal contracts intact; deferral mode must not misclassify call-requested or external scheduler-link cases. |

## Objectives
* [x] Add deterministic "future-window deferral" decision contract to scheduling extraction/overseer flow.
* [x] Generate policy-compliant deferral replies per channel (SMS deterministic; Email/LinkedIn AI constrained).
* [x] Create deferred follow-up tasks scheduled for `window_start - 7 days` with dedupe/cancel safety.
* [x] Auto-send deferred follow-up messages with fresh availability (or safe fallback on fetch failure).
* [ ] Add operational telemetry/Slack signals and replay coverage for broad-window scenarios.

## Constraints
- Preserve existing invariants:
  - Process 5 (external scheduler link) remains manual-only and blocks auto-send.
  - `Meeting Booked` remains provider-evidence-only.
  - Auto-send still requires campaign response mode `AI_AUTO_SEND`.
- Availability horizon must be dynamic based on current workspace availability coverage; no hard-coded global horizon default.
- Never propose exact slots for windows beyond current availability coverage max date.
- For unparseable "later" statements, do not create deferred-window tasks; ask clarifying month/week first.
- Use idempotent task creation + dedupe keys to prevent duplicate deferred tasks.
- Respect channel-specific style/length rules and safety policies.

## Success Criteria
- Broad-window inbound (for example, "mid-March", "2nd week of March") triggers deferral mode when window start exceeds current availability coverage max date.
- Deferral reply includes all required elements:
  - no availability yet for that window,
  - promise to re-contact one week before,
  - booking link included (where channel policy allows).
- Deferred follow-up task is created with due date = window start minus 7 days (business-day adjusted if applicable).
- Due processor auto-sends re-contact message when eligible (`AI_AUTO_SEND`) and no newer inbound/setter outbound conflicts exist.
- Availability fetch failure path executes fallback: defer reply still sent, retry job queued, Slack warning emitted.
- Unparseable future intent path remains clarifier-only (no deferred task creation).
- No regression in Process 5 manual-only behavior, Meeting Booked evidence gate, and existing timing clarify attempt policies.
- NTTAN validation completed and documented:
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20`
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3`

## Subphase Index
* a — Contract + Data Mapping for Future-Window Deferral
* b — Extraction/Overseer Logic: Introduce `defer_until_window` Decision Path
* c — Reply Generation by Channel (Deferral Copy + Link Policy)
* d — Deferred Follow-Up Task Engine (Schedule, Dedupe, Cancel, Retry)
* e — Cron/Auto-Send Integration + Slack/Telemetry + Safety Gates
* f — Tests, Replay Manifest, NTTAN Validation, and Phase Review

## Phase Summary (running)
- 2026-02-21 — Implemented future-window deferral flow in scheduler: dynamic horizon comparison against availability coverage, immediate deferral notice + week-prior recontact task creation, clarify-task cancellation, availability retry queueing, and due-task fresh-availability message refresh (files: `lib/followup-timing.ts`).
- 2026-02-21 — Expanded follow-up draft eligibility to include future-window auto campaigns and added test coverage for eligibility (files: `lib/followup-task-drafts.ts`, `lib/__tests__/followup-task-drafts.test.ts`).
