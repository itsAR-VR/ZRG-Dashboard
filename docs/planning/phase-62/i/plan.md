# Phase 62i — Plan Updates: Confidence Gating + Calendly Q/A Schema + JSON Storage Choice

## Focus
Capture final decisions and verified external constraints so Phase 62 implementation is unambiguous and resilient.

## Inputs
- Verified Calendly docs via Context7:
  - `POST /invitees` supports `questions_and_answers` and each entry includes:
    - `question` (string), `answer` (string), `position` (integer)
  - Event types expose `custom_questions[]` with `name` + `position` (useful for mapping)
- Existing repo reality:
  - `lib/followup-engine.ts:parseProposedTimesFromMessage()` returns `{ proposedStartTimesUtc, confidence, needsTimezoneClarification }`
  - Scenario 3 is not implemented yet (no offered slots path in `processMessageForAutoBooking()`).

## Work
1. **Scenario 3 decision (resolved)**
   - Implement Scenario 3 as **auto-book when confidence is high** *and* availability intersects.
   - “Confidence” must not rely on model self-report alone:
     - treat model `confidence` as advisory
     - require deterministic gates:
       - `needsTimezoneClarification === false`
       - at least one proposed time parsed
       - exact availability intersection (preferred) or explicit tolerance (if we choose to support it)
     - if gates fail → create a follow-up task instead of booking.

2. **Calendly `questions_and_answers` schema (verified)**
   - Update implementation plan for `createCalendlyInvitee()` to accept:
     - `questionsAndAnswers?: Array<{ question: string; answer: string; position: number }>`
   - Determine `position` by fetching the event type’s `custom_questions` and matching by question text:
     - `custom_questions[].name` ↔ workspace question text
     - `custom_questions[].position` becomes the invitee payload `position`
   - If mapping fails (missing question or position), fall back to direct-book event type/calendar.

3. **Schema choice (resolved)**
   - Store `Lead.qualificationAnswers` as `Json?` (JSONB) rather than JSON-as-text, to support:
     - safer parsing (no `JSON.parse` failure modes)
     - easier backfills and introspection
     - future querying (even if Prisma JSON querying is limited, SQL backfills remain straightforward)
   - Recommended shape (minimal but extensible):
     - `{ [questionId: string]: string }`
   - Keep `Lead.qualificationAnswersExtractedAt` as a separate `DateTime?`.

## Validation (RED TEAM)
- [ ] Add a unit test that proves Scenario 3 will not auto-book when timezone is unknown or availability doesn’t intersect (regression guard).
- [ ] Add a unit test that proves Calendly payload includes `position` when answers are used.
- [ ] Ensure any AI “confidence” is corroborated by deterministic checks (intersection + gating); otherwise the system must degrade to “task only”.

## Output
- Phase 62 plan is locked to verified Calendly payload shape and a safer confidence gating approach.

## Handoff
Proceed with Phase 62 execution using these clarified constraints; treat this subphase as the authoritative override for earlier snippets that omitted `position` or relied on model confidence alone.

