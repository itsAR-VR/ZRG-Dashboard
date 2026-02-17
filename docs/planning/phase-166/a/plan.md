# Phase 166a — Policy Spec + Case Catalog

## Focus
Turn the desired “direct booking for window intent” behavior into an explicit policy spec and a small set of canonical cases we can test/replay.

## Inputs
- Phase 162: slot-confirmation correctness and offered-slots “source of truth” model.
- Replay mismatch pattern: lead proposes a specific time inside a broader window (e.g., “Wed morning at 8:30”) but offered availability has different times.
- Runtime components: meeting overseer decision contract (`leadProposedWindows`, `preferred_day_of_week`, `preferred_time_of_day`) and `offeredSlots`.

## Work
- Write a concise policy spec for:
  - window-only (day + morning/afternoon/evening),
  - explicit ranges (e.g., “12–3pm”),
  - relative preferences (“next week”, “tomorrow”),
  - lead-provided scheduler links (never offer our slots).
- Define the slot selection rule:
  - pick exactly one best-matching offered slot inside the requested window,
  - if none exists, use known scheduling link fallback (no out-of-window confirmations).
- Define copy requirements:
  - include the selected slot label verbatim,
  - include reschedule guidance (“If that time doesn't work, let me know or feel free to reschedule using the calendar invite.”).
- Enumerate 6–10 canonical cases to cover in unit tests and ai-replay selection.

## Output
- Canonical case list and a single-page policy summary referenced from `docs/planning/phase-166/plan.md`.

## Handoff
- Phase 166b uses these cases to verify runtime slot matching and add/adjust unit tests.

