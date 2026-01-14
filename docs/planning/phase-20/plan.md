# Phase 20 — Draft Generation + Availability + GHL Hardening (Tokens, Timeouts, Rate Limits)

## Purpose
Eliminate AI-draft max-token failures and reduce webhook/cron reliability issues by timeboxing LLM + calendar fetches, adding provider fallbacks, and hardening GHL sync against rate limits and bad inputs.

## Context
- Vercel logs show inbound SMS webhooks completing message insert/classification but draft generation failing with `incomplete=max_output_tokens` and occasional OpenAI 500s; long-running webhook work can hit 25s "no initial response" and 300s runtime timeouts.
- Availability cron refresh intermittently times out fetching GHL booking pages (e.g. `https://api.gohighlevel.com/widget/bookings/...`), leading to missing availability data.
- GHL sync paths show recurring 429/too-many-requests and PIT-context errors during `Sync All`, plus 400s from invalid test contact IDs and phone validation errors (`Invalid country calling code`).
- Webhook ingestion sometimes races lead creation, hitting Prisma unique constraint on `ghlContactId` (P2002).

## Objectives
* [ ] Increase AI draft output token budget (3x) and add strict timeouts/retries
* [ ] Ensure webhooks/crons are timeboxed and never block on long LLM calls
* [ ] Make availability refresh resilient via provider API fallbacks (GHL/Calendly) using the workspace auto-booking calendar config
* [ ] Reduce GHL sync errors by adding concurrency limits + improved 429 backoff + input normalization
* [ ] Remove webhook race conditions (P2002) via upsert/idempotency improvements

## Constraints
- Vercel runtime limits: functions can be stopped if no initial response within ~25s; hard cap observed at 300s. Prefer chunking/time budgets over relying on raising to 900s unless plan/features allow it.
- Never log secrets (API keys, tokens, cookies) or leak message bodies to client logs/subscriptions.
- Multi-tenant safety: all sync/availability operations must remain workspace-scoped.

## Success Criteria
- [x] AI draft generation no longer fails with `incomplete=max_output_tokens` in normal cases; when it does, it retries or gracefully skips without timing out the webhook.
- [x] GHL SMS webhook returns reliably without 25s/300s timeouts; created messages appear immediately; draft generation happens async or within a strict time budget.
- [x] Availability refresh succeeds for GHL widget booking URLs with a fallback path; timeouts are bounded and errors are surfaced per-workspace instead of silently.
- [x] `Sync All` for a 40–80 lead workspace completes with minimal 429s (bounded concurrency) and controlled retries.
- [x] GHL contact upsert errors for invalid phone/country codes are prevented or handled without breaking the flow.
- [x] Webhook no longer fails with Prisma P2002 on `ghlContactId`.

## Subphase Index
* a — AI draft token/time budget + retry strategy
* b — Availability refresh fallback (GHL/Calendly) using auto-booking calendar
* c — GHL sync rate-limit + concurrency controls + input normalization
* d — Webhook robustness (idempotency, P2002 race handling, response fast-path)
* e — Observability + config healing (EmailBison sender IDs, surfaced errors, docs)

---
## Phase Summary
- Increased AI draft token budgets (3x by default), added retry for `max_output_tokens`, and timeboxed webhook draft generation (`lib/ai-drafts.ts`, `app/api/webhooks/*/route.ts`).
- Made availability refresh more resilient by caching resolved provider IDs and falling back to workspace auto-book config (`lib/calendar-availability.ts`, `lib/availability-cache.ts`).
- Reduced GHL sync blast radius by bounding `Sync All` concurrency and improving 429/PIT backoff; skipped invalid contact IDs (`actions/message-actions.ts`, `lib/ghl-api.ts`, `lib/conversation-sync.ts`).
- Prevented webhook lead-create races by handling Prisma `P2002` on `ghlContactId` and hardened middleware for `/api/*` routes (`lib/lead-matching.ts`, `lib/supabase/middleware.ts`).
- Added EmailBison sender ID self-healing and documented new env knobs (`actions/email-actions.ts`, `lib/reactivation-engine.ts`, `README.md`).
