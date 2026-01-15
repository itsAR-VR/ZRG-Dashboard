# Phase 22c — AI Dashboard Query + UI Updates for New Routes/Features

## Focus
Update the AI Dashboard so it automatically includes new routes/features and accurately reports token totals and cost estimates across the platform.

## Inputs
- `actions/ai-observability-actions.ts` (aggregation logic)
- `components/dashboard/settings-view.tsx` (AI Dashboard UI)
- Phase 22b telemetry schema/API changes (if any)
- Prompt registry (`lib/ai/prompt-registry.ts`) for human-readable naming

## Work
- Improve feature naming so the dashboard doesn’t rely on a stale hard-coded map (derive names from prompt registry when possible).
- If route/job attribution is enabled:
  - Extend the observability summary API to group spend by route/job as well as by feature/model
  - Add a UI section/table for “By Route/Job” and ensure new routes automatically appear
- Preserve existing UX: window selector (24h/7d/30d), refresh button, error samples.
- Ensure incomplete pricing remains explicit (and doesn’t break totals).

## Output
- Backend aggregation updated:
  - `actions/ai-observability-actions.ts` now derives feature names from the prompt registry (fallback for code-only features) and returns a new `sources` breakdown grouped by `AIInteraction.source`.
- UI updated:
  - `components/dashboard/settings-view.tsx` now shows **By Route/Job** and **By Feature** tables, preserving the existing window selector, refresh, prompt viewer, and error samples.
- Result: new routes/jobs and new prompt-registry features appear automatically as soon as they emit `AIInteraction` rows (no more hard-coded feature name drift).

## Handoff
Proceed to Phase 22d:
- Run `npm run db:push` to apply the `AIInteraction.source` schema change.
- Run `npm run lint` and `npm run build` (build runs `prisma generate`).
- Spot-check DB totals vs dashboard totals for a workspace + window.
