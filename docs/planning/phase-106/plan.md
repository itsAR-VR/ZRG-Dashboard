# Phase 106 — AI Bugs Backlog Planning (Uncompleted Items)

## Purpose
Create a concrete, per-bug plan for all currently incomplete AI bugs on the “AI Bugs + Feature Requests” board so implementation can proceed with clear scope and verification steps.

## Context
We pulled the Monday board “AI Bugs + Feature Requests” and filtered for non-Done items. The active bug list is in Master Inbox and includes Jam repro links for most items. The user requested a phase plan and a plan for each bug, so this phase scaffolds one subphase per bug to capture scope, reproduction, likely touchpoints, and verification steps.

## Monday Snapshot (2026-02-05 15:46:15 UTC)
- Board: “AI Bugs + Feature Requests” (`18395010806`)
- Filter: Status `not_any_of [1]` (Done label id `1`)
- Non-Done items:
| Item ID | Title | Type | Priority | Owner (Dev) | Jam/Notes |
| --- | --- | --- | --- | --- | --- |
| 11174440376 | Website link not generated | Bug | — | — | — |
| 11183404766 | AI suggesting 2 calendar slots but 1 is blank + AI providing more info about calls to people who have already said yes | Bug | 🟡 Medium | Teddy Francmanis | https://jam.dev/c/780becbd-0a32-4817-93ab-30ee41d45a58 |
| 11185162432 | AI keeps asking questions to leads post booking | Bug | 🟠 High | — | https://jam.dev/c/7885b3fa-b274-4ea3-9bc3-3f82fdb6d13e |
| 11188016134 | AI Bad Response For Meeting Request | Bug | 🟠 High | Abdur Sajid | https://jam.dev/c/479a2962-1f36-47b6-915d-b620395e0671 |
| 11195846714 | Reactivation campaigns not sending SMS (+ maybe same issue for LinkedIn) | Bug | 🟠 High | Teddy Francmanis | https://jam.dev/c/47562dd5-3cb7-4839-9fe3-12a3f1a83e91 |
| 11127267338 | Calling System | Feature Request | 🟠 High | Abdur Sajid | — |
| 11127271384 | Mobile App | Feature Request | 🟠 High | Abdur Sajid | — |
| 11049445047 | Command AI to adjust drafted response (tone/edit) | Feature Request | Minimal | Abdur Sajid | — |
| 11075133751 | All Replies filter with date ranges and Email Status | Feature Request | Minimal | Abdur Sajid | — |
| 11155102345 | Sales Call AI | Feature Request | — | Abdur Sajid | — |
| 11155120538 | AI growth strategist + campaign performance auto-optimizations | Feature Request | — | Abdur Sajid | — |
| 11157946059 | Admins change default sequences across client workspaces | Feature Request | 🟡 Medium | — | — |
| 11177342525 | See responses edited vs auto sent vs approved | Feature Request | — | — | — |
| 11177512976 | Add preview of lead email in Slack | Feature Request | — | Jon | — |
| 11177594620 | AI Responses improvement | Feature Request | — | Jon | https://docs.google.com/document/d/1GoG_rEnCd9Sfqx9wYoWY6B1pG3w6hxtPX6H1fMLgKdU/edit?tab=t.0 |
- Scope for Phase 106 implementation: **Master Inbox bugs only** (feature requests tracked but not in scope).

## Objectives
* [x] Enumerate all incomplete bug items from the board (pin stable Monday item IDs)
* [x] Produce a per-bug plan with repro/diagnosis/fix/verify steps
* [x] De-dupe against existing phase plans so we don’t re-triage solved/planned work
* [x] Keep plans scoped to the Master Inbox AI pipeline and related workflows
* [x] Implement the approved fixes for website link + meeting-request/auto-booking behavior
* [x] Address additional backlog findings (reactivation SMS/LinkedIn, disposition gaps, send_outcome_unknown recovery, admin-auth gap, sentiment comment mismatch)

## Constraints
- Follow existing repo conventions (AGENTS.md) and avoid schema changes unless explicitly required.
- Treat webhook/cron routes as security-sensitive; authenticate before processing.
- Each subphase should end with a concrete output (plan + candidate files/areas).
- If schema changes, run `npm run db:push` before marking the phase complete.

## Locked Decisions (from user)
- Phase 106 is a **point-in-time snapshot** (no continuous Monday sync).
- “Website link not generated” refers to **our company website**, stored as a **primary Knowledge Asset** with a dedicated UI field.
- Meeting/time “overseer” runs **only on scheduling-related inbounds**.
- Auto-booking: **auto-book on acceptance**, default to **first offered slot** when acceptance is generic.
- Day-only acceptance (e.g., “Thursday works”) → **auto-book the earliest matching slot**.
- If lead says “later this week” without a specific time → **ask clarifying**, don’t auto-book.
- After auto-booking, **always send a confirmation reply**.
- Confirmation replies must use the **same channel as the inbound message** when sendable.
- “Send me more info” should respond with offer/knowledge details (not defaulting to a website link).
- Channels: **Email + SMS + LinkedIn**.
- Overseer ↔ drafting: **two-pass propose → review → finalize**, with overseer as the gate.
- Persist overseer decisions **per message** for debugging.

