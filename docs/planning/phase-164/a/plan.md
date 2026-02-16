# Phase 164a — Scope/Isolation + Evidence Packet Definition

## Focus
Create a clean, shippable scope for the perf fix (given multi-agent/unrelated changes in the working tree) and define the “evidence packet” we will produce via probe + Playwright.

## Inputs
- Phase 163 investigation notes + current working tree.
- Supabase/Postgres slow-query evidence for inbox search scans.

## Work
- Identify the exact file set needed for the Inbox perf variance fix + canary system.
- Ensure unrelated changes remain uncommitted (stash/keep-index strategy) so validation reflects the intended commit.
- Define canary budgets (initial conservative thresholds) for:
  - counts endpoint p95 server timing
  - conversations endpoint p95 server timing
  - full-email search timing
- Define the evidence packet outputs:
  - Probe JSON output from `scripts/inbox-canary-probe.ts`
  - Playwright test output (pass/fail + trace on failure)
  - Sample request IDs for slow runs (if any) to correlate with server logs

## Output
- A scoped “commit file list” and concrete canary budgets to enforce in tests.

## Handoff
Proceed to Phase 164b to finalize backend changes within the scoped file set.

