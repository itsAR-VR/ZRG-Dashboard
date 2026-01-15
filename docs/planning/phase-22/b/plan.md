# Phase 22b — Token Logging + Route/Job Attribution in Telemetry

## Focus
Guarantee every AI call is recorded in `AIInteraction`, and (if chosen in 22a) attach route/job attribution so spend can be attributed to “new routes” reliably.

## Inputs
- Phase 22a inventory + attribution decision
- `lib/ai/openai-telemetry.ts` (recordInteraction + runResponse wrappers)
- `prisma/schema.prisma` `AIInteraction` model (potential schema change)

## Work
- Ensure all AI calls go through a single telemetry wrapper (or add a wrapper for any missing API type).
- If route/job attribution is required:
  - Add a nullable field to `AIInteraction` (e.g., `source`/`route`) to store the attribution key
  - Thread that field through the telemetry wrapper APIs
  - Update call sites (API routes / cron jobs / server actions) to pass a stable attribution value
- Keep backward compatibility for existing records (nullable field + graceful UI handling).
- Confirm retention behavior remains best-effort and bounded.

## Output
- Added route/job attribution plumbing:
  - Prisma: `prisma/schema.prisma` `AIInteraction.source` (nullable) + index.
  - Context: `lib/ai/telemetry-context.ts` (AsyncLocalStorage-based `source` propagation).
  - Telemetry write: `lib/ai/openai-telemetry.ts` now records `source` (explicit param or active context).
- Set request/action attribution at key entry points:
  - App Router routes (pathname as source): `app/api/webhooks/email/route.ts`, `app/api/webhooks/ghl/sms/route.ts`, `app/api/webhooks/instantly/route.ts`, `app/api/webhooks/smartlead/route.ts`, `app/api/webhooks/linkedin/route.ts`, `app/api/cron/followups/route.ts`, `app/api/cron/insights/booked-summaries/route.ts`.
  - Server Actions (stable action ids, only when unset so webhooks keep their route source): `actions/message-actions.ts`, `actions/insights-chat-actions.ts`, `actions/settings-actions.ts`.
- Retention remains unchanged (still best-effort pruning via `pruneOldAIInteractionsMaybe` + cron endpoint).

## Handoff
Proceed to Phase 22c:
- Update `actions/ai-observability-actions.ts` to group by `source` (route/job) in addition to existing feature/model grouping.
- Update AI Dashboard UI (`components/dashboard/settings-view.tsx`) to display “By Route/Job” plus improved feature naming (derive from prompt registry, fallback for code-only features).
- After implementation, run `npm run db:push` and `npm run build`/`npm run lint` in Phase 22d.
