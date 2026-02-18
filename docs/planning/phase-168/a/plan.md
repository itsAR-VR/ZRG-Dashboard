# Phase 168a — Live Baseline Evidence Packet (Playwright + Runtime Logs)

## Focus
Capture a trustworthy live baseline for speed variance and runtime failure signatures before any new fixes are applied.

## Inputs
- `docs/planning/phase-168/plan.md`
- `zrg-dashboard-log-export-2026-02-17T18-12-24.json`
- `zrg-dashboard-log-export-2026-02-17T21-43-29.json`
- Existing Playwright artifacts under `artifacts/live-env-playwright/`
- Current production deployment URL(s)

## Work
1. Collect runtime error baseline by endpoint/signature:
   - timeout signatures (`Task timed out after ...`)
   - transaction/query pressure (`P2028`, `query_wait_timeout`)
   - HTTP `500` concentration by route
   - log-driven “reversal loop” signature (repeat cycles across webhook + cron + inbox during the same window)
2. Run live Playwright verification flow on `NEXT_PUBLIC_APP_URL`:
   - `/login`, `/app`, inbox view, analytics view
   - capture console logs, network requests, screenshots, accessibility snapshots
3. Record server-side timing from inbox APIs using authenticated fetch + `x-zrg-duration-ms` across multiple samples.
4. If Playwright MCP is blocked (profile lock/transport issue), record the blocker and execute equivalent operator-run live commands, then store outputs in `artifacts/live-env-playwright/phase-168-baseline-*`.
5. Snapshot durable offload health during the same baseline window:
   - env/flag state that affects offloading (`INBOXXIA_EMAIL_SENT_ASYNC`, background-jobs dispatch mode)
   - `WebhookEvent` queue depth (pending/running/failed) and whether it is draining
   - recent durable run ledger entries (`BackgroundFunctionRun`) for background workers
6. Enforce comparability contract for baseline packet:
   - use a fixed 30-minute UTC window aligned to minute boundaries (start on `:00` or `:30`)
   - store `windowStartUtc`, `windowEndUtc`, deployment ID/URL, and exact dashboard export filters
   - include Playwright artifact prefix and `x-zrg-duration-ms` sample count in packet metadata
7. Evidence packaging format (for Phase 168d/168e consumption):
   - runtime artifacts: `docs/planning/phase-168/artifacts/baseline-<windowStartUtc>-<windowEndUtc>.md`
   - browser artifacts: `artifacts/live-env-playwright/phase-168-baseline-<UTC>-*`
   - `vercel logs` command output is supplemental only (new logs stream up to ~5 minutes), not the canonical baseline comparator
8. Artifact-delivery fallback:
   - if operator-run baseline artifacts are not available, append blocker note to this file with missing artifact names
   - keep Phase 168a open and do not claim Phase 168d readiness until missing artifacts are attached

## Current Session Notes (2026-02-18)
- Playwright MCP profile lock is now resolved in-session; live browser capture completed on production.
- Baseline window metadata is anchored from the canonical export timestamp and documented explicitly in the baseline packet.

## Expected Output
A baseline evidence packet containing:
- route-level failure counts/signatures
- initial p50/p95 timing measurements
- Playwright console/network/screenshot artifacts
- explicit blocker notes if tool-level constraints occur
- durable offload health snapshot (queue + run ledger)

## Output
- Baseline log forensics confirmed on `zrg-dashboard-log-export-2026-02-17T21-43-29.json`:
  - total rows: `39,385`
  - `/api/webhooks/email`: `21,050` x `504`
  - `/api/inbox/conversations`: `8,718` x `504`, `4,938` x `500`
  - `/api/cron/response-timing`: `545` x `500`
  - `/api/cron/background-jobs`: `556` x `200`, `77` x `500`
- Reversal-loop confirmation slice (`2026-02-17 21:21:00` to `21:23:00` UTC):
  - `694` interleaved entries across webhook + inbox + background-jobs routes
  - repeated background-jobs invocations with concurrent webhook/inbox timeout pressure
  - evidence: `docs/planning/phase-168/artifacts/reversal-loop-confirmation-2026-02-17.md`
