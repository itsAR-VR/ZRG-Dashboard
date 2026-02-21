# Phase 179b — Fix: Sentiment/Route Invariants (Webhook-only Meeting Booked, AI Campaign Gating, Lead Calendar Link -> Process 5)

## Focus
Eliminate the highest trust-killing failures:
1. `Meeting Booked` from text-only inbound messages
2. Auto-sends for non-AI campaigns
3. Incorrect handling of lead-provided calendar links

## Inputs
- Phase 179a root-cause matrix + repro IDs
- Existing booking router work from Phase 177/178 (Process 4/5)
- Existing sentiment classifier prompt + mapping logic

## Work
1. `Meeting Booked` invariant:
   - Enforce: sentiment `Meeting Booked` can only be set when an Appointment/booking record exists (webhook/appointment-backed).
   - If classifier returns `Meeting Booked` without appointment evidence:
     - downgrade to `Meeting Requested` (or `Interested` when appropriate).
2. Campaign gating invariant:
   - Enforce: auto-send is only allowed when campaign response mode is `AI_AUTO_SEND`.
   - For setter-managed campaigns:
     - drafts may still be generated, but must not be auto-sent.
3. Lead-provided calendar link handling:
   - Detect when inbound includes an external scheduling link that is not our workspace link.
   - Route to Booking Process 5 and send Slack notification (manual handling).
   - Ensure we do not respond with “we’ll grab/book a time” language.
4. Update prompts/routing heuristics where needed:
   - Reduce misclassification of scheduling windows (e.g., “week of March 2nd”) as `Follow Up`.
   - Reduce misclassification of “call me after X” as booked.

## Output
- Code changes implementing invariants + tests/fixtures for:
  - false meeting booked prevention
  - non-AI campaign auto-send block
  - lead calendar link -> Process 5 routing

## Handoff
Phase 179c should focus on follow-up timing clarifier auto-send reliability + draft quality, assuming Phase 179b fixes are in place and validated on repro cases.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented a provider-evidence gate for text-only `Meeting Booked`:
    - Added `coerceMeetingBookedSentimentToEvidence(...)` which downgrades to `Meeting Requested` unless provider IDs exist or an `Appointment` row exists with `status != CANCELED`.
    - Applied gate in all major sentiment write paths (email pipeline + email/SMS/LinkedIn inbound post-process jobs).
  - Updated sentiment prompts so “book via THEIR scheduling link” is treated as `Meeting Requested` (manual booking flow), not `Meeting Booked`.
  - Removed unsafe `defaultAvailabilityText` guidance that instructed the model to assume a time is available and classify as `Meeting Booked`.
  - Added a hard-block in AI auto-send so Booking Process 5 / external calendar signals never auto-send (manual-only).
- Commands run:
  - `rg -n "Meeting Booked" ...` — confirmed prompt + lifecycle references before edits
- Blockers:
  - None yet (validation not run in this subphase).
- Next concrete steps:
  - Finish Phase 179f follow-up timing due-processor reliability + Attempt #2 booking link enforcement (some implemented; validate and add tests).
  - Run Phase 179d NTTAN gates using `docs/planning/phase-179/replay-case-manifest.json`.
