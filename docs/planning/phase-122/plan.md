# Phase 122 — Agent-Driven Booking Intent + Date/Time Routing (No Regex Ack)

## Purpose
Make auto-booking decisions agent-driven using the **existing** Meeting Overseer + time parsing agents, so the system can reliably answer:
- “Is this person looking to book?” → `yes` / `no`
- “If yes, what did they specify?” → `date` (and `time` if present)
and then route deterministically based on **date-only** vs **date+time** (reusing existing Scenario 1/2/3 logic and the booking gate).

## Context
Phase 121 introduced deterministic guardrails to stop erroneous auto-booking from quoted email threads, including a regex-based “generic acknowledgement” check in `lib/followup-engine.ts`.

You want the “agents we already have” to be the source of truth for:
- whether the inbound is scheduling-related / booking intent
- what timing was specified (date-only vs date+time)

Existing building blocks (already in repo):
- Meeting Overseer extraction: `meeting.overseer.extract.v1` (`lib/meeting-overseer.ts:runMeetingOverseerExtraction`)
  - returns `is_scheduling_related`, `intent`, `acceptance_specificity`, `preferred_day_of_week`, `preferred_time_of_day`, etc.
- Offered-slot acceptance parsing: `followup.parse_accepted_time.v1` (`lib/followup-engine.ts:parseAcceptedTimeFromMessage`) → slot index selection
- Proposed-time parsing: `followup.parse_proposed_times.v1` (`lib/followup-engine.ts:parseProposedTimesFromMessage`) → concrete `UTC ISO` start times + tz clarification flag
- Final safety approval: `followup.booking.gate.v1` (`lib/followup-engine.ts:runFollowupBookingGate*`)

Locked decisions from this conversation:
- “Acknowledgement” / generic acceptance classification should be **agent-driven** (Meeting Overseer), not regex-based.
- Run Meeting Overseer extraction **always** when auto-booking is enabled (cost/latency accepted), relying on messageId caching (`MeetingOverseerDecision`) for idempotency.

## Concurrent Phases
Overlaps detected by scanning recent phases (121 → 112) and current repo state (`git status --porcelain`).

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 121 | Active (local uncommitted) | `lib/followup-engine.ts` booking logic | Phase 122 must be implemented on top of Phase 121 and preserve its “no false booking from quoted threads” safety property. |
| Phase 116 | Complete | post-process semantics (`lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/*`) | Do not change ingestion/pipeline semantics here; Phase 122 is limited to auto-book decisioning and prompts/tests. |
| Phase 114 | Complete | `lib/followup-engine.ts` scenario logic | Keep scenario wiring intact; changes should be localized to “intent classification” and routing. |
| Phase 113 | Complete | booking gate behavior | Preserve fail-closed booking gate semantics; do not weaken gate requirements. |
| Phase 112 | Complete | prompt registry + lead context bundle plumbing | Keep prompt keys stable; avoid breaking AI telemetry/override assumptions. |

## Objectives
* [x] Replace deterministic “generic acknowledgement” regex gating with an agent-driven contract (Meeting Overseer extraction).
* [x] Always run Meeting Overseer extraction when auto-booking is enabled, and derive a canonical booking signal:
  - `wantsToBook: yes/no`
  - `requested: none | day_only | date_time`
  - `date` and optional `time` (using existing parse flows)
* [x] Route deterministically:
  - date+time → existing offered-slot or proposed-time flows
  - date-only → existing weekday/day-only flow
* [x] Keep booking gate as the final approval step before booking.
* [x] Update Meeting Overseer extraction prompt instructions (no key bump) to better separate “generic ack” from non-scheduling replies.
* [x] Add unit tests for routing decisions and regressions.
* [x] Validate with `npm test`, `npm run lint`, `npm run build`.

## Constraints
- No new global kill-switch work in this phase (use existing toggles; fail closed).
- Keep prompt key stable: `meeting.overseer.extract.v1` (no version bump).
- Never log raw inbound message text or other PII.
- Preserve Phase 121 protections (quoted-thread stripping happens before auto-book; do not reintroduce raw fallbacks).
- Prefer small, testable pure helpers over sprawling refactors.

## Success Criteria
- Auto-book “generic acceptance” is decided by Meeting Overseer extraction (not regex), and still fails closed unless it is clearly a scheduling acknowledgement to a fresh offered-slot thread.
- Auto-book routing produces correct behavior for:
  - accept offered slot (exact match)
  - day-only (“Thursday works”) routing
  - proposed date+time parsing (timezone clarification when needed)
