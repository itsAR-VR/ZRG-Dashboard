# Phase 131b — Add Objection Sentiment + Response Type Derivation

## Focus
Add a new sentiment label (`Objection`) and define a deterministic response-type taxonomy for CRM analytics so users can quickly see “what kind of reply we got” in the selected window.

## Inputs
- Existing sentiment taxonomy and mappings in `lib/sentiment-shared.ts` and classifier prompt in `lib/ai/prompts/sentiment-classify-v1.ts`.
- Existing snooze signal (`Lead.snoozedUntil`) and follow-up logic used elsewhere (`lib/snooze-detection.ts`).
- Existing response-mode attribution helper `deriveCrmResponseMode()` in `lib/crm-sheet-utils.ts`.

## Work
1. Add sentiment label across **all 5 hardcode locations** (RED TEAM verified):
   a. `lib/sentiment-shared.ts` (lines 4-18, 23-37):
      - Add `"Objection"` to `SENTIMENT_TAGS` array (after "Follow Up", before "Not Interested" — matches classifier priority).
      - Add `Objection: "new"` to `SENTIMENT_TO_STATUS` (conservative — does NOT auto-qualify).
      - Do NOT add to `POSITIVE_SENTIMENTS` (objection is not positive).
   b. `lib/ai/prompts/sentiment-classify-v1.ts` (lines 26, 28-41):
      - Add "Objection" category definition: "The prospect raises a specific concern, pushback, or disagreement about the product, service, price, timing, or approach — but has NOT explicitly refused all future contact. Distinct from Not Interested (hard decline) and Follow Up (defers without pushback)."
      - Update priority order to: `...Follow Up > Objection > Not Interested...`
   c. `lib/inbound-post-process/pipeline.ts` (lines 36-59):
      - Add `case "Objection": return "Objection";` to `mapInboxClassificationToSentimentTag()` switch statement.
      - Place before the `default` case. Do NOT modify the Phase 130 campaign fetch region (lines 120-127).
   d. `lib/sentiment.ts` (4 spots):
      - Line 289: Add `| "Objection"` to `EmailInboxClassification` type union.
      - Line 409: Add `"Objection"` to `allowed_categories` array.
      - Line 533: Add `"Objection"` to schema enum array.
      - Line 589: Add `"Objection"` to validation allowed list.
   e. `lib/crm-sheet-utils.ts` (lines 20-28):
      - Add `if (normalized === "objection") return "Objection";` to `mapSentimentTagFromSheet()`.
   **NOT updated** (per user decision): `lib/auto-reply-gate.ts`, `lib/auto-send-evaluator.ts` — AI handles objections without hard block.
2. Define response type taxonomy (pure function, no DB writes):
   - Add a deterministic derivation (e.g. `deriveCrmResponseType(...)`) in `lib/crm-sheet-utils.ts` that classifies a lead into:
     - `MEETING_REQUEST` (sentimentTag is Meeting Requested / Call Requested / Meeting Booked, OR `Lead.appointmentBookedAt` is non-null)
     - `INFORMATION_REQUEST` (sentimentTag is Information Requested)
     - `FOLLOW_UP_FUTURE` (sentimentTag is Follow Up AND `Lead.snoozedUntil` is in the future)
     - `OBJECTION` (sentimentTag is Objection)
     - `OTHER` (fallback for all other sentiments)
   - Ensure derivation is stable and serializable (string enum union, not a Prisma enum).
   - Input shape: `{ sentimentTag: string | null; snoozedUntil: Date | null; appointmentBookedAt: Date | null }`.
3. Surface response type in CRM row shape:
   - Extend `CrmSheetRow` interface in `actions/analytics-actions.ts` to include `responseType: CrmResponseType | null` (computed).
   - Compute in the row mapping logic (near line 1995) using `deriveCrmResponseType()` with data already selected.

## Output
- The system can label a lead’s “response type” deterministically for analytics and filtering.
- Sentiment classifier can output `Objection`, and ingestion/post-process preserves it.

## Validation (RED TEAM)

- After all 5 locations updated, run `npm run build` — TypeScript must compile with no errors (the `as const` assertion on `SENTIMENT_TAGS` will catch any mismatched strings).
- Verify: `mapInboxClassificationToSentimentTag("Objection")` returns `"Objection"` (not `"Neutral"` from default case).
- Verify: `deriveCrmResponseType({ sentimentTag: "Objection", snoozedUntil: null, appointmentBookedAt: null })` returns `"OBJECTION"`.
- Verify: `deriveCrmResponseType({ sentimentTag: "Follow Up", snoozedUntil: futureDate, appointmentBookedAt: null })` returns `"FOLLOW_UP_FUTURE"`.
- Verify: `deriveCrmResponseType({ sentimentTag: "Follow Up", snoozedUntil: null, appointmentBookedAt: null })` returns `"OTHER"` (Follow Up without snooze = not a future follow-up).

## Handoff
- Phase 131c will use the same `deriveCrmResponseType()` function in server-side aggregates so breakdowns match the table exactly.
- Phase 131c must use `Lead.appointmentBookedAt` and `Lead.ghlAppointmentId` for booking evidence (NOT on LeadCrmRow).

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added `Objection` sentiment across the shared taxonomy, classifier prompts, and inbound pipeline mapping.
  - Added deterministic CRM response-type derivation (`MEETING_REQUEST`, `INFORMATION_REQUEST`, `FOLLOW_UP_FUTURE`, `OBJECTION`, `OTHER`) and surfaced it on CRM rows.
- Commands run:
  - See Phase 131e (quality gates)
- Blockers:
  - None
- Next concrete steps:
  - None (handoff complete)
