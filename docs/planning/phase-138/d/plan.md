# Phase 138d — Pipeline Coordination + Draft Scheduling Awareness (All Runtime Pipelines)

## Focus

Prevent contradictory double-sends and make drafts scheduling-aware across all runtime inbound processors.

## Inputs

- `AutoBookingContext` from 138a
- Qualification-aware outcomes from 138c
- Runtime pipeline files:
  - `lib/inbound-post-process/pipeline.ts`
  - `lib/background-jobs/email-inbound-post-process.ts`
  - `lib/background-jobs/sms-inbound-post-process.ts`
  - `lib/background-jobs/linkedin-inbound-post-process.ts`
- `lib/ai-drafts.ts`

## Pre-Flight Conflict Check

- [x] Re-read all four runtime pipeline draft-generation blocks.
- [x] Re-read `DraftGenerationOptions` and scheduling prompt assembly in `lib/ai-drafts.ts`.
- [x] Merge changes around active overlaps in `lib/ai-drafts.ts` (phases 137/139/140) without touching unrelated pricing/UI regions.

## Work

1. Added scheduling-handled guard in all 4 runtime pipelines:
   - `schedulingHandled = Boolean(autoBook.context?.followUpTaskCreated)`
   - skip draft generation when scheduling already handled.
2. Extended `DraftGenerationOptions` with:
   - `autoBookingContext?: AutoBookingContext | null`
3. Passed `autoBookingContext` from all 4 runtime pipelines into `generateResponseDraft(...)`.
4. Injected scheduling-aware appendix in draft prompts when context exists:
   - includes failure reason/intent summary
   - disallows "we'll call" wording unless explicitly requested
5. Enriched meeting-overseer gate memory context with auto-booking summary.
6. Closed RED TEAM gap in email background pipeline:
   - non-auto-book branch now returns full fallback `AutoBookingContext` instead of `{ booked: false }`.

## Validation (RED TEAM)

- `npx eslint lib/ai-drafts.ts lib/inbound-post-process/pipeline.ts lib/background-jobs/email-inbound-post-process.ts lib/background-jobs/sms-inbound-post-process.ts lib/background-jobs/linkedin-inbound-post-process.ts` passed.
- Runtime-path inventory verified all 4 pipelines contain suppression and context passthrough.
- Targeted test suite run passed (332/332).

## Output

- Double-send suppression enforced uniformly in all runtime inbound processors.
- Draft generation is scheduling-aware wherever it runs.
- Email background-job fallback now preserves context parity with other pipelines.

## Handoff

Proceed to 138e for coordination hardening, residual coverage closure, and quality-gate documentation.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Completed pipeline suppression/context wiring in all runtime processors.
  - Added fallback context in email background pipeline to prevent null-context drift.
- Commands run:
  - `npx eslint ...` (all phase-138 runtime files + `lib/ai-drafts.ts`) — pass.
  - `npm test -- lib/__tests__/followup-generic-acceptance.test.ts lib/__tests__/followup-booking-signal.test.ts lib/__tests__/followup-engine-dayonly-slot.test.ts` — pass.
- Blockers:
  - None in 138d scope.
- Next concrete steps:
  - Close remaining test and build-gate blockers in 138e/138f.
