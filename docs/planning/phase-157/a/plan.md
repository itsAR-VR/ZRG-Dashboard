# Phase 157a — Production Baseline + Failure Repro Packet

## Focus
Create a trustworthy analytics baseline before optimization so improvements are measurable and regressions are obvious.

## Inputs
- `docs/planning/phase-155/d/plan.md`
- `docs/planning/phase-155/plan.md`
- Jam: `https://jam.dev/c/6622f360-5e85-4fd6-b8e4-9e03e18ddbee`
- Analytics routes in `app/api/analytics/*`

## Work
1. Reproduce CRM summary failure path using the same request shape as Jam and verify current status.
2. Capture baseline latency packet (warm/cold) with real `clientId` values for:
   - `/api/analytics/overview?parts=core`
   - `/api/analytics/overview?parts=breakdowns`
   - `/api/analytics/workflows`
   - `/api/analytics/campaigns`
   - `/api/analytics/response-timing`
   - `/api/analytics/crm/rows?mode=summary`
3. Record for each endpoint: status, `x-zrg-cache`, `x-zrg-duration-ms`, and request-id.
4. Identify top two latency contributors by p95 and map each to backend function owners.

## Output
- Baseline evidence packet with endpoint-level p50/p95 + failure signatures.
- Prioritized optimization target list.

## Handoff
Proceed to Phase 157b with confirmed failing signatures and baseline metrics so fixes can be verified against a known starting point.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Pulled Jam evidence via MCP for `6622f360-5e85-4fd6-b8e4-9e03e18ddbee` and confirmed the original CRM summary failure signature:
    - `GET /api/analytics/crm/rows?mode=summary...` returned `500`
    - Postgres `42P18` (`could not determine data type of parameter $4`)
    - request-id captured in Jam payload: `fb6c47b8-b2df-4bf7-ae94-6a5a663f8eb7`
  - Confirmed the same Jam also includes healthy analytics route responses with timing headers on adjacent endpoints (for example workflows with `x-zrg-duration-ms=960` and CRM rows with `x-zrg-duration-ms=746`), providing pre-fix baseline context.
  - Added deterministic probe utility (`scripts/analytics-canary-probe.ts`) to generate the required `8 cold + 8 warm` packet structure with per-endpoint `status`, `x-zrg-cache`, `x-zrg-duration-ms`, and `x-request-id`.
- Commands run:
  - `mcp__jam__fetch/getDetails/getNetworkRequests` — pass; baseline failure signature + timing evidence captured.
  - `node --import tsx scripts/analytics-canary-probe.ts --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --cold-samples 1 --warm-samples 1 --out test-results/analytics-probe-unauth.json` — pass; probe framework validated.
- Blockers:
  - Full baseline packet (`8 cold + 8 warm`) with duration percentiles requires authenticated production session cookie; terminal-only unauth probe returns `401` as expected.
- Next concrete steps:
  - Run the probe with authenticated cookie in canary and archive output JSON for 157f.
  - Append p50/p95 summary and top-two latency contributors from that packet.
