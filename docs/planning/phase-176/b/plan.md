# Phase 176b — Meeting Scheduler: Window Mismatch => Link-Only + Reschedule Support

## Focus
Fix meeting scheduling/rescheduling so that explicit requested windows are honored. If no offered slots match, we must reply link-only (and never propose out-of-window or previously offered slots).

## Inputs
* Phase 176a: identified failure points + code locations.
* Jam + Supabase example IDs from Phase 176 root context.

## Work
1. Runtime drafting:
   - Ensure “requested windows” extraction supports:
     - explicit windows (date ranges + time ranges),
     - week-of-month semantics (“2nd week of March” = Mon–Sun),
     - multiple windows (union).
   - If extraction yields windows and no offered slot matches, force link-only response.
   - Likely touch points:
     - `lib/ai/prompt-registry.ts` (meeting overseer extract/gate instructions so windows are explicit + enforce link-only fallback)
     - `lib/ai-drafts.ts` (meeting draft generation behavior; ensure windows are passed through and enforced)
2. Revision loop hardening:
   - Add/extend hard constraints so revisions cannot “fix” a mismatch by suggesting other times; must choose an offered slot inside windows or link-only.
   - Likely touch points:
     - `lib/auto-send/revision-constraints.ts` (detect window constraints incl. “2nd week of March”)
     - `lib/auto-send/orchestrator.ts` (ensure post-AI invariant failures trigger revision loop for scheduling mismatch vs “needs_review”)
     - `lib/ai-replay/invariants.ts` (confirm invariant classification matches the new policy)
3. Reschedule semantics:
   - Detect reschedule intent (“move meeting”, “can we move 11:30 to 10:45”) and treat the lead’s alternative windows as hard constraints.
   - Likely touch points:
     - `lib/followup-engine.ts` (meeting overseer contract handling currently treats `intent === "reschedule"` as fail-closed; adjust to treat reschedule as scheduling-related and still enforce window/link-only policy)
4. Non-repetition:
   - Ensure offered-slot ledger exclusions apply to reschedule flows (no re-offering prior slots unless explicitly requested/accepted).
   - Likely touch points:
     - `lib/slot-offer-ledger.ts` / `lib/availability-distribution.ts` (or wherever “previously offered” is tracked)
     - `lib/ai-drafts.ts` (ensure exclusion applies to reschedule as well as first-time scheduling)

## Output
## Changes (implemented)
1. Revision loop hardening:
   - Extended window-preference detection to include “Nth week of <month>” (Mon–Sun semantics).
   - Added week-of-month matching against `OfferedSlot.datetime` (UTC-based) so the revision loop can determine whether any offered slot is actually in-window.
   - Enforced **link-only** behavior when no offered slot matches the requested window:
     - draft must include a known scheduling link, and
     - draft must not propose any times.
   - Files:
     - `lib/auto-send/revision-constraints.ts`

## Handoff
Proceed to Phase 176c:
1) ensure scheduling-created `FollowUpTask` always yields an inbox-visible `AIDraft` (no dead-end “draft skipped” routing), and
2) add objection routing so competitor/“already have X” does not go into follow-up timing clarify loops.
