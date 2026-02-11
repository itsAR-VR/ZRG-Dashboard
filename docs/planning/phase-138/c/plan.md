# Phase 138c — Qualification-Aware Meeting Overseer Extraction + Booking Preconditions

## Focus

Upgrade meeting overseer extraction and auto-book decisioning so booking requires alignment of:
1) scheduling intent,
2) qualification status,
3) valid time extraction from message body.

## Inputs

- `lib/meeting-overseer.ts`
- `lib/followup-engine.ts`
- `lib/qualification-answer-extraction.ts`
- `lib/lead-context-bundle.ts` (service/knowledge/memory context support)
- Workspace context sources:
  - `WorkspaceSettings.serviceDescription`
  - qualification questions/answers
  - knowledge asset-derived context

## Pre-Flight Conflict Check

- [x] Re-read `MeetingOverseerExtractDecision` schema and extraction prompt in `lib/meeting-overseer.ts`.
- [x] Re-read overseer invocation in `processMessageForAutoBooking(...)`.
- [x] Verify overlap with phase 139 and preserve existing booking-gate semantics.

## Work

1. Extended `MeetingOverseerExtractDecision` and JSON schema with:
   - `intent_to_book`, `intent_confidence`
   - `qualification_status`, `qualification_confidence`, `qualification_evidence`
   - `time_from_body_only`, `time_extraction_confidence`
2. Extended `runMeetingOverseerExtraction(...)` with optional context payloads:
   - qualification summary
   - conversation summary
   - business/service summary
3. Updated extraction prompt to enforce fail-closed behavior for unclear qualification/time grounding.
4. Added normalization and cache-compat checks for newly required schema keys.
5. In `processMessageForAutoBooking(...)`, enforced preconditions before booking attempts:
   - `intent_to_book === true`
   - `qualification_status === "qualified"`
   - `time_from_body_only === true`
6. Added clarification/failure handling when qualification or body-grounding checks fail.

## Validation (RED TEAM)

- `npx eslint lib/meeting-overseer.ts lib/followup-engine.ts` passed.
- Targeted tests (`followup-booking-signal`, `followup-generic-acceptance`) passed in run.
- Code-path RED TEAM review confirmed body-grounding gate now applies to:
  - `accept_offered`
  - `proposed_time`
  - `day_only`

## Output

- Qualification-aware overseer extraction and preconditioned booking decisions are enforced.
- Auto-booking context now records qualification outcomes and body-grounding failures.
- Existing blocked-sentiment and booking-gate protections remain intact.

## Handoff

Proceed to 138d for no-double-send pipeline coordination and draft scheduling-awareness wiring across all runtime pipelines.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Completed overseer schema/prompt upgrades and qualification/time gating.
  - Closed RED TEAM gap: `accept_offered` now checks `time_from_body_only`.
- Commands run:
  - `npx eslint lib/meeting-overseer.ts lib/followup-engine.ts` — pass.
  - `npm test -- lib/__tests__/followup-generic-acceptance.test.ts lib/__tests__/followup-booking-signal.test.ts lib/__tests__/followup-engine-dayonly-slot.test.ts` — pass.
- Blockers:
  - Missing dedicated unit test that explicitly exercises `accept_offered + !time_from_body_only` fail-closed path (tracked in 138f).
- Next concrete steps:
  - Add explicit fail-closed tests for signature/footer timing leakage scenarios in 138f.
