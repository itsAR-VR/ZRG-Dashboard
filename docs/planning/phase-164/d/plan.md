# Phase 164d — Perf Canary Harness (Probe + Playwright) + Runbook

## Focus
Ship a durable, repeatable, low-flake performance harness for live environments.

## Inputs
- `scripts/analytics-canary-probe.ts` pattern (existing).
- New inbox endpoints timing headers (`x-zrg-duration-ms`).

## Work
- Probe script:
  - Implement/validate `scripts/inbox-canary-probe.ts` to sample endpoints and summarize p50/p95.
  - Ensure it supports: `--base-url`, `--client-id`, `--search`, `--samples`, `--cookie`, `--out`.
- Playwright suite:
  - Add/validate `e2e/inbox-perf.spec.mjs` to enforce budgets using server timing headers (reduces network variance).
  - Ensure graceful skipping when not authenticated.
- Runbook:
  - Document minimal steps to run both harnesses without committing secrets:
    - How to obtain a session cookie locally (manual) and set `INBOX_CANARY_COOKIE`.
    - Example commands.
    - How to interpret failures (request IDs + durations).

## Output
- A repeatable canary system that can be run before/after deployments.

## Handoff
Proceed to Phase 164e for full validation, commit/push, and live verification.

