# Founders Club MCP 20-Iteration Probe (2026-02-18)

- Workspace `clientId`: `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`
- Method: Playwright MCP `browser_run_code` loop in authenticated live session
- Iterations: `20`
- Endpoints per iteration: `8`
- Total samples: `160`

## Endpoint Summary

| Endpoint | OK | Statuses | Error payload | p50 ms | p95 ms |
|---|---:|---|---|---:|---:|
| `overview-core` | 0/20 | `403 x20` | `Unauthorized x20` | 205 | 277 |
| `overview-breakdowns` | 0/20 | `403 x20` | `Unauthorized x20` | 204 | 232 |
| `workflows` | 0/20 | `403 x20` | `Unauthorized x20` | 199 | 276 |
| `campaigns` | 0/20 | `403 x20` | `Unauthorized x20` | 548 | 648 |
| `response-timing` | 0/20 | `500 x20` | `Failed to fetch response timing analytics x20` | 323 | 401 |
| `crm-summary` | 0/20 | `403 x20` | `Unauthorized x20` | 205 | 269 |
| `inbox-counts` | 20/20 | `200 x20` | none | 103 | 193 |
| `inbox-conversations` | 20/20 | `200 x20` | none | 319 | 353 |

## Diagnosis

- Analytics and inbox were using different authorization paths.
- Inbox endpoints accepted the Founders Club workspace in this session, while analytics denied it.
- This mismatch is consistent with owner/member-only analytics checks vs. super-admin-aware workspace scope checks elsewhere in the platform.
- Response-timing `500` was independently traced to SQL overflow in drift bucketing (`::int` cast on ms drift); see `docs/planning/phase-170/artifacts/founders-club-response-timing-overflow.md`.