## Success Criteria
- [x] `docs/planning/phase-106/plan.md` exists with a subphase per bug.
- [x] Root plan includes a **Repo Reality Check** + **RED TEAM Findings** section.
- [x] Each subphase plan references the bug name and any Jam link (if available).
- [x] Any bug already covered by an existing phase plan is explicitly linked (avoid duplicate work).
- [x] Plans are clear enough to implement without re-triage (expected behavior, repro artifacts, candidate files, and verification checklist).
- [x] Website URL can be set via a primary Knowledge Asset field and is available to AI prompts.
- [x] Meeting/time overseer improves auto-booking (acceptance → deterministic slot selection) and prevents over-explaining after “yes.”
- [x] Confirmation messages are sent after auto-booking across email/SMS/LinkedIn.
- [x] Tests cover deterministic slot selection + website URL extraction + guard against blank availability slots.
- [x] “Information Requested” replies use offer/knowledge context and avoid defaulting to the website unless explicitly asked.
- [x] Reactivation SMS/LinkedIn prerequisites surfaced (no silent failures).
- [x] Idempotent draft send paths persist `responseDisposition`.
- [x] `send_outcome_unknown` no longer leaves drafts stuck in `sending`; stale drafts backstop exists.
- [x] Admin reengagement backfill auth helper + tests exist (Phase 99 drift resolved).
- [x] preClassifySentiment comment matches actual behavior.
- [x] Post-change validation run (tests/lint/build, db:push if needed).

## Repo Reality Check (RED TEAM)

- What exists today (relevant areas for these bugs):
  - AI draft generation + prompt registry: `lib/ai-drafts.ts`, `lib/ai/prompt-registry.ts`
  - Auto-reply gating: `lib/auto-reply-gate.ts`
  - Ingestion (webhooks): `app/api/webhooks/email/route.ts`, `app/api/webhooks/ghl/sms/route.ts`
  - Follow-up automation + cron: `lib/followup-engine.ts`, `lib/followup-automation.ts`, `app/api/cron/followups/route.ts`
  - Booking + status transitions: `lib/booking.ts`
  - Availability formatting/selection: `lib/availability-format.ts`, `lib/availability-distribution.ts`, `lib/slot-offer-ledger.ts`
- What the plan assumes:
  - Monday item list is accurate as a snapshot (or will be re-synced in subphase **h**).
  - Jam links are usable for repro; if Jam MCP is unavailable, we can still repro via (a) Playwright screenshots/video, (b) DB evidence, or (c) user-provided lead/thread identifiers.
  - Bugs may share root causes across prompt logic + gating (implementers should avoid “fixing” one bug in isolation without regression checks against other subphases).
- Verified touch points:
  - All file paths referenced in subphases **a–g** exist in the repo as of **2026-02-05**.
  - “More info” prompt guidance lives in `lib/ai-drafts.ts` (subphase **p**).
  - Phase overlap exists:
    - Bug **a** overlaps Phase **105** (duplicate follow-up emails) and uses the same Jam link.
    - Bug **d** overlaps Phase **98** (stop sequences on booking).
    - Bug **c** overlaps Phase **97** (auto-send evaluator visibility; same Jam link).

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Bug list drift** (plan becomes stale vs Monday board) → mitigate by pinning stable Monday item IDs + snapshot date/time (subphase **h**).
- **Repro artifacts missing** (Jam link exists but no concrete lead/thread identifiers or timestamps) → require each bug plan to capture at least: channel, leadId, messageId(s), and when it happened (or a DB query to locate).
- **Duplicate work across phases** (bugs already planned/implemented elsewhere) → link to the dedicated phase plan and treat Phase 106 as an index, not a re-triage.
- **Fixing prompt behavior without regression coverage** → add a minimal regression fixture set for booking/availability/meeting-request scenarios when implementing **e/f/g**.
- **Inbound channel unavailable for confirmations** → return explicit error + monitor logs; ensure future UX handles this gracefully.

### Security / permissions
- If any fix touches cron/admin/webhook routes, keep the existing “auth-before-body” and secret checks intact; do not add debug logging that leaks PII.

### Testing / validation
- Prefer unit tests for deterministic logic (availability formatting, gating decisions, disposition classification).
- For integration-level validation, use the same trigger path as production (webhook or cron) but keep provider calls mocked/stubbed; duplicates are worse than missed sends.
- New tests + wiring changes still require `npm test`, `npm run lint`, and `npm run build` evidence (Phase 106n).
### Post-validation check
- Post-q–w validation re-scan found no new gaps; baseline lint/build warnings remain (recorded in Phase Summary).

## Assumptions (Agent)
- This phase is intended as a planning/index artifact, not the implementation vehicle. (confidence ~95%)
  - Mitigation check: if you want to start fixes immediately, run `phase-implement 106` and execute in priority order (or split into dedicated fix phases).
- Service description and knowledge assets are populated enough to answer “more info” requests without inventing details. (confidence ~90%)
  - Mitigation check: if assets are sparse, add a fallback to ask what specifics they want.