- Unit tests cover:
  - booking signal derivation from overseer decisions
  - date-only vs date+time routing behavior
  - “not interested / didn’t agree to a call” does not book even if thread contains offered slots
- Quality gates: `npm test` + `npm run lint` pass; build verified via `next build --webpack` (Turbopack panics in this sandbox).

## Repo Reality Check (RED TEAM)

- Pre-implementation snapshot (after Phase 121, uncommitted):
  - `lib/followup-engine.ts:processMessageForAutoBooking()` at line 3220:
    - `shouldRunMeetingOverseer()` called at line 3289 — **conditionally** gates overseer extraction based on keywords/sentiment/offeredSlots
    - `runMeetingOverseerExtraction()` called at line 3295–3303 — only when `shouldOversee === true`
    - `detectMeetingAcceptedIntent()` at line 3339 — used as **fallback** when overseer was not run (legacy AI YES/NO call, `gpt-5-mini`)
    - `isGenericAcceptanceAck()` (PRIVATE) at line 3117 — regex-based generic ack pattern matching
    - `isLowRiskGenericAcceptance()` (EXPORTED) at line 3130 — calls `isGenericAcceptanceAck()` + checks 7-day freshness
    - `looksLikeTimeProposalText()` (EXPORTED) at line 3145 — regex heuristic for Scenario 3 (bare `next` already removed by Phase 121)
    - Generic acceptance branch at line 3382: requires BOTH regex ack match AND freshness
    - Scenario 3 at line 3684: `shouldParseProposal` already uses overseer `intent === "propose_time"` when available, with `looksLikeTimeProposalText()` as fallback
  - `lib/meeting-overseer.ts`:
    - `shouldRunMeetingOverseer()` at line 145 — returns true if: offeredSlots > 0, or scheduling sentiment, or keyword match
    - `MeetingOverseerExtractDecision` type at line 17 — fields: `is_scheduling_related`, `intent` (accept_offer | request_times | propose_time | reschedule | decline | other), `acceptance_specificity` (specific | day_only | generic | none), `accepted_slot_index`, `preferred_day_of_week`, `preferred_time_of_day`, `relative_preference`, `relative_preference_detail`, `needs_clarification`, `clarification_reason`, `confidence`, `evidence`
    - `runMeetingOverseerExtraction()` at line 242 — model `gpt-5.2`, key `meeting.overseer.extract.v1`, caches by `messageId + stage` in `MeetingOverseerDecision` table
    - `selectOfferedSlotByPreference()` at line 157 — filters slots by weekday + time-of-day bracket
  - `lib/ai/prompt-registry.ts`:
    - `MEETING_OVERSEER_EXTRACT_SYSTEM_TEMPLATE` at line 498 — current prompt rules for extraction
    - Registry entry at line 1278 — key `meeting.overseer.extract.v1`, model `gpt-5.2`
    - **Also:** `followup.detect_meeting_accept_intent.v1` at line 1254 — the legacy fallback prompt
  - `lib/__tests__/followup-generic-acceptance.test.ts` — NEW (Phase 121, uncommitted), covers `isLowRiskGenericAcceptance` and `looksLikeTimeProposalText`
- Verified touch points:
  - `lib/followup-engine.ts` — exists, Phase 121 changes uncommitted, `processMessageForAutoBooking` at line 3220
  - `lib/meeting-overseer.ts` — exists, CLEAN (no Phase 121 changes), `runMeetingOverseerExtraction` at line 242
  - `lib/ai/prompt-registry.ts` — exists, `MEETING_OVERSEER_EXTRACT_SYSTEM_TEMPLATE` at line 498
  - `scripts/test-orchestrator.ts` — exists, modified by Phase 121 (new test wired)
  - `MeetingOverseerDecision` Prisma model — exists in schema (cache table)

