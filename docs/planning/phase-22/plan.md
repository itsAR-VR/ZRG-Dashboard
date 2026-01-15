# Phase 22 — AI Dashboard Coverage (Routes) + Platform Token Accounting

## Purpose
Ensure the Settings → AI Dashboard reflects all current AI execution paths (“routes”/jobs/features) and accurately aggregates token usage (and cost where possible) across the platform.

## Context
We already persist AI usage telemetry in `AIInteraction` and surface a summary in the Settings view “AI Dashboard”. As we add new API routes (webhooks/cron), new AI features (prompts), and new models, the dashboard can drift: missing breakdowns, stale feature naming, and incomplete cost coverage.

This phase standardizes “what counts as an AI route”, verifies all AI calls are captured, and updates the AI Dashboard to stay complete as new routes/features are added.

## Objectives
* [x] Inventory all AI execution paths (API routes, cron jobs, server actions, ingestion pipelines) and map them to `featureId`s
* [x] Ensure every LLM call records an `AIInteraction` (clientId, featureId, model, tokens, latency, status, error)
* [x] Add “route/job attribution” to AI telemetry if needed so the dashboard can group spend by route/job (not only by feature)
* [x] Update the AI Dashboard to automatically include new routes/features and show token totals across the platform

## Constraints
- Never commit secrets or tokens.
- Prefer existing AI utilities (`lib/ai/openai-telemetry`, `lib/ai/prompt-registry`) over new patterns.
- If Prisma schema changes are required, run `npm run db:push` and validate schema before finishing implementation.
- Keep AI observability admin-only (workspace admin gating).
- Retention expectations: AI interactions are bounded (30-day retention job exists).

## Success Criteria
- [x] AI Dashboard totals match the full set of `AIInteraction` records for the selected workspace + window (no blind spots).
- [x] New AI features/routes appear in the dashboard without requiring hard-coded lists.
- [x] Token totals include all relevant AI calls across the platform (cron + webhooks + UI-triggered).
- [x] Cost estimates remain clearly labeled when incomplete (e.g., new models missing pricing).

## Subphase Index
* a — Inventory AI “routes” + gap analysis
* b — Token logging + route/job attribution in telemetry
* c — AI Dashboard query + UI updates for new routes/features
* d — Validation + docs (pricing/retention) checklist

## Phase Summary
- Inventory: `docs/planning/phase-22/a/inventory.md`
- Telemetry attribution: added `AIInteraction.source` + AsyncLocalStorage propagation (`lib/ai/telemetry-context.ts`, `lib/ai/openai-telemetry.ts`)
- Entry points instrumented: key webhooks + cron + server actions now set an attribution source (see Phase 22b output)
- Dashboard updated: Settings → AI Dashboard now includes “By Route/Job” and improved feature naming (`actions/ai-observability-actions.ts`, `components/dashboard/settings-view.tsx`)
- Validation: ran `npm run db:push`, `npm run lint`, `npm run build` (Phase 22d)
