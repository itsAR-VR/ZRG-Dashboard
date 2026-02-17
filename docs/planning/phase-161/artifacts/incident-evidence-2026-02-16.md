# Phase 161a Incident Evidence Packet (Log Export: 2026-02-16T16:16:06)

## Source Artifacts
- `zrg-dashboard-log-export-2026-02-16T16-16-06.json`
  - sha256: `1c7322b2069233cbd662d41153d4bed5642573805b0d8a0c3fbf617d2ea61773`
- Computed summary:
  - `docs/planning/phase-161/artifacts/log-export-2026-02-16T16-16-06-summary.json`

## Scope Confirmation
- Total log entries: `120`
- Request path coverage:
  - `zrg-dashboard.vercel.app/api/inbox/conversations`: `120`
  - Adjacent endpoints present (`/api/inbox/counts`, `/api/inbox/conversations/[leadId]`): `0`
- Request method coverage:
  - `GET`: `120`

## Incident Timeline
- First observed entry:
  - `2026-02-16 16:03:30 UTC` (`timestampInMs=1771257810000`)
- Last observed entry:
  - `2026-02-16 16:03:39 UTC` (`timestampInMs=1771257819680`)
- Observed burst duration:
  - `9.680s`
- Request volume shape:
  - `60` unique `requestId` values over `120` entries (paired `middleware` + `function` records)
  - Highest per-second density: `22` entries (`11` unique request IDs) at `2026-02-16 16:03:34 UTC`

## Status and Error Signal
- Status distribution:
  - `503`: `116`
  - blank/empty status: `4` (two request IDs with missing `deploymentDomain`, `branch`, `vercelCache`)
- Message fidelity:
  - non-empty `message` or `level` entries: `0`
  - no stack traces or reason codes available in this export

## Deployment / Region Attribution
- All records map to deployment id:
  - `dpl_AnY8GbAhbg62bW875FgQFyMhNxmJ`
- Deployment domain values in export:
  - `zrg-dashboard-kw6v10pnj-zrg.vercel.app`
  - blank (`""`) on 4 entries
- `vercel inspect dpl_AnY8GbAhbg62bW875FgQFyMhNxmJ` summary:
  - target: `production`
  - ready state: `READY`
  - createdAt (UTC): `2026-02-16 12:07:07 UTC`
- Region distribution:
  - `iad1`: `60` (function runtime)
  - `sin1`: `35`
  - `cpt1`: `21`
  - `yul1`: `4`

## Affected Client IDs (from query string)
- `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`: `114` entries
- `1c5273a9-39a5-40e9-85dc-6636fa553506`: `2` entries
- `7a00f971-f94d-40e1-b8c9-1e2a47ab12af`: `2` entries
- `a9dcc367-a113-4d0e-b236-3196ea498b18`: `2` entries

## Evidence Gaps (Needed for Root-Cause Isolation)
1. Runtime response headers for affected requests:
   - Need `x-zrg-read-api-reason` and any `READ_API_DISABLED` payload evidence for sampled 503 requests.
2. Server logs with explicit reason codes:
   - This export has empty `message`/`level`, so route-level branch attribution cannot be determined from it alone.
3. Deployment env snapshot for incident deployment:
   - Need values/effective resolution of `INBOX_READ_API_V1` and `NEXT_PUBLIC_INBOX_READ_API_V1` at incident time.
4. Caller-side fail-open header evidence:
   - Need request capture confirming whether `x-zrg-read-api-fail-open: server_action_unavailable` was sent by affected clients.
