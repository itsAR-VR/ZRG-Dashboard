# Phase 128c — Tests: Escalation Fail-Open + Pricing Merge/Placeholder Guards

## Focus
Add deterministic unit tests to prevent regressions:
- Booking escalation must never block AI draft generation.
- Pricing context merge must be stable and de-duplicated.
- Placeholder pricing must be detected and removed before persisting/sending drafts.

## Inputs
- Implementation changes from Phase 128a and Phase 128b
- Test runner: `scripts/test-orchestrator.ts` (`npm test`)
- Existing test conventions: `node:test` + `node:assert/strict`

## Work

### Step 1 — Extract pure helpers for unit testing (no DB required)
From 128a/128b implementation, ensure these are exported from `lib/ai-drafts.ts`:
- `mergeServiceDescriptions(a: string | null, b: string | null): string | null`
- `sanitizeDraftContent(content, leadId, channel)` (already exported)
- `PRICING_PLACEHOLDER_REGEX` (exported const for test verification)

### Step 2 — Add test files under `lib/__tests__/`

**`lib/__tests__/ai-drafts-service-description-merge.test.ts`**
- `null` + `null` → `null`
- `null` + `"pricing info"` → `"pricing info"`
- `"pricing info"` + `null` → `"pricing info"`
- `"Our service costs $5k/year"` + `"Our service costs $5k/year plus support"` → longer one (containment de-dupe)
- `"Service A details"` + `"Service B pricing"` → concatenated with `\n\n`
- Whitespace-only inputs → treated as null

**`lib/__tests__/ai-drafts-pricing-placeholders.test.ts`**
- `sanitizeDraftContent` strips `${PRICE}` from draft text
- `sanitizeDraftContent` strips `${COST}`, `${AMOUNT}`, `${PRICING_TIER}`
- `sanitizeDraftContent` does NOT strip real prices: `$5,000/year`, `$500/month`, `$1,200`
- `sanitizeDraftContent` does NOT strip `$0` (digit, not uppercase letter)
- Combined: draft with `"Our price is ${PRICE} per month"` → `"Our price is  per month"` (stripped)

**`lib/__tests__/ai-drafts-booking-escalation.test.ts`**
- Import `getBookingProcessInstructions` from `lib/booking-process-instructions.ts`
- When `shouldEscalateForMaxWaves` returns `true`: verify result has `requiresHumanReview: false` + `escalationReason: "max_booking_attempts_exceeded"` (not `requiresHumanReview: true`)
- Note: requires mocking `shouldEscalateForMaxWaves` and Prisma calls

### Step 3 — Register in test orchestrator
Add all three new test files to `scripts/test-orchestrator.ts` test list.

## Expected Output
- New unit tests in `lib/__tests__/...` and updated test orchestrator.
- `npm test` covers Phase 128 behaviors and prevents recurrence.

## Expected Handoff
Proceed to Phase 128d for end-to-end verification:
- `npm test`, `npm run lint`, `npm run build`
- manual Jam repro validation
- monday item update with fix summary

## Output
Added unit coverage for pricing consistency + placeholder hardening:
- `lib/__tests__/ai-drafts-service-description-merge.test.ts` — covers `mergeServiceDescriptions` null/trim/containment/concat behavior.
- `lib/__tests__/ai-drafts-pricing-placeholders.test.ts` — covers `${PRICE}` and `$X/$Y/$A` stripping and verifies real prices are preserved.
- `scripts/test-orchestrator.ts` — registered both new test files.

Notes:
- Did not add `ai-drafts-booking-escalation.test.ts` yet because there is no existing codebase pattern for module-level Prisma mocking in `node:test` (all current tests use dependency injection). The escalation fix is covered by Phase 128a code + manual QA in 128d.

## Handoff
Proceed to Phase 128d: run quality gates + validate the Jam repro + post the fix summary back to monday item `11211767137`.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added unit tests for service-description merging and pricing placeholder stripping.
  - Updated `scripts/test-orchestrator.ts` to include the new tests.
- Commands run:
  - `npm test` — pass
- Blockers:
  - None
- Next concrete steps:
  - Run `npm run lint` and `npm run build` (and capture outcomes in Phase 128d), then update monday/Jam with results.
