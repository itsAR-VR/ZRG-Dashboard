# Phase 30 — Two-Step AI Draft Generation with Response Variation

## Purpose

Implement a two-step AI drafting approach for email responses that separates reasoning/analysis from generation, enabling structurally unique outputs for every lead while adding model selection to workspace settings.

## Context

The current single-step AI drafting in `lib/ai-drafts.ts` produces responses that are too similar/templated. Email providers (especially Outlook) detect templated content, hurting deliverability on second emails. The solution is:

1. **Step 1 (Reasoning)**: Analyze the lead deeply — all custom variables, conversation history, sentiment, company info — and produce a personalized response strategy/skeleton
2. **Step 2 (Generation)**: Use a high-temperature, no-reasoning call to generate structurally varied output based on the reasoning

Key quote from requirements: *"We should not even have one email that's the same. And I'm not talking about like the same as in one word's changed. I'm talking about the entire thing."*

Additionally, users want control over which model powers draft generation (GPT 5.1 vs 5.2, with reasoning level selection).

## Repo Reality Check (RED TEAM)

- `lib/ai-drafts.ts` generates email drafts in a single `runResponse()` call (Responses API), with a fixed model (`gpt-5.1`) and fixed reasoning effort (`medium`).
- Draft generation is called from multiple webhooks (`app/api/webhooks/*`) and may run under tight OpenAI timeouts (e.g. `OPENAI_DRAFT_WEBHOOK_TIMEOUT_MS`, default 30s in SmartLead webhook).
- Workspace settings already have an admin-gated model + reasoning selector for Insights Chatbot (`WorkspaceSettings.insightsChatModel/insightsChatReasoningEffort`), with server-side coercion logic in `lib/insights-chat/config.ts`.
- Prompt templates are centrally listed in `lib/ai/prompt-registry.ts` for observability; email draft generation currently has a single template key: `draft.generate.email.v1`.

## RED TEAM Findings (Gaps / Weak Spots)

1. **Variation isn't guaranteed by temperature alone**: some models reject/ignore `temperature`, and even when supported, outputs can converge. We need an explicit *structure-variation driver* (archetypes) in addition to temperature.
2. **Reasoning output format is underspecified**: Step 1 needs a strict JSON schema (Structured Outputs) + parse/fallback behavior, otherwise Step 2 becomes brittle.
3. **Settings inputs are untrusted**: model/effort values are stored as strings and must be coerced server-side (extra_high only for gpt-5.2), with sane defaults when null.
4. **Two-step doubles OpenAI calls**: webhooks may time out or slow down. We need per-step token/time budgets and a graceful single-step fallback.
5. **Archetype selection needs a stable seed per attempt**: ensure retries inside a single request keep the same archetype, but regenerations without `triggerMessageId` can vary.

## Objectives

* [x] Create two-step email drafting pipeline: **strategy (JSON) → generation (text)**
* [x] Add per-workspace model + reasoning settings for the **strategy** step (gpt-5.1 / gpt-5.2; low/medium/high/extra_high)
* [x] Add a deterministic **structure archetype** selector (10 variants) + high-temperature generation
* [x] Maintain telemetry for both steps (distinct `featureId` + `promptKey`)
* [x] Keep backward-compatible single-step fallback
* [x] Build UI controls in Settings (admin-gated workspace-wide)

## Constraints

- Must work within existing `runResponse` / `runResponseWithInteraction` telemetry infrastructure
- Email channel is the primary focus (SMS can remain single-step for now)
- Must not break existing webhook/cron flows that trigger draft generation
- Settings UI changes should follow existing patterns in `settings-view.tsx`
- Available models: `gpt-5.1` (all reasoning levels), `gpt-5.2` (all reasoning levels)
- Reasoning levels: `low`, `medium`, `high`, `extra_high` (extra_high only for gpt-5.2)
- Preserve idempotency semantics (`triggerMessageId` returning existing drafts)
- Do not leak Step 1 content into the draft output; Step 1 is strategy only
- Be mindful of webhook timeouts: two-step should degrade gracefully when time/token budgets are too tight
- Schema change is additive: no backfill required; treat null settings as defaults

## Success Criteria

1. [ ] Email drafts are structurally different even for identical lead responses (e.g., 10 "yes, I want a call" leads get 10 unique *structures*, not just synonyms). (partial: implementation present; needs manual validation)
2. [x] Model and reasoning level are configurable per workspace via Settings UI (admin-gated), and invalid combos are coerced server-side (extra_high only for gpt-5.2).
3. [ ] Both strategy and generation steps are logged to `AIInteraction` for cost tracking (2 rows per email draft attempt). (partial: implementation present; needs runtime verification)
4. [ ] Existing draft generation continues to work via a safe fallback path. (partial: implementation present; needs runtime verification)
5. [x] `npm run lint` + `npm run build` pass (no type errors).

## Non-Goals (Keep Scope Contained)

- Separate model configs for strategy vs generation (single shared model for now)
- Two-step pipeline for SMS/LinkedIn
- “Regenerate N variants” UI (future)

## Subphase Index

* a — Schema + settings plumbing (Prisma + `actions/settings-actions.ts`)
* b — Core: Two-step pipeline + variation archetypes (`lib/ai-drafts.ts` + prompt registry)
* c — UI: Add model/reasoning selection to Settings (`components/dashboard/settings-view.tsx`)
* d — Integration: Wire up settings to draft generation, verify webhooks/telemetry end-to-end

## Phase Summary

- Shipped:
  - Two-step email drafting pipeline (strategy JSON → generation text) with archetype-driven structure variation.
  - Workspace settings for draft generation model/reasoning (schema + server actions + Settings UI).
  - Prompt registry templates + feature IDs for strategy/generation observability.
- Verified:
  - `npm run lint`: pass (warnings) (2026-01-17T14:50:15+03:00)
  - `npm run build`: pass (2026-01-17T14:50:45+03:00)
  - `npm run db:push`: pass (DB already in sync) (2026-01-17T14:51:11+03:00)
  - `npx tsc --noEmit`: pass (2026-01-17, fixed pre-existing TS errors in `lib/conversation-sync.ts`)
- Notes:
  - Manual end-to-end validation (webhooks + `AIInteraction` evidence + draft variation spot-checks) was not performed here.
  - Working tree includes additional changes outside Phase 30 scope; see `docs/planning/phase-30/review.md`.
