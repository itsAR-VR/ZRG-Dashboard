# Phase 179c — Fix: Follow-Up Timing Auto-Send + Draft Quality (Grace Window, Clarifier Includes Link, 3x Token Retries)

## Focus
Make follow-up timing clarifier tasks reliably auto-send (when enabled) and produce higher quality clarifier copy that asks for a timeframe and includes the calendar link, while reducing truncation (`max_output_tokens`) failures.

## Inputs
- Phase 179a repro set focusing on:
  - `Follow-Up Timing Not Scheduled`
  - pending clarify tasks not auto-sent
  - drafts that are too generic / missing link
- Phase 175/176 clarifier + scheduling window policies

## Work
1. Due-task processor reliability:
   - Add a grace-window fix for the “recent conversation activity” gate so it does not self-block immediately after task creation.
2. Clarifier copy improvements:
   - Update timing clarifier generation to:
     - ask for timeframe (month/quarter/date)
     - include the workspace scheduling link as optional “pick a slot” escape hatch
     - keep copy AI-generated (no fully deterministic canned message)
3. Token truncation reduction (3x):
   - Increase prompt retry/output token expansion for in-scope features so `Post-process error: hit max_output_tokens` is materially reduced.
   - Ensure we do not regress cost/safety (bound by feature-level caps).

## Output
- Hardened due-task sending behavior + improved clarifier drafts
- Updated fixtures covering timing clarifier content requirements (timeframe + link)

## Handoff
Phase 179d runs NTTAN gates and verifies the repro cases no longer fail, then produces a short phase review and ships (commit/push).

