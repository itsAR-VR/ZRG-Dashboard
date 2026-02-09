# Phase 126 — Review

## Summary
- Shipped a forward-looking calendar capacity utilization metric: `% booked = booked / (booked + available)` over the next 30 days, with DEFAULT vs DIRECT_BOOK breakdown and an explicit unattributed booked count.
- Quality gates passed on 2026-02-09: `npm test`, `npm run lint` (warnings only), `npm run build`.
- Prisma schema sync check passed: `npm run db:push` reported "database is already in sync".
- Manual QA (UI + Insights Chat scenarios) is not yet completed in this branch.

## What Shipped
- Prisma schema: `Appointment` attribution fields + indexes
  - `prisma/schema.prisma`
- Appointment attribution write paths (populate calendar/event-type IDs)
  - `lib/appointment-upsert.ts`
  - `lib/booking.ts`
  - `app/api/webhooks/calendly/[clientId]/route.ts`
  - `lib/ghl-appointment-reconcile.ts`
  - `lib/calendly-appointment-reconcile.ts`
- Capacity computation (cache + appointment counts; serializable output)
  - `lib/calendar-capacity-metrics.ts`
- Analytics + UI wiring (adds KPI card "Capacity (30d)")
  - `actions/analytics-actions.ts`
  - `components/dashboard/analytics-view.tsx`
- Tests
  - `lib/__tests__/calendar-capacity-metrics.test.ts`
  - `lib/__tests__/prisma-appointment-calendar-fields.test.ts`
  - `scripts/test-orchestrator.ts`

## Verification

### Commands
- `npm test` — pass (2026-02-09)
- `npm run lint` — pass (2026-02-09; warnings only)
- `npm run build` — pass (2026-02-09)
- `npm run db:push` — pass (2026-02-09; "database is already in sync")

### Notes
- Lint warnings observed (pre-existing): React hooks exhaustive deps, `<img>` usage warnings.
- Build warnings observed (pre-existing): CSS optimizer warnings for `var(--... )` and baseline-browser-mapping staleness.

## Success Criteria → Evidence

1. Analytics returns capacity object (combined + breakdown + unattributed + required cacheMeta).
   - Evidence:
     - `lib/calendar-capacity-metrics.ts` returns required, ISO-serialized fields (`fromUtcIso`, `toUtcIso`, `cacheMeta[].fetchedAtIso`).
     - `actions/analytics-actions.ts` populates `overview.capacity` via `getWorkspaceCapacityUtilization({ clientId, windowDays: 30 })`.
   - Status: **partial**
     - Implementation is present and compiles, but not validated against a real workspace payload in this branch.

2. Analytics UI shows KPI card "Capacity (30d)" + tooltip with breakdown and freshness warning.
   - Evidence: `components/dashboard/analytics-view.tsx` adds KPI card and `buildCapacityTooltip(...)`.
   - Status: **partial**
     - Implementation is present and compiles, but not manually verified in a running UI session in this branch.

3. Insights Chat can reference the metric (workspace-scope only).
   - Evidence:
     - `actions/insights-chat-actions.ts` workspace path calls `getAnalytics(opts.clientId)`; campaign-scoped path calls `getEmailCampaignAnalytics(...)` only.
     - `actions/analytics-actions.ts` now includes `overview.capacity` workspace-scope.
   - Status: **partial**
     - Wiring is present, but not manually verified via Insights Chat prompts in this branch.

4. Backfill behavior exists and is dedicated (not on reconcile hot path).
   - Evidence: `lib/appointment-upsert.ts` exports `backfillAppointmentAttribution(...)`.
   - Status: **met**

5. Quality gates pass.
   - Evidence: commands above (`npm test`, `npm run lint`, `npm run build`).
   - Status: **met**

## Plan Adherence
- Planned vs implemented deltas:
  - None observed for the core approach (cache-only availability; CONFIRMED appointments; combined + breakdown + unattributed).
  - UI tooltip is newline-delimited plain text (fits existing KPI tooltip pattern).

## Risks / Rollback
- Risk: stale or missing availability cache can make the metric misleading.
  - Mitigation: `cacheMeta[].isStale` + tooltip warning + `lastError` surfaced.
- Risk: unattributed booked count can be high until backfill is run (or if calendars are unconfigured).
  - Mitigation: explicit `unattributedBookedSlots` field + tooltip surfacing; optional backfill function.
- Rollback:
  - UI: remove the KPI card entry from `components/dashboard/analytics-view.tsx` to hide the metric.
  - Compute: remove `overview.capacity` population in `actions/analytics-actions.ts`.
  - Schema changes are additive (nullable fields + indexes) and can remain even if feature is hidden.

## Follow-ups
- Run the manual QA scenarios in `docs/planning/phase-126/d/plan.md` (UI + Insights Chat, workspace-scope and campaign-scope).
- (Optional) Add an admin-only endpoint to trigger `backfillAppointmentAttribution` for a workspace (or schedule via cron) once desired.