- What exists now (post-Phase 122 implementation):
  - `lib/followup-engine.ts:processMessageForAutoBooking()`:
    - Always runs `runMeetingOverseerExtraction(...)` (cached by `messageId`) when auto-booking is enabled.
    - If overseer extraction returns `null` (API failure/timeout), the function fails closed (`{ booked: false }`) and does not attempt heuristic routing.
    - Routes using `deriveBookingSignal(...)` into `accept_offered` / `proposed_time` / `day_only` / `none`.
    - Generic acceptance no longer uses a regex; it only auto-accepts when exactly 1 offered slot exists and `isLowRiskGenericAcceptance` freshness passes.
    - Scenario 3 runs for `route === "proposed_time" || route === "day_only"`; day-only skips proposed-time parsing and selects availability via weekday.
  - Meeting Overseer extract prompt tightened in BOTH:
    - `lib/ai/prompt-registry.ts` (`MEETING_OVERSEER_EXTRACT_SYSTEM_TEMPLATE`)
    - `lib/meeting-overseer.ts` (`systemFallback`)

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Always-run overseer adds latency + cost to every auto-book-eligible message** → Phase 122a removes `shouldRunMeetingOverseer()` gating, meaning every message in `processMessageForAutoBooking()` triggers a `gpt-5.2` call. Cost/latency is "accepted" per plan, but the plan lacks a budget estimate or abort-on-timeout fallback. If the AI call hangs or fails, the current code returns `null` (fail-closed), which is safe — but should be explicitly documented.
- **Removing `isGenericAcceptanceAck()` regex removes a safety layer** → Phase 122b plan says "remove regex ack" but the regex currently prevents non-ack messages (like "Can you send the details?") from being treated as generic acceptance. If the overseer misclassifies `acceptance_specificity: "generic"` on a non-ack message, the freshness check alone won't prevent booking. Plan should keep freshness + optionally a soft length/content guard even when overseer-driven.
- **`deriveBookingSignal()` helper signature doesn't match current code structure** → The plan proposes `deriveBookingSignal({ messageTrimmed, offeredSlots, overseerDecision })` but the current code also needs `bookingGateEnabled`, `timeZone`, `lead` context, and `createClarificationTask` callback for proper routing. A pure function can only return a route enum; it can't create tasks or call the gate. Plan must clarify that `deriveBookingSignal` is a **route selector** only, not the full orchestrator.

### Missing or ambiguous requirements
- **122a: "Remove the `shouldRunMeetingOverseer(...)` gating"** — but `shouldRunMeetingOverseer` is also used by other callers outside of `processMessageForAutoBooking`. Verify no other callers break. The function should remain exported; only the auto-book call site should bypass it.
- **122a: Plan says `wantsToBook` is derived from `intent in {accept_offer, propose_time, reschedule}`** — but `reschedule` intent means the lead wants to change an existing meeting, not book a new one. Including `reschedule` in `wantsToBook` could cause the system to book a *new* meeting when the lead wants to *change* one. Safer: `wantsToBook` should be `accept_offer | propose_time` only.
- **122b: "Remove/stop using `detectMeetingAcceptedIntent(...)` for the normal path"** — resolved by failing closed when overseer extraction returns `null` (no heuristic fallback booking).
- **122b: `accepted_slot_index` is 1-based** (per overseer prompt) but `offeredSlots` array is 0-based. The current code at line 3359 already handles this (`overseerDecision.accepted_slot_index - 1`). Plan should note this convention to prevent regression.
- **122c: Weekday/day-only routing helpers** — `selectEarliestSlotForWeekday` DOES exist in `lib/followup-engine.ts` and is used for availability-based weekday selection when there are no offered slots (Scenario 3 / day-only). For offered-slot threads, `selectOfferedSlotByPreference()` in `lib/meeting-overseer.ts` (line 157) filters the offered slots by weekday/time-of-day.
- **122c: Plan says `acceptance_specificity === "day_only"`** routes to day-only flow — but the current code at line 3373 already handles day preferences via `preferred_day_of_week`. The plan should clarify whether `day_only` acceptance_specificity should trigger a *different* path than the current one, or if it's the same.
- **122d: Plan says "Update both the registry template and the in-code fallback so they do not drift"** — the `systemFallback` in `meeting-overseer.ts` (line 272) is used when no registry override exists. Plan should confirm that changes must be applied to BOTH `MEETING_OVERSEER_EXTRACT_SYSTEM_TEMPLATE` (line 498 of prompt-registry.ts) AND the `systemFallback` string (line 272 of meeting-overseer.ts).

### Repo mismatches (fixed in plan)
- Clarified weekday helpers:
  - `selectOfferedSlotByPreference` (line 157, `lib/meeting-overseer.ts`) filters offered slots by weekday/time-of-day.
  - `selectEarliestSlotForWeekday` (`lib/followup-engine.ts`) selects the earliest availability slot for a weekday in a timezone.
- `MEETING_OVERSEER_EXTRACT_SYSTEM_TEMPLATE` is at line 498 (not an unspecified location)
- `isLowRiskGenericAcceptance` takes `{ messageTrimmed, offeredSlot, nowMs? }` (not `{ messageTrimmed, offeredSlots, overseerDecision }` as Phase 121 RED TEAM originally planned — Phase 121 implementation simplified the signature)

