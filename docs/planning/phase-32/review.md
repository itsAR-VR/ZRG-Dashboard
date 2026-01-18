# Phase 32 — Review

## Summary
- Shipped separate setter vs client response time KPIs (ET weekdays 9am–5pm) and a per-setter response time breakdown.
- Added `Message.sentByUserId` and plumbed it through user-initiated sends (SMS/email/LinkedIn) to enable attribution.
- Verification passed: `npm run lint` (0 errors), `npm run build`, `npm run db:push` (“already in sync”).
- Known tradeoff: strict “both timestamps within business hours” filtering can reduce sample size and bias averages.

## What Shipped
- `prisma/schema.prisma` — `Message.sentByUserId` + `@@index([sentByUserId])`
- `lib/business-hours.ts` — ET business hours helpers + `formatDurationMs`
- `actions/analytics-actions.ts` — `calculateResponseTimeMetrics`, `perSetterResponseTimes`, updated `AnalyticsData.overview`
- `lib/system-sender.ts` — `SystemSendMeta.sentByUserId` + persisted on outbound SMS messages
- `actions/email-actions.ts` — persisted `sentByUserId` on outbound Email messages
- `actions/message-actions.ts` — passes authenticated user id into SMS/Email/LinkedIn sends and draft approval flows
- `components/dashboard/analytics-view.tsx` — KPI split (“Setter Response” / “Client Response”) + per-setter table

## Verification

### Commands
- `npm run lint` — pass (0 errors, 17 warnings) (`2026-01-17`)
- `npm run build` — pass (`2026-01-17`)
- `npm run db:push` — pass (“The database is already in sync with the Prisma schema.”) (`2026-01-17`)

### Notes
- `npm run build` shows Next.js warnings about multiple lockfiles and deprecated middleware convention; build still succeeds.
- Lint warnings are present (React Hook deps, `<img>` usage, unused eslint-disable directives) but no errors.

## Success Criteria → Evidence

1. Analytics tab shows two separate response time cards (“Setter Response” / “Client Response”).
   - Evidence: `components/dashboard/analytics-view.tsx` (KPI cards reference `overview.setterResponseTime` and `overview.clientResponseTime`)
   - Status: met

2. Both metrics only include messages within 9am-5pm ET business hours (weekdays).
   - Evidence:
     - `lib/business-hours.ts` (`isWithinEstBusinessHours`, fixed `America/New_York`, weekdays, 9 ≤ hour < 17)
     - `actions/analytics-actions.ts` (`areBothWithinEstBusinessHours` gate for both setter/client metrics)
   - Status: met

3. A per-setter breakdown table shows individual setter response times.
   - Evidence:
     - `actions/analytics-actions.ts` (`calculatePerSetterResponseTimes`, `perSetterResponseTimes`)
     - `prisma/schema.prisma` (`Message.sentByUserId`)
     - `components/dashboard/analytics-view.tsx` (table rendering `data.perSetterResponseTimes`)
   - Status: met

4. Existing functionality continues to work for workspaces without setter accounts.
   - Evidence:
     - `actions/analytics-actions.ts` returns `perSetterResponseTimes: []` for empty/no-data cases and “All Workspaces” view
     - `components/dashboard/analytics-view.tsx` renders an empty state when no setter data is available
     - `npm run build` succeeded
   - Status: met

## Plan Adherence
- Planned vs implemented deltas (notable):
  - Business hours implemented as ET weekdays and “both timestamps must be within business hours” (strict filter).
  - Response-time pairing is channel-safe (`current.channel === next.channel`).
  - Performance bounded with a 30-day rolling window for message queries.
  - Backward compatibility retained via `overview.avgResponseTime` (set to setter response time formatted).

## Risks / Rollback
- Risk: strict business-hours filtering can materially reduce sample counts and bias averages low (overnights/weekends excluded).
  - Mitigation: consider surfacing sample counts in the UI and/or offering a less strict business-hours model in a follow-on phase.
- Rollback: schema change is additive (nullable field); UI can revert to the previous single metric without requiring schema rollback.

## Follow-ups
- Consider exposing `sampleCount` for setter/client metrics in the UI (currently computed but not displayed).
- Consider an alternate business-hours model that counts elapsed business time across boundary-crossing pairs (optional).
- Optional next phase: per-channel response time breakdown (SMS vs Email vs LinkedIn).
