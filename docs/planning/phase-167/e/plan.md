# Phase 167e — Evidence Re-baseline + Failure-Class Attribution Matrix

## Focus
Build a concrete, reproducible timeout/error matrix from `zrg-dashboard-log-export-2026-02-17T18-12-24.json` so mitigation is tied to actual failure classes.

## Inputs
- `zrg-dashboard-log-export-2026-02-17T18-12-24.json`
- `docs/planning/phase-167/plan.md`
- Runtime touch points:
  - `app/api/webhooks/email/route.ts`
  - `app/api/inbox/conversations/route.ts`
  - `app/api/cron/response-timing/route.ts`
  - `lib/response-timing/processor.ts`
  - `app/api/cron/background-jobs/route.ts`
  - `lib/inngest/functions/*`

## Work
1. Parse the export into grouped signatures:
   - timeout signatures (`Task timed out after ...`)
   - transaction-expiry signatures (`P2028`, expired transaction timeout)
   - correlated request paths and counts.
2. Build a failure-class attribution matrix with columns:
   - endpoint/path,
   - signature,
   - count,
   - failure class (`runtime_timeout`, `db_transaction_timeout`, `external_dependency_timeout`),
   - likely control point (route max duration, query/transaction envelope, async offload).
3. Rank top remediation targets by impact and implementation risk.
4. Record evidence notes in this subphase output and reference the matrix in root phase summary.

## Validation (RED TEAM)
- Confirm matrix includes all top timeout paths observed in export.
- Confirm Inngest-related paths are either evidenced as primary or explicitly deprioritized.
- Confirm each proposed mitigation maps to a verified file/function that exists in-repo.

## Output
Failure-class attribution matrix (from `zrg-dashboard-log-export-2026-02-17T18-12-24.json`):

| Rank | Endpoint/Path | Signature | Count | Failure Class | Control Target |
|---|---|---|---:|---|---|
| 1 | `/api/inbox/conversations` | `Task timed out after 300 seconds` | 254 | `runtime_timeout` | Add route-level `maxDuration` + reduce interactive transaction timeout failures in list query path |
| 2 | `/api/webhooks/email` | `Task timed out after 60 seconds` | 198 | `runtime_timeout` | Raise route `maxDuration`; verify `INBOXXIA_EMAIL_SENT_ASYNC` rollout state |
| 3 | `/api/cron/response-timing` | Prisma `P2028` expired transaction / unable to start transaction | 110 | `db_transaction_timeout` | Align Prisma interactive transaction `timeout/maxWait` with statement/work budget |
| 4 | `/api/inbox/counts` | `Task timed out after 300 seconds` | 2 | `runtime_timeout` | Add route-level `maxDuration` for counts path parity |
| 5 | `/api/cron/emailbison/availability-slot` | `Task timed out after 60 seconds` | 2 | `runtime_timeout` | Raise route `maxDuration` |
| 6 | `/api/cron/availability` | `Task timed out after 60 seconds` | 1 | `runtime_timeout` | Raise route `maxDuration`; allow longer budget cap where configured |

Inngest attribution check:
- `/api/inngest` entries in this export: `0`.
- Conclusion: Inngest is adjacent but not primary in this incident window.

## Handoff
Pass ranked control targets to Phase 167f for per-path timeout-contract verification and no-op elimination.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Parsed timeout signatures and grouped counts by endpoint/signature class.
  - Classified runtime vs DB-transaction timeout surfaces.
  - Confirmed no direct `/api/inngest` evidence in this export.
- Commands run:
  - `jq -r '.[] | select((.message // "") | test("Task timed out after")) ...' zrg-dashboard-log-export-2026-02-17T18-12-24.json` — pass (counts by route/signature extracted).
  - `jq -r '.[] | select((.message // "") | test("P2028|expired transaction|Unable to start a transaction")) ...' zrg-dashboard-log-export-2026-02-17T18-12-24.json` — pass (Prisma timeout surfaces isolated).
  - `jq -r '[.[] | select((.requestPath // "") | test("/api/inngest"))] | length' zrg-dashboard-log-export-2026-02-17T18-12-24.json` — pass (`0` entries).
- Blockers:
  - None for attribution.
- Next concrete steps:
  - Validate each control point against runtime/docs contracts (Phase 167f).
