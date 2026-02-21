# Phase 181a — Contract + Data Mapping for Future-Window Deferral

## Focus
Define the exact decision contract and data dependencies for classifying future-window scheduling requests vs normal clarifiers.

## Inputs
- `docs/planning/phase-181/plan.md`
- Existing timing extraction + clarify logic:
  - `lib/followup-timing-extractor.ts`
  - `lib/followup-timing.ts`
  - `lib/meeting-overseer.ts`
- Availability coverage sources:
  - `lib/availability-cache.ts`
  - `lib/availability-format.ts`
  - booking link resolver in existing scheduling flow

## Work
1. Define decision-contract extensions for scheduling extraction (for example):
   - `responseMode = "defer_until_window"`
   - `requestedWindowStart`, `requestedWindowEnd`, `windowSpecificity`, `isWindowParseable`
   - `availabilityCoverageMaxDate`, `isBeyondCoverage`
2. Specify parse rules for broad windows:
   - "mid-March", "second week of March", "next quarter", "after Q2".
3. Specify fallback rules:
   - unparseable broad intent => clarifier-only (no deferred task).
   - availability fetch failure => fallback defer + retry workflow.
4. Define normalized metadata shape stored with task/draft artifacts to support audit + replay.

## Output
- Decision-complete contract spec for deferral classification and horizon comparison.
- Target file list + function-level change map for implementation subphases.

## Handoff
Phase 181b implements contract-aware extraction + overseer behavior with deterministic gates and no regressions to existing booking/manual-only invariants.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Finalized contract shape already exposed by extractor for future windows (`hasFutureWindow`, `futureWindowStartDate`, `futureWindowEndDate`, `futureWindowLabel`).
  - Mapped runtime dependencies required by the contract in scheduler path:
    - availability coverage max via `getWorkspaceAvailabilitySlotsUtc(... refreshIfStale: true)`,
    - booking link resolution via `getBookingLink(...)`,
    - retry queueing via availability cache stale-at forcing.
- Commands run:
  - Code implementation pass in `lib/followup-timing.ts`.
- Blockers:
  - none
- Next concrete steps:
  - Keep contract assertions synchronized with replay fixtures in phase 181f.
