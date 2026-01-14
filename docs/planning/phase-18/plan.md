# Phase 18 — Campaign Insight Chatbot (Read‑Only v1) + Context Packs + Evaluation Scaffolding

## Purpose
Ship an in-dashboard “Insights Console” chatbot that answers **what’s happening right now** using **real analytics data**, with a context-efficient pipeline that analyzes representative threads once per session and reuses the resulting “context pack” across follow-ups.

## Context
- We already have campaign-level KPIs, AI vs setter tracking, and provider-aware booking (GHL/Calendly).
- Booking conversion is sensitive to fast, high-quality responses; we want a feedback loop for “what’s working / what’s failing” across campaigns.
- The chatbot is **workspace-scoped**, persists chat history **shared per workspace**, and builds a **session context pack** on the **first question**:
  - analyze selected lead threads with an LLM one-by-one (full thread input)
  - store compact per-thread “Conversation Insight” summaries
  - synthesize into a compact session-level context pack used for subsequent turns (avoid dumping raw threads into every LLM call)

## Objectives
* [x] Add a workspace-scoped chat session + message persistence model (multi-session, author attribution, retention)
* [x] Implement time-window + campaign scope selection for context packs (window is session-versioned; campaign multi-select + “all with cap”)
* [x] Implement a context-efficient LLM pipeline (thread extraction + synthesis) and reuse lead-level cached summaries
* [x] Add model selector + reasoning-effort settings in AI Personality (defaults: `gpt-5-mini` + `medium`)
* [x] Implement admin-only soft delete/restore and audit logging for sessions + context packs
* [x] Add background cron to compute booked-meeting thread summaries within ~10 minutes
* [x] Add MVP evaluation scaffolding (LLM-as-judge) and guardrails for grounded, tool-based answers

## Constraints
- Scope: EmailBison/email campaigns only for campaign picker; SMS-only workspaces operate workspace-wide (no campaign picker).
- Privacy: Lead names/emails allowed to the LLM. Full message bodies are only sent during per-thread extraction, not every chat turn.
- v1 is read-only insights:
  - Action tools (change campaign response mode, create experiments, pause follow-ups) are present as toggles in AI Personality but OFF by default and not executed in v1.
- Time windows:
  - Default window is last 7 days
  - Presets: 24h / 7d / 30d + custom
  - Window is effectively session-versioned via context packs; users can compute a new pack for a different window.
- Campaign scope:
  - Multi-select campaigns OR “All campaigns”
  - “All campaigns” must be capped; default cap 10 (configurable)
  - Multi-campaign sampling is balanced per campaign with minimum 30 threads per campaign (20 positive / 10 negative).
- Deletion:
  - Admin delete is soft delete + audit log
  - Admin restore is required

## Success Criteria
- [x] A workspace user can create a chat session, ask a seed question, and receive an answer grounded in analytics for the selected window/campaign scope.
- [x] The seed question builds a context pack using representative threads:
  - single scope: 75 threads (50 positive / 25 negative)
  - multi-campaign: 30 per campaign with balanced sampling
  - “All campaigns” respects cap (default 10)
- [x] Subsequent questions reuse the stored context pack (no full-thread re-send per question).
- [x] Time window selection persists as a DB-backed preference and is applied when starting a session/pack.
- [x] Admin controls exist: delete/restore sessions; recompute/delete context packs; audit events recorded.
- [x] Cron computes booked-meeting lead summaries within ~10 minutes and stores them for reuse.
- [x] AI Personality settings include model + reasoning effort selectors (Low/Medium/High; Extra High only for `gpt-5.2`) and action-tool toggles (off by default).
- [x] `npm run lint` and `npm run build` pass; Prisma schema changes are applied via `npm run db:push`.

## Subphase Index
* a — Data contracts + thread selection rules
* b — Persistence model (memory), permissions, retention, audit
* c — LLM runtime, context optimization, and orchestration (read-only)
* d — Frontend UX (Insights Console) + AI Personality settings wiring
* e — Cron booked summaries + validation checklist

## Phase Summary
- DB/memory layer: `prisma/schema.prisma` (sessions/messages/packs/user prefs/audit; lead-level cached summaries).
- Backend orchestration: `actions/insights-chat-actions.ts` (seed → compute tick → synthesize; follow-ups use stored pack).
- Context-efficient LLM pipeline: `lib/insights-chat/thread-selection.ts`, `lib/insights-chat/thread-extractor.ts`, `lib/insights-chat/pack-synthesis.ts`, `lib/insights-chat/chat-answer.ts`.
- Prompt templates: `lib/ai/prompt-registry.ts` (insights.* templates).
- UI: `components/dashboard/insights-chat-sheet.tsx` (mounted in `components/dashboard/analytics-view.tsx`); settings wiring in `components/dashboard/settings-view.tsx`.
- Cron booked summaries: `app/api/cron/insights/booked-summaries/route.ts` scheduled in `vercel.json`.