## Subphase Index
* a — Bug: 6 follow up emails sent (overlaps Phase 105)
* b — Bug: Website link not generated
* c — Bug: Missing AI responses (overlaps Phase 97)
* d — Bug: Meetings booked doesn’t automatically stop workflows/sequences (overlaps Phase 98)
* e — Bug: AI suggesting 2 calendar slots but 1 is blank + over-explaining after “yes”
* f — Bug: AI keeps asking questions to leads post booking
* g — Bug: AI Bad Response For Meeting Request
* h — Meta: Pin Monday snapshot + de-dupe/coordination against existing phases
* i — Implementation: Primary website asset + prompt injection
* j — Implementation: Meeting overseer decisions + persistence
* k — Implementation: Auto-booking slot selection + confirmations (all channels)
* l — Implementation: Draft gate (overseer review) + post-yes concision
* m — Implementation: Availability blank-slot guard + tests
* n — Validation: tests/lint/build + QA checklist
* o — Implementation: Auto-booking wiring + overseer hardening + tests
* p — Implementation: “More info” responses use offer/knowledge (no default website)
* q — Meta: Pin Monday snapshot + append new items
* r — Bug: Reactivation campaigns not sending SMS/LinkedIn
* s — Fix: ResponseDisposition missing in idempotent paths
* t — Fix: send_outcome_unknown recovery + stale sending backstop
* u — Fix: Phase 99 admin-auth helper/test gap
* v — Fix: preClassifySentiment comment mismatch
* w — Validation: tests/lint/build/db push (post-updates)

## Open Questions (Need Human Input)

- [x] (resolved) Day-only acceptance should auto-book earliest match; confirmations should respond on inbound channel when sendable. Website screenshot text received for formatting check.

## Phase Summary (running)
- 2026-02-05 — Wired messageId propagation for auto-booking, added LinkedIn auto-booking path, hardened overseer extract prompt, added blank-slot guard + tests (files: `lib/background-jobs/sms-inbound-post-process.ts`, `lib/background-jobs/email-inbound-post-process.ts`, `lib/background-jobs/linkedin-inbound-post-process.ts`, `lib/inbound-post-process/pipeline.ts`, `lib/meeting-overseer.ts`, `lib/ai/prompt-registry.ts`, `lib/availability-format.ts`, `lib/__tests__/knowledge-asset-context.test.ts`, `lib/__tests__/meeting-overseer-slot-selection.test.ts`, `lib/__tests__/availability-format.test.ts`, `scripts/test-orchestrator.ts`)
- 2026-02-05 — Validation completed: tests/build/db push ok; lint produced existing warnings (files: `docs/planning/phase-106/n/plan.md`)
- 2026-02-05 — Enforced inbound-channel confirmations and added “no website unless provided” prompt rule (files: `lib/followup-engine.ts`, `lib/ai-drafts.ts`)
- 2026-02-05 — Re-ran tests/lint/build after confirmation/prompt changes (files: `docs/planning/phase-106/n/plan.md`)
- 2026-02-05 — Treated “send me more info” as offer/knowledge response (no default website) (files: `lib/ai-drafts.ts`)
- 2026-02-05 — Re-ran tests/lint/build after “more info” prompt updates (files: `docs/planning/phase-106/n/plan.md`)
- 2026-02-05 — Phase 106 reviewed again; no new RED TEAM gaps found (files: `docs/planning/phase-106/plan.md`)
- 2026-02-05 — Pinned Monday snapshot + appended new subphases for added backlog items (files: `docs/planning/phase-106/plan.md`, `docs/planning/phase-106/q/plan.md`)
- 2026-02-05 — Completed post-q–v validation (tests/lint/build) and fixed message performance build blockers (files: `lib/message-performance-report.ts`, `lib/message-performance.ts`, `docs/planning/phase-106/w/plan.md`)
- 2026-02-05 — RED TEAM re-scan after validation found no new gaps; baseline lint/build warnings remain (files: `docs/planning/phase-106/plan.md`)

## Phase Summary

- Shipped:
  - Primary website asset field + prompt injection for “our website”.
  - Meeting overseer extraction/gate + persistence; auto-booking confirmations across channels.
  - LinkedIn auto-booking path, blank-slot guard, and regression tests.
  - “More info” replies now use offer/knowledge context and avoid default website sharing.
  - Reactivation prerequisites surfaced for SMS/LinkedIn sequences (no silent failures).
  - Idempotent draft send paths now persist `responseDisposition` for email + SMS.
  - `send_outcome_unknown` recovery + stale sending backstop to avoid stuck drafts.
  - Admin reengagement backfill auth helper + tests (Phase 99 drift resolved).
  - preClassifySentiment comment aligned with “New” behavior.
- Verified:
  - `npm test`: pass
  - `npm run lint`: pass with warnings
  - `npm run build`: pass
  - `npm run db:push`: pass
- Notes:
  - Existing lint/CSS warnings remain; no new errors introduced.
  - Message performance type mismatches fixed during validation to keep build green (Phase 108 coordination).
