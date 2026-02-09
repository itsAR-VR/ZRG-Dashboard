# Phase 121 — Stop Erroneous Auto-Booking From Inbound Email Threads

## Purpose
Prevent the AI from auto-booking meetings when a lead did not agree to a call, especially when inbound emails contain quoted threads that include prior offered times.

## Context
A real conversation shows the system sending an auto-booking confirmation ("You're booked for ...") after an inbound email that did not accept a meeting. The most likely failure mode is that quoted thread content (including offered availability / times) leaked into the text used by the auto-booking pipeline, causing `processMessageForAutoBooking()` to incorrectly treat the message as scheduling-related.

Repo touch points (verified in code):
- Auto-booking entrypoint is invoked for inbound email in post-processing: `lib/inbound-post-process/pipeline.ts` and `lib/background-jobs/email-inbound-post-process.ts` call `processMessageForAutoBooking(...)`.
- Core logic lives in `lib/followup-engine.ts:processMessageForAutoBooking()`.
- Email cleaning lives in `lib/email-cleaning.ts:cleanEmailBody()` and is used by `app/api/webhooks/email/route.ts`.
- Current webhook code uses `cleaned.cleaned || contentForClassification` for `message.body`, which can fall back to raw HTML/text (including quoted threads) when the cleaned body is empty.

Key decisions (from user):
- Mitigation: leave auto-booking enabled (no global kill-switch for now).
- Acceptance strictness: allow generic acceptance, but only when it is clearly a short acknowledgement to a recent offered-slot message.
- Email storage: when cleaning yields an empty reply-only body, store empty in `message.body` (do not fallback to raw HTML/text for UI; raw should never be displayed).

## Concurrent Phases
Overlaps detected by scanning recent phases (120 -> 110) and current repo state (`git status --porcelain`).

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 114 | Complete | `lib/followup-engine.ts` auto-booking scenario logic | Keep booking-gate semantics intact; changes must be additive and regression-tested. |
| Phase 113 | Complete | `lib/followup-engine.ts` booking gate + day-only behavior | Do not weaken fail-closed gate behavior; focus only on preventing false triggers. |
| Phase 109 | Complete | `lib/email-cleaning.ts` changes (null-byte + cleaning tests) | Extend cleaning safely; add tests for Gmail-style quoted headers without breaking existing cases. |
| Phase 116 | Complete | `lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/email-inbound-post-process.ts` | Preserve inbound post-process semantics; keep changes scoped to email quote-stripping and auto-book inputs. |
| Phase 115 | Complete | `app/api/webhooks/email/route.ts` | Preserve webhook behavior and safety checks; apply storage semantics changes consistently across all inbound paths. |
| Phase 120 | Complete | Analytics only | No file overlap expected. |

Repo state note (2026-02-09): Phase 121 has uncommitted changes plus an untracked test file (`lib/__tests__/followup-generic-acceptance.test.ts`). Phase 120 artifacts are unchanged.

## Objectives
- [x] Ensure inbound email text used for automation is "latest reply only" (quoted thread removed) and stored safely.
- [x] Prevent `processMessageForAutoBooking()` from booking based on quoted times or non-scheduling messages.
- [x] Keep generic acceptance enabled, but constrain it to low-risk cases.
- [x] Add regression tests that reproduce the failure mode and prevent recurrence.
- [x] Validate with `npm test`, `npm run lint`, `npm run build`.

## Constraints
- Never display raw HTML/raw email in the UI.
- Never log secrets/PII (raw message bodies, email addresses, phone numbers).
- Preserve existing booking-gate behavior (fail-closed) and meeting overseer semantics.
- Keep changes scoped to: email cleaning/storage, auto-booking trigger/gating, and tests.

## Success Criteria
- [x] Quoted thread content (including offered times) cannot trigger auto-booking.
- [x] Non-scheduling inbound replies like "not looking to sell" or "not interested" never auto-book.
- [x] Generic acceptance (e.g. "Yes", "Sounds good") can still auto-book only when it is a short acknowledgement to a recent offered-slot message.
- [x] New unit tests cover:
  - Gmail-style "On ... wrote:" split across lines
  - generic acceptance gating + proposed-time heuristic (`looksLikeTimeProposalText`)
  - automation quote stripping helper (`stripEmailQuotedSectionsForAutomation`)
- [x] Ingestion stores `Message.body` as reply-only cleaned text (no raw fallback; can be empty). (Verified via code change in `app/api/webhooks/email/route.ts`.)
- [x] `npm test`, `npm run lint`, `npm run build` pass.

## Repo Reality Check (RED TEAM, pre-implementation)

Captured before Phase 121 changes landed (for final state, see `docs/planning/phase-121/review.md`).

- What exists today:
  - `lib/email-cleaning.ts`: `stripQuotedSections()` (PRIVATE, not exported), `cleanEmailBody()` (exported), `stripNullBytes()` (exported)
  - `app/api/webhooks/email/route.ts`: 4 separate webhook paths (EmailBison line 620, Instantly line 1168, Inboxxia line 1400, Inboxxia scheduled line 1718) all use `cleaned.cleaned || contentForClassification` for `cleanedBodyForStorage`
  - `lib/followup-engine.ts:processMessageForAutoBooking()` at line 3180: receives `messageBody` string, trims it to `messageTrimmed` at line 3215
  - Generic acceptance at line 3342: `if (!acceptedSlot && overseerDecision?.acceptance_specificity === "generic") { acceptedSlot = offeredSlots[0] ?? null; }` — no freshness check, no `is_scheduling_related` guard
  - Scenario 3 `looksLikeTimeProposal` at line 3638: includes bare `\bnext\b` in regex alternation at line 3641
  - `lib/inbound-post-process/pipeline.ts` line 267: `inboundText = messageBody.trim()` passed to auto-booking at line 286
  - `lib/background-jobs/email-inbound-post-process.ts` line 709: `inboundText = (message.body || "").trim()` passed to auto-booking at line 894
  - `lib/meeting-overseer.ts`: exports `MeetingOverseerExtractDecision` with `is_scheduling_related` boolean and `acceptance_specificity` enum
  - `lib/__tests__/email-cleaning.test.ts`: Only 4 tests (null-byte focused); NO quote stripping tests
