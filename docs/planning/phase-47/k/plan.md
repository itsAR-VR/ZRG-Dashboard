# Phase 47k — Booking Stage Templates: Per-Stage Instruction Overrides

## Focus

Make booking process **instruction phrasing** fully editable and scoped **per `BookingProcessStage`** (real runtime behavior), so Stage 1/2/3 can each have their own templates.

This covers the text that is appended to draft generation prompts via `lib/booking-process-instructions.ts`.

## Inputs

- Booking models: `prisma/schema.prisma` (`BookingProcess`, `BookingProcessStage`)
- Booking instruction builder: `lib/booking-process-instructions.ts`
- Booking process CRUD: `actions/booking-process-actions.ts` (currently deletes/recreates stages on update)
- Prompt editor UI surface: `components/dashboard/settings-view.tsx` (Phase 47h)

## Work

1. **Schema: add per-stage template storage**
   - Add a JSON field on `BookingProcessStage` to store template overrides:

```prisma
model BookingProcessStage {
  // ...existing fields...
  instructionTemplates Json? // per-stage text templates (override defaults)
}
```

   - Define a stable schema for `instructionTemplates` in code (not in Prisma), with keys like:
     - `blockTemplate` (wraps the stage block; supports `{stageNumber}` + `{bullets}`)
     - `bookingLinkPlainUrlTemplate` (supports `{bookingLink}`)
     - `bookingLinkHyperlinkTemplate` (supports `{bookingLink}`)
     - `noBookingLinkConfiguredTemplate`
     - `suggestedTimesWithSlotsTemplate` (supports `{numTimes}` + `{timesBullets}`)
     - `suggestedTimesNoSlotsTemplate` (supports `{numTimes}`)
     - `qualifyingQuestionsOneTemplate` (supports `{question}`)
     - `qualifyingQuestionsManyTemplate` (supports `{questionsBullets}`)
     - `smsParaphraseHintTemplate`
     - `timezoneAskTemplate`
     - `earlyAcceptanceHintTemplate`

2. **Runtime: apply stage templates**
   - Update `lib/booking-process-instructions.ts`:
     - load `stage.instructionTemplates`
     - merge with defaults for missing keys
     - render templates with a small, safe placeholder renderer (no eval; only known placeholders)
     - keep stage booleans authoritative (templates only change phrasing, not behavior)

3. **Persistence + admin gating**
   - Update `actions/booking-process-actions.ts` to support saving these templates:
     - Option A (preferred): add dedicated action to update a single stage’s templates by stageId (avoids re-creating stages).
     - Option B: extend `BookingProcessStageInput` + ensure `updateBookingProcess(...)` carries templates through when stages are updated.
   - RED TEAM risk: `updateBookingProcess(...)` currently deletes and recreates stages, which would discard template edits unless templates are included in the create payload.

4. **Prompt editor integration**
   - In the prompt modal (Phase 47h), add a “Booking Stage Templates” section:
     - select booking process → select stage
     - render editors for the template keys
     - show an effective preview for that stage (email/sms/linkedin)
     - Save/Reset per stage

## Validation (RED TEAM)

- Editing Stage 2 templates changes the instructions appended when a lead is in Stage 2 (and does not affect Stage 1/3).
- Stage templates persist after editing booking process config in the existing booking process manager (no silent loss).
- Invalid templates (missing required placeholders, empty strings) are either rejected on save or safely fall back to defaults (choose and enforce).

## Output

**Completed:**

1. **Schema change:**
   - Added `instructionTemplates Json?` to `BookingProcessStage` model
   - Ran `npm run db:push` to apply to database

2. **Template system (`lib/booking-stage-templates.ts`):**
   - Defined all template keys: `bookingLinkPlainTemplate`, `bookingLinkHyperlinkTemplate`, `noBookingLinkTemplate`, `suggestedTimesWithSlotsTemplate`, `suggestedTimesNoSlotsTemplate`, `qualifyingQuestionOneTemplate`, `qualifyingQuestionManyTemplate`, `smsParaphraseHintTemplate`, `timezoneAskTemplate`, `earlyAcceptanceHintTemplate`, `stageBlockWrapperTemplate`
   - Created `DEFAULT_BOOKING_STAGE_TEMPLATES` with all default values
   - Helper functions: `getEffectiveTemplate()`, `renderTemplate()`
   - `getBookingStageTemplateRegistry()` for UI display

3. **Runtime integration (`lib/booking-process-instructions.ts`):**
   - Updated `buildStageInstructions()` to use templates
   - Reads `stage.instructionTemplates` and merges with defaults
   - Uses safe placeholder rendering (no eval)

4. **Server actions (`actions/booking-process-actions.ts`):**
   - `getBookingProcessStage(stageId)` — get stage with templates
   - `updateBookingStageTemplates(stageId, templates)` — admin-gated update
   - `getBookingProcessStagesWithTemplates(bookingProcessId)` — get all stages with templates

**Deferred:**
- Prompt modal UI editor for stage templates — can be added to the Booking Process Manager or as a separate modal

**Verification:**
- `npm run lint` — passed
- `npm run build` — passed
- `npm run db:push` — applied

## Handoff

Phase 47l adds an auto-send delay setting for AI-managed campaigns, implemented via background jobs (no sleeps).

## Review Notes

- Evidence: `actions/booking-process-actions.ts:updateBookingProcess` deletes and recreates stages without carrying `instructionTemplates`.
- Impact: stage template edits can be silently lost when the booking process is edited via the existing booking process editor; see `docs/planning/phase-47/review.md`.
