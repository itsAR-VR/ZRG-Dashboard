# Phase 145b — Booking Orchestration + Timezone-Safe Execution

## Focus

Implement booking-first orchestration after extraction contract outputs, including lead-timezone rendering and nearest-slot policy.

## Inputs

- `docs/planning/phase-145/a/plan.md`
- Booking/time surfaces:
  - `lib/followup-engine.ts`
  - `lib/booking.ts`
  - `lib/availability-distribution.ts`
  - `lib/timezone-inference.ts`

## Coordination Pre-Flight (Mandatory)

- Run `git status --short` before edits and note unexpected changes.
- Re-read latest versions of:
  - `lib/followup-engine.ts`
  - `lib/booking.ts`
  - `lib/availability-distribution.ts`
  - `lib/timezone-inference.ts`
- If overlap with active phases is detected, merge by symbol and record conflict notes in subphase progress.

## Merge Awareness (RED TEAM)

`lib/ai-drafts.ts` is a **6-phase hot spot** (phases 135, 138, 139, 140, 141, 143). Always read current file state before editing. Prefer factoring new execution logic into `lib/ai/decision-contract.ts` or a new `lib/ai/booking-orchestrator.ts` to minimize merge surface on `ai-drafts.ts`.

## Work

1. Add execution router that branches on `responseMode` (from 145a's contract) and `shouldBookNow`.
   - Integration point: `responseMode` is consumed as a pre-draft parameter in `generateResponseDraft()` or as a gate before draft generation. Specify: add `responseMode` to `DraftGenerationOptions` and branch inside `generateResponseDraft()`.
2. Enforce lead-timezone-only display for outbound time options.
3. Implement nearest-slot policy — **extending** existing `AutoBookingMatchStrategy` (`lib/followup-engine.ts`):
   - Existing strategies: `"exact" | "nearest" | "nearest_tie_later"`.
   - Add threshold parameters: `nearestAutoHoldMaxMinutes: 15`, `nearestOfferFallbackMinutes: 25`.
   - Exact match first → if nearest within +15min: auto-hold + confirm → else offer nearest 2 options.
4. Enforce no re-qualification when `isQualified=yes`.
5. Enforce pricing/community inclusion only when explicitly requested by extracted flags.

## Edge Cases

- Lead supplies window in local terms without explicit timezone.
- DST transition days and date boundary crossings.
- Suggested slot already passed at execution time.
- Conflicting calendar availability vs requested window.

## Validation

- Unit tests for slot policy matrix (+0/+10/+15/+16/+30 minute scenarios).
- Unit tests for timezone formatting output.
- Unit tests for `responseMode` branching in draft generation.
- Replay fixture assertions for `59dc` behavior.
- `npm run lint`, `npm run build`, `npm run test`
- `npm run test:ai-drafts`
- `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
- `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`

## Output

- Booking-first responses align with lead intent/timezone.
- No extra selling/re-qualification when booking intent is clear.

## Handoff

145c applies process-specific handoff behavior for P4/P5 and notification flows.

## Progress This Turn (Terminus Maximus)

- Implemented `decision_contract_v1`-first execution in `processMessageForAutoBooking`:
  - fail-closed when `decision_contract_status=decision_error`,
  - primary booking/qualification gates now use `hasBookingIntent`, `shouldBookNow`, `isQualified`,
  - timezone updates now prioritize contract `leadTimezone` when valid.
- Implemented nearest-slot execution policy in `lib/followup-engine.ts`:
  - exact still preferred,
  - nearest auto-book now restricted to **after** requested time and within `AUTO_BOOK_NEAREST_AUTO_HOLD_MAX_MINUTES` (default 15),
  - otherwise propose nearest alternatives within `AUTO_BOOK_NEAREST_OFFER_FALLBACK_MINUTES` (default 25) before distributed fallbacks.
- Added booking-first/voice/timezone prompt tightening:
  - `lib/ai-drafts.ts` generation and strategy prompts now explicitly enforce booking-first behavior, no redundant re-qualification, and single-timezone scheduling options.
  - `lib/meeting-overseer.ts` gate prompt now enforces `decision_contract_v1.shouldBookNow` behavior and no extra selling in booking-only flows.

Validation this turn:
- `npm run lint` ✅ (warnings only)
- `npm run build` ✅
- `npm run test` ✅
- `npm run test:ai-drafts` ✅
- `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20` ✅ (preflight schema warning, non-blocking for dry-run)
- `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3` ❌ (blocked by preflight schema drift)

Open blocker:
- Runtime DB is missing `WorkspaceSettings.aiRouteBookingProcessEnabled`, which blocks live replay generation paths (`P2022` class).

Progress update (2026-02-12 07:05 UTC):
- Cleared the above blocker with `npm run db:push`; live replay now runs end-to-end with real model generations.
- Added timezone-hardening changes:
  - `ensureLeadTimezone` now gives priority to explicit inbound conversation timezone signals over stale saved timezone (`lib/timezone-inference.ts`).
  - draft generation now loads latest inbound body (channel-scoped) when trigger context is absent, so timezone inference still has fresh message text (`lib/ai-drafts.ts`).
- Tightened booking-first prompt enforcement for remaining critical failures:
  - scheduling-only language strengthened (especially for lead-provided scheduling links / concrete windows),
  - explicit-question coverage requirement added (pricing/frequency/location),
  - repeat-qualification avoidance strengthened when lead already confirmed threshold,
  - mirrored in meeting-overseer gate rules.
- Replay outcomes:
  - `run-2026-02-12T06-51-35-686Z.json`: evaluated=8, passed=2
  - `run-2026-02-12T07-00-06-514Z.json`: evaluated=7, passed=1 (intermediate after timezone patch)
  - `run-2026-02-12T07-03-11-855Z.json`: evaluated=7, passed=3, core `2a70...` now pass
- Remaining open in this subphase:
  - `59dc...` still violates strict booking-window and anti-selling constraints under replay,
  - `bfb...` still misses strict required pricing/qualification phrasing policy.
