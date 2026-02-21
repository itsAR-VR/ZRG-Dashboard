# Phase 181b — Extraction/Overseer Logic: Introduce `defer_until_window` Decision Path

## Focus
Implement classification logic so broad future windows deterministically enter deferred mode when beyond availability coverage.

## Inputs
- Output from Phase 181a.
- Existing scheduling extraction + judge contracts:
  - `lib/meeting-overseer.ts`
  - `lib/ai-replay/run-case.ts`
  - prompt/contract helpers used by draft generation.

## Work
1. Add/propagate `defer_until_window` in extraction decision contract.
2. Compute `isBeyondCoverage` from live/cache coverage max date at decision time.
3. Enforce rule: parseable future window + beyond coverage => deferral mode (no exact-time ask now).
4. Keep existing rules intact for:
   - Process 5 external scheduler link manual-only behavior.
   - Exact-time acceptance and booking confirmation semantics.
   - Clarifier-only behavior for unparseable windows.
5. Update overseer/judge guidance so deferral replies are valid/approvable when conditions match.

## Output
- Deferral mode routed deterministically by extraction/overseer with explicit horizon checks.
- Replay/judge contract alignment to prevent false `draft_quality_error` for valid deferral replies.

## Handoff
Phase 181c implements final message generation rules per channel for deferral mode.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added deterministic `defer_until_window` routing in `scheduleFollowUpTimingFromInbound` when:
    - inbound has parseable future window start, and
    - window start is beyond availability coverage max (or coverage unavailable).
  - Preserved existing non-deferral behavior:
    - no-date clarifier path remains active for unparseable/within-coverage cases,
    - process-5/manual-only invariants remain untouched.
  - Added failure-safe branch for future-window call-only leads (`future_window_requires_message_channel`).
- Commands run:
  - Code implementation pass in `lib/followup-timing.ts`.
- Blockers:
  - none
- Next concrete steps:
  - Replay validation for judge behavior in phase 181f.