### Performance / timeouts
- Always-run overseer extraction uses `gpt-5.2` which is slower/costlier than `gpt-5-mini` (used by fallback `detectMeetingAcceptedIntent`). Plan accepts this tradeoff but should add: if overseer extraction takes > 30s, log a warning and proceed without it (fail closed).
- Caching by `messageId` mitigates redundant calls but doesn't help cold path (first call per message).

### Security / permissions
- No new auth surfaces. Existing booking gate and webhook secret validation preserved.
- Prompt changes (no key bump) do not affect telemetry or override mechanisms.

### Testing / validation
- Phase 121 added `lib/__tests__/followup-generic-acceptance.test.ts` with `isLowRiskGenericAcceptance` and `looksLikeTimeProposalText` tests. Phase 122 should expand this or create a separate `followup-booking-signal.test.ts`.
- Plan should specify: can tests for `deriveBookingSignal` be fully offline (synthetic overseer decisions), or do they need LLM mocking?

## Assumptions (Agent)

- Assumption: `shouldRunMeetingOverseer()` is called by callers outside `processMessageForAutoBooking` — removing it from the auto-book path should not remove the export. (confidence ~90%)
  - Mitigation: grep for other usages before implementation.
- Assumption: `reschedule` intent should NOT trigger `wantsToBook = true` because it means changing an existing meeting, not creating a new one. (confidence ~80%)
  - Mitigation: verify with user; if reschedule should book, add it back. Current plan includes it — this RED TEAM recommends removing it.
- Assumption: Removing `isGenericAcceptanceAck()` regex is safe IF the Meeting Overseer reliably classifies `acceptance_specificity === "generic"` only for actual acknowledgements. (confidence ~75%)
  - Mitigation: keep freshness check unconditionally; consider keeping a soft message-length guard (< 15 words) as defense-in-depth even with agent-driven classification.
- Assumption: Phase 121 uncommitted changes will be committed before Phase 122 starts implementation. (confidence ~95%)
  - Mitigation: if not, Phase 122 must implement on top of the Phase 121 working tree.

## Locked Decisions

- [x] `reschedule` intent does NOT trigger `wantsToBook = true`.
  - Rationale: reschedule means changing an existing meeting, not booking a new one. Including it could cause spurious new bookings.
  - `deriveBookingSignal` routes: `accept_offer | propose_time` → `wantsToBook: true`; all others (including `reschedule`) → `wantsToBook: false`.
- [x] Length guard removed from `isLowRiskGenericAcceptance` when regex ack is replaced by overseer.
  - Rationale: trust Meeting Overseer `acceptance_specificity: "generic"` classification. Keep only 7-day freshness check as mechanical safety rail.
  - If overseer misclassifies, the booking gate (`followup.booking.gate.v1`) remains as final approval step.
- [x] If Meeting Overseer extraction returns `null` (API failure/timeout), fail closed (no booking) with no heuristic fallbacks.
  - Rationale: avoid any booking risk when the agent signal is unavailable.

## Subphase Index
* a — Booking signal contract + always-run Meeting Overseer extraction (bypass `shouldRunMeetingOverseer` in auto-book path only)
* b — Accept-offered routing: replace regex ack with overseer `acceptance_specificity`; keep mechanical safety rail (freshness only) + gate
* c — Proposed-time and day-only routing: unify "date vs date+time" behavior using existing parsers + weekday helpers (`selectOfferedSlotByPreference` for offered slots; `selectEarliestSlotForWeekday` for availability/day-only)
* d — Prompt tightening (registry + in-code fallback in sync) + unit tests (`deriveBookingSignal` with synthetic decisions) + validation

Note (RED TEAM): No new subphases required. Existing a-d coverage is sufficient when expanded per findings above.

## Phase Summary (running)
- 2026-02-09 — Switched auto-book routing to an agent-driven booking signal + routes, removed regex ack gating, tightened overseer prompt, and added unit tests. (files: `lib/followup-engine.ts`, `lib/meeting-overseer.ts`, `lib/ai/prompt-registry.ts`, `lib/__tests__/followup-booking-signal.test.ts`, `lib/__tests__/followup-generic-acceptance.test.ts`)
- 2026-02-09 — Verification: `npm test` pass; `npm run lint` pass (warnings only); Turbopack build panics in this sandbox, but `next build --webpack` pass. (see: `docs/planning/phase-122/review.md`)
- 2026-02-09 — Fail-closed hardening: removed heuristic fallback booking when Meeting Overseer extraction is unavailable. (file: `lib/followup-engine.ts`)
