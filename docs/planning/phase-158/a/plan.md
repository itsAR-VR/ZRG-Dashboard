# Phase 158a — Log Triaging + Issue Inventory

## Focus
Turn the two provided Vercel log export JSON files into a prioritized list of actionable issues, mapped to repo files/symbols and verification steps.

## Inputs
- `zrg-dashboard-log-error-export-2026-02-16T15-36-11.json`
- `zrg-dashboard-log-warningexport-2026-02-16T15-36-38.json`
- Existing phase context (notably Phase 157 analytics reliability work).

## Work
- Parse both exports and cluster by:
  - `requestPath`, `responseStatusCode`, `function`, and “first line of message”
  - Postgres raw query codes/messages extracted from log text (e.g. `42601`, `42883`, `42P18`)
- For each top issue, identify:
  - Code touch point(s) via `rg` (e.g. log prefix string, called action, route handler)
  - Whether the endpoint hard-fails (500) vs soft-fails (logs warning but returns 200)
  - Whether it overlaps an active concurrent phase (especially `actions/analytics-actions.ts`)
- Produce a short “Issue Inventory” artifact (counts + the concrete fix hypothesis + owner file list) to guide implementation.

## Output
- Issue inventory (export date: 2026-02-16):
  - Cron hard-fail: `864` entries for `syntax error at or near "$1"` on `/api/cron/response-timing` (`500`), mapped to `lib/response-timing/processor.ts`.
  - Analytics overview soft-fail: `11` warning entries with `syntax error at or near "FILTER"` in `Error calculating response time metrics`, mapped to `actions/analytics-actions.ts` (`calculateResponseTimeMetricsSql`).
  - AI draft booking conversion soft-fail: `8` entries with `timestamp without time zone >= interval` / PG `42883`, mapped to `actions/ai-draft-response-analytics-actions.ts` (`getAiDraftBookingConversionStats`).
  - Server action drift warnings: `528` entries (`404:442`) on `POST /auth/login` (`278`) and `POST /` (`249`), with many distinct action IDs; treated as version-skew/stale-client behavior requiring mitigation, not a single bad action handler.
  - Concurrent known issue observed once: CRM summary `42P18` (`getCrmWindowSummary`) overlaps Phase 157.
- Prioritized fix order used: cron 500s → overview FILTER SQL → booking conversion SQL typing → server-action drift mitigation.

## Handoff
Proceed to Phase 158b with these confirmed touch points:
- `lib/response-timing/processor.ts` (`SET LOCAL statement_timeout` statement),
- `actions/analytics-actions.ts` (`calculateResponseTimeMetricsSql` aggregate FILTER ordering),
- `actions/ai-draft-response-analytics-actions.ts` (`getAiDraftBookingConversionStats` maturity cutoff expression),
- `app/auth/login/page.tsx`, `components/dashboard/dashboard-shell.tsx`, `next.config.mjs` for server-action drift mitigation.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Parsed both log exports with scripted aggregation and pattern checks.
  - Produced numeric issue counts, route distribution, and mapped each issue to concrete file/function owners.
  - Confirmed overlap boundaries with active Phases 157/159/162 before editing shared files.
- Commands run:
  - `node ... (log export aggregation by status/path/message)` — pass; produced top-path and signature counts.
  - `node ... (pattern counts for "$1"/"FILTER"/"timestamp >= interval"/Server Action)` — pass; produced issue inventory counts.
  - `rg -n "SET LOCAL statement_timeout|FILTER|getAiDraftBookingConversionStats|Failed to find Server Action"` — pass; mapped log signatures to source callsites.
- Blockers:
  - None for triage.
- Next concrete steps:
  - Execute SQL fixes and regression tests (158b/158c).
  - Implement version-skew mitigation and fallback UX for stale Server Action IDs (158d).
