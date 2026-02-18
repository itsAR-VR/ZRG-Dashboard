# Phase 168e — Monitoring, Rollback Triggers, and Closeout

## Focus
Close the phase with operational guardrails so speed regressions are detected quickly and reversible safely.

## Inputs
- Verification results from Phase 168d
- Runtime signature taxonomy from earlier subphases

## Work
1. Define monitoring rules for critical signatures:
   - webhook 60s timeout bursts
   - inbox 300s timeout bursts
   - `P2028` / `query_wait_timeout` spikes
   - response-timing/analytics `500` bursts
   - “reversal loop” signature (repeat cycles across webhook + cron + inbox)
   - durable offload health (WebhookEvent queue depth + BackgroundFunctionRun failure rate)
2. Define rollback trigger thresholds and exact rollback file scope.
3. Document operator runbook for future incidents:
   - live log commands
   - Playwright diagnostic capture steps
   - evidence packaging format
   - Inngest/offload health capture steps (queue depth + durable run ledger)
4. Capture remaining unknowns and next-phase candidates if verdict is partial/rejected.

## Validation Math (Threshold Checks)
- Confirm each monitoring threshold is backed by measurable dashboards or log queries (`jq`, `psql`, Supabase service role) that can be rerun after deployment.
- Reproduce rollback alert conditions in a staging export (synthetic or sanitized) to ensure the defined `> 50`/`> 20` buckets trigger the runbook properly.
- Validate queue depth metrics by querying `WebhookEvent` rows and `BackgroundFunctionRun` status fields and recording snapshots in `docs/planning/phase-168/artifacts/offload-monitoring-<UTC>.md`.
- Verify the runbook commands (live logs, Playwright diagnostics, evidence packaging) produce the expected artifacts by walking through them with operator documentation.

## Monitoring + Rollback Thresholds (Draft)
| Signal | Threshold (30-minute window) | Owner | Rollback Scope |
|---|---|---|---|
| `/api/webhooks/email` `Task timed out after 60 seconds` | `> 50` events or sustained upward trend across 2 consecutive windows | Phase 168 operator / on-call backend | Revert latest webhook request-path changes in `app/api/webhooks/email/route.ts`; confirm `INBOXXIA_EMAIL_SENT_ASYNC` desired state |
| `/api/inbox/conversations` `Task timed out after 300 seconds` | `> 20` events or any burst >= `10` in a 5-minute slice | Phase 168 operator / on-call backend | Revert latest inbox query-path changes in `app/api/inbox/conversations/route.ts`, `app/api/inbox/counts/route.ts`, `actions/lead-actions.ts` |
| `P2028` / `query_wait_timeout` on inbox + response-timing routes | `> 30` combined events | Phase 168 operator + DB owner | Revert latest transaction/batch envelope changes in `lib/response-timing/processor.ts` and related cron handlers |
| `/api/cron/response-timing` 500 cluster | `> 15` events | Phase 168 operator | Revert latest response-timing cron change or move route back to last known good config |
| Reversal-loop pattern (webhook + cron + inbox interleaving failures) | observed in >= `2` distinct 2-minute slices within same window | Phase 168 operator + incident commander | Trigger incident runbook, freeze non-essential deploys, and roll back latest shared-route change set |
| Durable offload health (`WebhookEvent` not draining or `BackgroundFunctionRun` failures) | queue depth monotonic growth for 30 minutes or failure ratio > `10%` | Phase 168 operator + Inngest owner | Disable newest offload toggle and revert most recent offload-related deployment slice |

## Evidence Packaging Contract
- Runtime comparison packet: `docs/planning/phase-168/artifacts/verification-<windowStartUtc>-<windowEndUtc>.md`
- Baseline packet: `docs/planning/phase-168/artifacts/baseline-<windowStartUtc>-<windowEndUtc>.md`
- Browser artifacts: `artifacts/live-env-playwright/phase-168-{baseline|postfix}-<UTC>-*`
- Comparison table artifact: `docs/planning/phase-168/artifacts/pre-post-delta-<windowStartUtc>-<windowEndUtc>.csv`

## Validation (RED TEAM)
- Queue depth growth check:
  - capture `WebhookEvent` pending/running/failed counts at `T0` and `T+30m`;
  - compute growth ratio and treat monotonic growth with no drain as rollback trigger.
- Durable run failure ratio check:
  - capture `BackgroundFunctionRun` totals and failures for the same window;
  - compute `failure_ratio = failures / total_runs` and compare against threshold table.
- Signature threshold check:
  - compute route/signature counts from matched-window exports and compare against the thresholds table before declaring phase close.
- Evidence integrity check:
  - ensure each threshold decision cites artifact paths (`baseline`, `verification`, `pre-post-delta`) and UTC window metadata.

## Expected Output
- A production-ready closeout packet with monitoring thresholds, rollback criteria, runbook steps, and a next-phase decision tree.

## Output
- Closeout/monitoring artifacts attached:
  - `docs/planning/phase-168/artifacts/offload-monitoring-2026-02-18T03-30-38Z.md`
  - `docs/planning/phase-168/artifacts/verification-2026-02-18T03-18-40Z-2026-02-18T03-28-40Z.md`
  - `docs/planning/phase-168/artifacts/pre-post-delta-2026-02-18T03-18-40Z-2026-02-18T03-28-40Z.csv`
- Verification verdict consumed from 168d: **partially confirmed**.
- Active watch item for next monitoring cycle:
  - `/api/cron/emailbison/availability-slot` had one direct-probe timeout (`000`) while sampled runtime logs stayed info-level.

## Expected Handoff
- Provide Phase 169 (if needed) and downstream operators the monitoring artifact, runbook, and any follow-up phase seeds.

## Handoff
- Production handoff complete with thresholds + rollback scopes + evidence paths.
- Follow-up scope for Phase 169 / next ops cycle:
  - gather canonical matched-window dashboard export pair when available,
  - monitor emailbison availability-slot timeout recurrence before broadening rollback.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Completed queue/ledger snapshot and cron probe checks for offload health validation.
  - Materialized the final comparison and monitoring artifacts used for closeout.
  - Converted 168e from draft thresholds into evidence-backed operator handoff.
- Commands run:
  - `npx tsx ... dotenv_config_path=/tmp/phase168-prod.env` (WebhookEvent + BackgroundFunctionRun grouped snapshots) — pass.
  - cron probe loop against production alias with `CRON_SECRET` — partial pass (5 routes healthy/locked; 1 timeout).
  - `cat > docs/planning/phase-168/artifacts/offload-monitoring-2026-02-18T03-30-38Z.md` — pass.
- Blockers:
  - None for 168e completion.
- Next concrete steps:
  - Continue operational monitoring using the same artifact contracts in the next live window.
