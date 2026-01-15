# Phase 22a — Inventory AI “Routes” + Gap Analysis

## Focus
Define what “routes” means for AI spend (HTTP routes, cron jobs, or higher-level features) and produce an inventory of every AI execution path so we can prove the dashboard is complete.

## Inputs
- Current AI Dashboard UI: `components/dashboard/settings-view.tsx`
- Aggregation source: `actions/ai-observability-actions.ts`
- Telemetry write path: `lib/ai/openai-telemetry.ts` + `prisma.schema` `AIInteraction`
- Prompt/feature source-of-truth: `lib/ai/prompt-registry.ts`
- Known AI-heavy flows: insights chat, follow-up engine, sentiment, drafts, knowledge assets, auto-send evaluator

## Work
- Enumerated all codepaths that invoke OpenAI (directly or via wrappers) and listed observed `featureId`s.
- Enumerated Next.js API routes, cron endpoints, and server actions that can trigger AI work.
- Decided on the attribution key for dashboard grouping.
- Identified current gaps (naming drift, pricing drift, non-logged token-count endpoint).

## Output
- Inventory: `docs/planning/phase-22/a/inventory.md`
- Decision: Implement **route/job attribution** in telemetry via a nullable `AIInteraction.source` field.
  - For App Router route handlers: use the request pathname (e.g., `/api/webhooks/email`, `/api/cron/followups`).
  - For Server Actions: use a stable action id string (e.g., `action:insights_chat.send_message`).
  - Prefer automatic propagation via AsyncLocalStorage context, not “threading” a `source` param through every AI call site.
- Noted gaps to fix in this phase:
  - Dashboard feature naming drift (hard-coded map is stale vs prompt registry).
  - Model pricing drift (defaults don’t cover all models; cost should remain explicitly “incomplete”).
  - `openai.responses.inputTokens.count` requests aren’t recorded in `AIInteraction` (decide whether to track separately or ignore as non-token-spend).

## Handoff
Proceed to Phase 22b:
- Add `source` to `AIInteraction` (Prisma schema + push).
- Add AsyncLocalStorage-backed context helpers + wire `source` into `lib/ai/openai-telemetry.ts` so every interaction records the active source automatically.
- Set the source context in AI-triggering App Router route handlers (webhooks + cron) and the key AI server actions.