- Verified touch points:
  - `lib/email-cleaning.ts` — exists, 141 lines
  - `lib/followup-engine.ts` — exists, `processMessageForAutoBooking` at line 3180
  - `lib/meeting-overseer.ts` — exists, exports types and functions
  - `lib/inbound-post-process/pipeline.ts` — exists, auto-book call at line 286
  - `lib/background-jobs/email-inbound-post-process.ts` — exists, auto-book call at line 894
  - `app/api/webhooks/email/route.ts` — exists, 4 webhook paths with `cleanedBodyForStorage`
  - `lib/__tests__/email-cleaning.test.ts` — exists, minimal coverage
  - `lib/booking.ts` — `OfferedSlot` interface with `offeredAt: string` field at line 26

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Quoted thread leakage via raw fallback** → 121b must patch ALL 4 webhook paths (not just 1). Lines: 620, 1168, 1400, 1718 in `app/api/webhooks/email/route.ts`.
- **Generic acceptance with no guards** → 121c must add `is_scheduling_related` check AND slot freshness AND message length guard before allowing `offeredSlots[0]` selection at line 3342.
- **Legacy messages in DB still contain quoted threads** → 121d defense-in-depth re-cleaning is critical for `message.body` values stored before this fix.

### Missing or ambiguous requirements
- 121a: Plan says "Export an automation-safe helper" but `stripQuotedSections()` is currently a **private function**. Clarification: create a NEW exported wrapper `stripEmailQuotedSectionsForAutomation()` that calls the improved internal logic.
- 121b: Plan says "Update `app/api/webhooks/email/route.ts` where it sets `cleanedBodyForStorage`" — implies 1 location. Reality: **4 locations** (EmailBison, Instantly, Inboxxia, Inboxxia-scheduled). All must be patched identically.
- 121c: Plan references `detectMeetingAcceptedIntent(...)` in the Inputs section but this function is an AI YES/NO call (line 3079) — it is NOT the generic acceptance path. The actual generic acceptance is the `overseerDecision?.acceptance_specificity === "generic"` branch at line 3342.

### Repo mismatches (fixed in plan)
- `stripQuotedSections()` is private (not exported) → plan updated to say "create new export"
- 121b scope: 1 webhook path → 4 webhook paths
- 121c: `detectMeetingAcceptedIntent` reference removed from scope (not relevant to generic acceptance)

### Performance / timeouts
- No timeout risks — all changes are to synchronous string processing (email cleaning) and conditional branching (booking gating). No new AI calls added.

### Security / permissions
- No new auth surfaces. Existing webhook secret validation preserved.
- `Message.body` will never contain raw HTML/thread content (prevents XSS in UI).

### Testing / validation
- Missing: quote stripping tests (0 today) → 121a adds regression tests
- Missing: webhook storage tests for "cleaned body is empty" edge case → 121b should add test
- Missing: generic acceptance gating unit tests → 121c adds tests for helper functions

## Assumptions (Agent)

- Assumption: `OfferedSlot.offeredAt` is an ISO string set when the draft containing the slot is created. Freshness = `Date.now() - Date.parse(offeredAt)` (confidence ~95%).
  - Mitigation: verify in `lib/ai-drafts.ts` or `lib/booking.ts` where `offeredAt` is set.
- Assumption: The 4 webhook paths in `email/route.ts` are the ONLY paths that store inbound email to `Message.body`. No other webhook (GHL SMS, LinkedIn) uses `cleanEmailBody()` fallback. (confidence ~95%).
  - Mitigation: grep for `cleanedBodyForStorage` to confirm no additional paths.
- Assumption: SmartLead and Instantly background jobs (`lib/background-jobs/smartlead-inbound-post-process.ts`, `lib/background-jobs/instantly-inbound-post-process.ts`) also call `processMessageForAutoBooking` and should get the same defense-in-depth re-cleaning as 121d. (confidence ~85%).
  - Mitigation: check these files for auto-booking calls during 121d implementation.

## Subphase Index
- a — Email quote stripping hardening + regression fixtures
- b — Webhook storage semantics: never fallback raw into `message.body` + safe compliance classification (ALL 4 webhook paths)
- c — Auto-book gating hardening: generic acceptance constraints (`is_scheduling_related` + freshness + length) + proposed-time trigger tightening (remove bare `next`)
- d — Defense in depth: re-clean inbound email before auto-book in post-process pipelines (incl. SmartLead/Instantly check) + validation notes

Note (RED TEAM): No new subphases required. Existing a-d coverage is sufficient when expanded per findings above.

## Phase Summary
- Shipped:
  - Hardened email quote stripping; added `stripEmailQuotedSectionsForAutomation(...)` for automation defense-in-depth.
  - Webhook storage semantics: `Message.body` stores reply-only cleaned text (no raw fallback; can be empty).
  - Auto-book gating hardening for generic acceptance; tightened time-proposal heuristic to avoid “next steps” false triggers.
  - Re-cleaned inbound email text immediately before snooze detection + auto-booking in post-process pipelines.
- Verified:
  - `npm test` — pass
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Review:
  - `docs/planning/phase-121/review.md`
