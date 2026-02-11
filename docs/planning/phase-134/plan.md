# Phase 134 — Auto-Booking Sentiment Guard (OOO / Automated Reply Bypass Fix)

## Purpose

Prevent auto-booking from triggering on Out of Office and Automated Reply messages. Currently, `processMessageForAutoBooking()` runs the Meeting Overseer AI unconditionally (after toggle checks), so an OOO message containing a date reference (e.g., "I'll be out until Monday 2/16") gets misinterpreted as a proposed meeting time and booked.

## Context

**Bug observed:** A lead replied with an OOO auto-reply: *"I'll be out of the office until Monday 2/16. Thank-you"*. The system:
1. Correctly classified sentiment as "Out of Office"
2. But passed the message to `processMessageForAutoBooking()` without the sentiment tag
3. The Meeting Overseer AI extracted "Monday 2/16" as a proposed day → route: `day_only`
4. System booked the earliest Monday slot (11:30 AM Feb 16) and sent a confirmation

**Root cause (three missing guards):**
1. `lib/inbound-post-process/pipeline.ts:294` — does not check `sentimentTag` before calling `processMessageForAutoBooking()`, and does not pass it as a parameter
2. `lib/followup-engine.ts:3500` — `processMessageForAutoBooking()` signature has no `sentimentTag` parameter; calls `runMeetingOverseerExtraction()` unconditionally
3. `lib/meeting-overseer.ts:145` — `shouldRunMeetingOverseer()` has positive sentiment checks ("Meeting Requested", etc.) but no negative checks ("Out of Office", "Automated Reply"); however this function isn't even called from the auto-booking path

**Design principle:** The auto-reply gate (`lib/auto-reply-gate.ts:47`) and auto-send evaluator (`lib/auto-send-evaluator.ts:236`) both block on "Blacklist" and "Automated Reply" sentiments. Auto-booking must follow the same pattern.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 131 | Complete | `lib/inbound-post-process/pipeline.ts`, `lib/sentiment-shared.ts` | Re-read current state; Phase 131 added "Objection" sentiment — preserve. |
| Phase 130 | Complete | `lib/inbound-post-process/pipeline.ts` | Phase 130 added `autoSendSkipHumanReview` passthrough — preserve. |
| Phase 133 | Empty scaffold | No overlap | Independent. |

## Objectives

* [x] Add sentiment guard at pipeline level to skip auto-booking for non-scheduling sentiments
* [x] Add `sentimentTag` to `processMessageForAutoBooking()` signature as a defense-in-depth layer
* [x] Add tests verifying OOO and Automated Reply messages are blocked from auto-booking

## Constraints

- **Fail-closed**: If sentiment is unavailable (null/undefined), auto-booking should still proceed (existing behavior preserved) — the guard only blocks on known non-scheduling sentiments
- **Minimal blast radius**: Only add guards; do not restructure the auto-booking flow or modify the Meeting Overseer prompt
- **Existing pattern**: Follow the same block-list pattern used by `auto-reply-gate.ts` and `auto-send-evaluator.ts`

## Success Criteria

1. An OOO message like "I'll be out until Monday 2/16" does NOT trigger auto-booking
2. An Automated Reply message does NOT trigger auto-booking
3. A Blacklist message does NOT trigger auto-booking
4. Positive scheduling messages ("Monday works!" with sentiment "Meeting Requested") still auto-book normally
5. Messages with null/unknown sentiment still auto-book normally (fail-open for unknown, fail-closed for known-bad)
6. `npm run lint` and `npm run build` pass
7. New unit tests pass

## Subphase Index

* a — Sentiment guard implementation (pipeline + followup-engine + meeting-overseer)
* b — Tests + verification

## Files to Modify

| # | File | Lines | Change |
|---|------|-------|--------|
| 1 | `lib/inbound-post-process/pipeline.ts` | ~294-300 | Add sentiment check before `processMessageForAutoBooking()` call; pass `sentimentTag` in meta |
| 2 | `lib/followup-engine.ts` | ~3500-3530 | Add `sentimentTag` to `meta` type; add early-return guard |
| 3 | `lib/meeting-overseer.ts` | ~145-155 | Add negative sentiment check to `shouldRunMeetingOverseer()` (defense-in-depth for future callers) |

## Blocked Sentiments

The following sentiments will block auto-booking:
- `"Out of Office"` — OOO auto-replies contain dates that get misinterpreted as scheduling intent
- `"Automated Reply"` — Generic auto-acknowledgements are not human scheduling intent
- `"Blacklist"` — Opted-out leads should never be auto-booked (matches auto-reply-gate pattern)
