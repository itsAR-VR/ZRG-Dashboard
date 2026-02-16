# Phase 163e — Playwright Perf Suite + CI/Runbook + Rollout

## Focus
Turn perf investigation into a permanent system: Playwright perf canaries, repeatable scripts, and a rollout runbook.

## Inputs
- Stable timing headers (163b)
- Verified backend fixes (163c)
- Verified frontend stabilization (163d)
- Existing Playwright scaffold (`playwright.config.mjs`, `e2e/*`)

## Work
1. Add Playwright “perf canary” tests:
   - run N repeated flows (master inbox load, workspace switch, analytics nav)
   - record server timing headers for key endpoints
   - assert budgets on server-reported durations (flake-resistant)
2. Add a Node/TS probe script (non-UI) as a fast option:
   - uses authenticated cookie provided via env var (never committed)
   - produces `test-results/perf-probe-*.json`
3. CI wiring (optional, gated):
   - run perf canary against Preview deployments when secrets exist
   - default to “manual run” if auth isn’t configured
4. Runbook + rollback:
   - how to run the probes
   - how to interpret outputs
   - how to disable/rollback read APIs or caches safely

## Output
- Playwright perf suite + probe script + runbook merged to main.

## Handoff
After merge, run live Playwright MCP verification on production and store the evidence artifacts for the release note.

