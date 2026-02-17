# Phase 167a — Error Signature Triage (Logs + Prior Phase Correlation)

## Focus
Extract and classify timeout failures from the latest exported logs, then correlate them with recent Inngest-related phase work to isolate the likely execution path.

## Inputs
- `zrg-dashboard-log-export-2026-02-17T18-12-24.json`
- Prior phase plans, especially `docs/planning/phase-165/plan.md` and recent adjacent phases
- Current repo runtime config files (`vercel.json`, route handlers, Inngest integration code)

## Work
- Parse the log export for timeout/error signatures, request paths, function names, and durations.
- Group failures by source (Vercel route timeout, Inngest invoke timeout, external dependency stall, etc.).
- Cross-check prior phase assumptions and identify likely ownership of the timeout ceiling.
- Produce a short hypothesis matrix that maps each signature to candidate config/code knobs.

## Output
A triage packet with exact error signatures, affected paths, and a ranked root-cause hypothesis list.

## Handoff
Pass ranked hypotheses and concrete timeout-control targets to Phase 167b for docs validation.
