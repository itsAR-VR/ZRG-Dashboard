# Phase 166b — Runtime Slot Selection Hardening

## Focus
Ensure runtime draft generation deterministically matches window intent to a real offered slot (or link) so drafts never confirm unavailable times.

## Inputs
- Policy + cases from Phase 166a.
- Availability + offered-slots pipeline in `lib/ai-drafts.ts`.
- Preference helper `selectOfferedSlotByPreference()` (meeting overseer).

## Work
- Verify the runtime guard executes post-overseer gate and has access to:
  - `availability` labels
  - `offeredSlots` (label + datetime)
  - booking link / lead scheduler link
  - inbound `sentAt` for relative matching
- Add targeted unit tests for:
  - day + time-of-day window booking,
  - explicit range booking (“12–3pm”),
  - relative windows using a stable reference date,
  - lead-scheduler-link precedence (no slot offering).
- Confirm copy behavior:
  - slot-confirmation includes the selected slot and reschedule guidance,
  - link fallback triggers only when no window-matching slot exists.

## Output
- Runtime behavior verified with unit tests passing.

## Handoff
- Phase 166c aligns revision-agent constraints with the same policy (match slot or link fallback).

