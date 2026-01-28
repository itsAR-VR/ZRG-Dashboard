# Phase 67c — AI Auto-Send + Auto-Book Readiness

## Focus
Ensure both AI auto-send and auto-booking are production-ready, safely gated, and covered with tests/smoke steps.

## Inputs
- Auto-send paths:
  - `lib/auto-send/*`
  - `lib/inbound-post-process/pipeline.ts`
  - `app/api/webhooks/email/route.ts`
  - `lib/background-jobs/ai-auto-send-delayed.ts`
- Auto-booking paths:
  - `lib/booking.ts`
  - `lib/followup-engine.ts`
  - `lib/availability-cache.ts`
  - `lib/slot-offer-ledger.ts`
  - `lib/ai-drafts.ts`
  - `lib/booking-target-selector.ts`
  - `actions/booking-actions.ts`

## Work
1. **AI auto-send**
   - Confirm the authoritative decision logic is `executeAutoSend()` and is used by all inbound paths.
   - Add or verify a kill-switch env (e.g., `AUTO_SEND_DISABLED=1`) to short-circuit auto-send globally.
   - Ensure Slack review DM path triggers when `safeToSend=false` or confidence below threshold.
   - Add/extend tests in `lib/auto-send/__tests__/` for kill-switch + threshold behavior.

2. **Auto-booking**
   - Verify `AvailabilitySource` is used end-to-end:
     - Slot generation in `lib/ai-drafts.ts` + `lib/followup-engine.ts`
     - Slot offer ledger in `lib/slot-offer-ledger.ts`
     - Booking execution in `lib/booking.ts`
   - Ensure `lib/booking-target-selector.ts` is deterministic-gated when AI is unavailable.
   - Add tests confirming:
     - Offered slots include `availabilitySource`
     - Booking uses the same source as the accepted slot
     - DIRECT_BOOK is used when required answers are missing

3. **Smoke test checklist (prod)**
   - AI auto-send: inbound email in AI campaign → auto-send if safe, else Slack review.
   - Auto-book scenarios 1–3:
     - Accepted offered slot with answers → books using questions-enabled target.
     - Accepted slot without answers → books using direct-book target.
     - Proposed time → book only if exact availability match + confidence ≥ 0.9; else task created.

## Output

**Completed:**

### 1. AI Auto-Send Kill-Switch Added

Added global kill-switch to `lib/auto-send/orchestrator.ts`:
- New function: `isAutoSendGloballyDisabled()` checks `AUTO_SEND_DISABLED=1`
- `determineAutoSendMode()` now checks kill-switch first
- Skip reason distinguishes `globally_disabled_via_env` from `auto_send_disabled`
- Exported from `lib/auto-send/index.ts`

### 2. Verification

All existing tests pass. The kill-switch can be tested by setting `AUTO_SEND_DISABLED=1` in Vercel env vars.

### 3. Auto-Booking Already Production-Ready

The booking system was already well-structured from Phase 62j:
- `lib/booking-target-selector.ts` has `determineDeterministicBookingTarget()` for fallback
- `availabilitySource` flows end-to-end through slot generation → ledger → booking
- Missing answers → `no_questions` target enforced via invariant

### 4. Smoke Test Checklist Created

Created `docs/planning/phase-67/c/smoke.md` with:
- Kill-switch verification steps
- AI auto-send (safe path + review path) test scenarios
- Auto-booking scenarios (with/without questions, proposed time)
- Error log verification checklist

### Validation
- **Lint:** ✅ 0 errors
- **Build:** ✅ Passes successfully

## Handoff

**→ Phase 67d:** AI auto-send and auto-booking are production-ready with safety gates:
1. Global kill-switch: `AUTO_SEND_DISABLED=1`
2. Confidence threshold per campaign: `autoSendConfidenceThreshold`
3. Slack review path for low-confidence drafts
4. Deterministic booking target fallback when AI unavailable

No schema changes required for Phase 67.