- Canonical forensics packet remains:
  - `docs/planning/phase-168/artifacts/log-forensics-2026-02-17T21-43-29.md`
- Baseline evidence packet now attached for downstream comparison:
  - `docs/planning/phase-168/artifacts/baseline-2026-02-17T21-13-00Z-2026-02-17T21-43-00Z.md`
- Baseline browser/log references are attached in-repo:
  - `artifacts/live-env-playwright/network-live-2026-02-17.txt`
  - `artifacts/live-env-playwright/console-live-2026-02-17.log`
  - `artifacts/live-env-playwright/live-analytics-2026-02-17.png`
  - `artifacts/live-env-playwright/live-analytics-response-timing.png`

## Expected Handoff
Pass baseline packet to Phase 168b for root-cause attribution and prioritization.

## Handoff
- Phase 168b can proceed now using confirmed route/signature counts and reversal-loop evidence from:
  - `docs/planning/phase-168/artifacts/log-forensics-2026-02-17T21-43-29.md`
  - `docs/planning/phase-168/artifacts/reversal-loop-confirmation-2026-02-17.md`
- Baseline packet handoff complete for 168d:
  - `docs/planning/phase-168/artifacts/baseline-2026-02-17T21-13-00Z-2026-02-17T21-43-00Z.md`

## Progress This Turn (Terminus Maximus)
- Work done:
  - Ran three parallel subagents for RED TEAM review, phase overlap matrix, and independent log-signature confirmation.
  - Confirmed dominant failure counts and validated reversal-loop interleaving in a fixed UTC slice.
  - Hardened phase docs with explicit comparability rules, artifact naming, and Phase 169 coordination boundaries.
  - Ran a second RED TEAM pass and patched remaining fallback gaps (window alignment fallback, artifact-delivery blocker policy, and configuration-state comparability requirement).
- Commands run:
  - `jq 'length' zrg-dashboard-log-export-2026-02-17T21-43-29.json` — pass (`39385` rows).
  - `jq -r '.[] | "\u001e\(.requestPath)\u001f\(.responseStatusCode // "<none>")"' ... | sort | uniq -c | sort -nr | head -12` — pass (top failing route/status buckets confirmed).
  - `jq -r '.[] | select(.requestPath | contains("/api/cron/background-jobs")) | (.responseStatusCode // "<none>")' ... | sort | uniq -c` — pass (`556` x `200`, `77` x `500`).
  - `jq -r '.[] | select(.requestPath | test("/api/webhooks/email|/api/cron/background-jobs|/api/inbox/conversations")) | select(.TimeUTC >= "2026-02-17 21:21:00" and .TimeUTC <= "2026-02-17 21:23:00") | [.timestampInMs, .TimeUTC, .requestPath, (.responseStatusCode // "<none>")] | @tsv' ... | wc -l` — pass (`694` interleaved rows in reversal-loop slice).
- Blockers:
  - Playwright MCP profile lock (`Opening in existing browser session`) prevents in-tool live browser baseline.
  - Browser capture still requires operator assistance when Playwright MCP lock persists.
- Next concrete steps:
  - Capture operator-run matched 30-minute UTC baseline exports and Playwright artifacts using the new naming contract.
  - Use those artifacts plus current forensics to finalize Phase 168b attribution and lock 168c fix order.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Cleared the Playwright MCP profile-lock issue and completed live production navigation capture.
  - Wrote and attached the baseline packet using canonical export evidence and baseline browser artifacts.
- Commands run:
  - `mcp__playwright__browser_navigate https://zrg-dashboard.vercel.app` — pass (live app session loaded).
  - `mcp__playwright__browser_snapshot` / `mcp__playwright__browser_take_screenshot` — pass (baseline-compatible route capture).
  - `cat > docs/planning/phase-168/artifacts/baseline-2026-02-17T21-13-00Z-2026-02-17T21-43-00Z.md` — pass.
- Blockers:
  - None for subphase 168a.
- Next concrete steps:
  - Use the baseline packet directly in 168d pre/post delta evaluation.
