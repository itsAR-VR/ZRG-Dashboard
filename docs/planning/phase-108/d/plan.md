# Phase 108d — Workflow Integration (Insights Packs/UI + Optional Scheduling)

## Focus
Make the analysis repeatable in-product:
- generate “Message Performance” runs on demand
- persist/capture results
- view and query them in a UI (admin-gated)
- optionally schedule periodic runs (weekly/monthly)

## Inputs
- Phase 108b extractor and Phase 108c synthesis outputs.
- Existing cron routes and worker patterns:
  - `app/api/cron/insights/*`
  - `lib/insights-chat/context-pack-worker.ts`

## Work
1. **Choose the UX surface:**
   - Prefer extending the existing Insights UI/workflow (context packs) rather than building a new dashboard from scratch.
2. **Add “Message Performance” as a first-class run type:**
   - A run configuration: `{ window, channels, samplingMode, includeSetters, includeAI }`.
   - A run status lifecycle: queued → running → complete/failed.
3. **Admin-gated drilldowns:**
   - Default view: aggregated metrics + synthesized patterns.
   - Drilldown view: redacted evidence snippets (or message references) for verification.
4. **Operational safety:**
   - Use advisory locks / idempotent runners to prevent overlapping runs per client.
   - Bound work per cron tick (max leads/messages).
5. **Optional scheduling:**
   - If needed, add a Vercel Cron schedule similar to existing insights cron jobs.
   - Ensure secrets/auth match existing cron auth patterns.

## Output
- Message Performance panel in Insights UI (`components/dashboard/message-performance-panel.tsx`).
- On-demand report runs + evidence drilldowns (admin-only) in UI.
- Weekly cron route + schedule (`app/api/cron/insights/message-performance/route.ts`, `vercel.json`).

## Handoff
Phase 108e uses the proposal queue + approval flow to convert insights into controlled updates.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Integrated Message Performance panel into Insights view (`components/dashboard/insights-view.tsx`).
  - Added weekly cron schedule for reports (`app/api/cron/insights/message-performance/route.ts`, `vercel.json`).
  - Added admin evidence modal + on-demand report run in UI.
- Commands run:
  - `rg -n "MessagePerformancePanel" components/dashboard/insights-view.tsx` — verified UI wiring.
- Blockers:
  - None.
- Next concrete steps:
  - Complete eval/proposal loop and approvals (Phase 108h/e/j).
