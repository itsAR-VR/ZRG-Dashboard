# Phase 142i — Queue Processor + Disqualification Execution

## Focus

Implement timeout-safe job processing and provider-specific disqualification behavior.

## Inputs

- 142g complete (queue table + enqueue helpers)
- 142h complete (provider ingestion enqueue points)
- Existing provider utilities:
  - `lib/calendly-api.ts`
  - `lib/ghl-api.ts`
  - `lib/appointment-upsert.ts`
  - `lib/resend-email.ts`
  - `lib/system-sender.ts`

## Work

1. Add dedicated cron route:
- `app/api/cron/booking-qualification-jobs/route.ts`
- Set `maxDuration = 800`.
- Require cron auth with existing pattern.
- Use advisory lock pattern to avoid overlap.

2. Add processor:
- `lib/booking-qualification-jobs/runner.ts`
- Defaults:
  - time budget `240_000ms`
  - early-break buffer `7_500ms`
  - bounded batch size + bounded retries (maxAttempts 3)
- Job lifecycle:
  - claim pending job
  - run AI evaluation (`runStructuredJsonPrompt`)
  - branch by confidence threshold
  - mark final status and errors deterministically.

3. Implement qualification/disqualification orchestration:
- `lib/booking-qualification.ts`
- Add:
  - evaluation helper
  - cancellation helper orchestration
  - disqualification message builder (workspace template + defaults)
- Provider behavior:
  - Calendly: cancel scheduled event via API endpoint
  - GHL: cancel appointment via existing delete endpoint
- State updates:
  - lead status => `unqualified` when disqualified
  - booking qualification fields updated on all terminal paths
  - appointment rollups updated consistently
- Keep default cancellation task behavior.

4. Settings + follow-up guard final wiring:
- `actions/settings-actions.ts` + `components/dashboard/settings-view.tsx` fields finalized.
- `lib/followup-automation.ts` blocks disqualified leads from post-booking auto-start.

## Validation

1. Unit/integration tests:
- evaluation threshold behavior
- fail-open behavior on model/parse/timeouts
- provider cancellation path behavior
- status transitions + appointment rollup updates
- disqualified follow-up guard behavior

2. Command checks:
- `npm run lint`
- `npm run build`
- `npm run db:push` (if not already run after schema edits)

## Output

- Implemented processor/runtime files:
  - `lib/booking-qualification.ts`
    - `storeBookingFormAnswersOnLead(...)`
    - `extractQualificationAnswersFromGhlCustomFields(...)`
    - `evaluateBookingQualification(...)` via `runStructuredJsonPrompt`
    - `executeBookingDisqualification(...)` (Calendly cancel / GHL cancel + lead updates + notifications)
    - `markLeadBookingQualificationPending(...)` and `markLeadBookingQualified(...)`
  - `lib/booking-qualification-jobs/runner.ts`
    - stale-lock release
    - bounded claim/process loop
    - fail-open handling for uncertainty/error branches
    - bounded retries (maxAttempts respected, exponential backoff)
  - `app/api/cron/booking-qualification-jobs/route.ts`
    - cron auth
    - advisory lock guard
    - `maxDuration = 800`
  - `vercel.json`
    - added `"/api/cron/booking-qualification-jobs"` schedule (`* * * * *`)
- Implemented provider/settings/follow-up wiring:
  - `lib/calendly-api.ts`:
    - `CalendlyInvitee.questions_and_answers`
    - `cancelCalendlyScheduledEvent(...)`
  - `lib/ghl-api.ts`:
    - `GHLContact.customFields` typing
  - `actions/settings-actions.ts` + `components/dashboard/settings-view.tsx`:
    - booking qualification toggle/criteria/disqualification message fields
    - admin-gated persistence path
  - `lib/followup-automation.ts`:
    - blocks post-booking auto-start when `bookingQualificationStatus === "disqualified"`
- Added tests:
  - `lib/__tests__/booking-qualification.test.ts`
  - `lib/__tests__/booking-qualification-cron-lock.test.ts`
  - extended `lib/__tests__/calendly-invitee-questions.test.ts` for cancellation endpoint
  - included new tests in `scripts/test-orchestrator.ts`

## Progress This Turn (Terminus Maximus)
- Work done:
  - Completed queue processor/disqualification architecture and integrated all required callsites.
  - Added dedicated cron endpoint and production schedule.
  - Added targeted regression tests for helpers and lock/cancellation behavior.
  - Per-turn multi-agent checks run (`git status --short`, last-10 phase overlap scan).
  - Coordination overlap noted:
    - High overlap risk with active phases touching `actions/settings-actions.ts` and `components/dashboard/settings-view.tsx` (phases 141/144). Changes were merged surgically by symbol and limited to booking-qualification fields.
    - Build currently blocked by unrelated in-flight changes in `lib/inbound-post-process/pipeline.ts` from another phase stream.
- Commands run:
  - `npm run db:push` — pass.
  - `DATABASE_URL=... DIRECT_URL=... OPENAI_API_KEY=test node --conditions=react-server --import tsx --test lib/__tests__/booking-qualification.test.ts lib/__tests__/booking-qualification-cron-lock.test.ts lib/__tests__/calendly-invitee-questions.test.ts` — pass.
  - `npm run lint` — pass (warnings only, no errors).
  - `npm run build` — fail due unrelated pre-existing type error:
    - `lib/inbound-post-process/pipeline.ts:399` references `actionSignals` not present in `DraftGenerationOptions`.
- Blockers:
  - Global build gate blocked by external/concurrent changes outside Phase 142 scope (`lib/inbound-post-process/pipeline.ts` / `lib/inbound-post-process/types.ts`).
- Next concrete steps:
  - Resolve/merge upstream `actionSignals` typing mismatch in inbound post-process module, then rerun `npm run build`.
  - After build green, run `phase-review` and finalize phase closure.

## Handoff

- Functional Phase 142 implementation is complete.
- Remaining closure item is the global build gate after unrelated concurrent type mismatch is resolved.
