# Phase 33 — Lead Scoring System (Dual-Axis: Fit + Intent)

## Purpose

Revamp the lead scoring system from interest-based scoring to a dual-axis system that evaluates both **Fit** (how well the lead matches the client's ideal customer profile) and **Intent** (how ready the lead is to take action), outputting a 1-4 scale score.

## Context

The current system lacks objective lead quality measurement, leading to client disputes about lead quality. Rayne identified that:

1. **Percentage-based scoring triggers "school grade" psychology** — 70% feels like a C grade, even if it's actually good
2. **A 1-4 scale is cleaner** — "Three out of four sounds much better than a fucking 75 for sure"
3. **Dual-axis evaluation is more accurate** — A lead can be a perfect fit but have low intent, or vice versa

**Scale Definition:**
- **1:** Disqualified (Blacklist / Opt-out) OR not a fit at all (lowest priority)
- **2:** Could be a fit but low intent
- **3:** Definitely a fit but not high intent
- **4:** High fit + high intent (best leads)

**Business Value:**
- Clients can't argue about lead quality with objective scoring
- Filter/prioritize leads by score in the inbox
- Track show rates by lead score to validate and optimize the system

## Objectives

* [x] Add lead scoring fields to the data model
* [x] Build AI scoring engine that evaluates fit + intent from conversation context
* [x] Integrate scoring into the message processing pipeline (email path; other channels in Phase 35)
* [x] Display scores in the UI with filtering capabilities (Inbox + CRM)

## Constraints

- Score must be integer:
  - `null` = unscored (no inbound reply / insufficient info yet)
  - `1-4` = scored range (lower is worse)
  - Disqualified leads (Blacklist / opt-out) are never AI-scored; set `overallScore=1` deterministically (no AI call)
- Scoring should use `gpt-5-nano` for cost control
- Scoring should consider both individual messages and full conversation history
- Must work across all channels (SMS, Email, LinkedIn)
- Should leverage existing AI infrastructure (OpenAI, prompt registry)
- Scores should update on each new inbound message (re-score; no “only score once” behavior)

## Repo Reality Check (RED TEAM)

- What exists today:
  - Lead data model: `prisma/schema.prisma` (`model Lead`)
  - Prompt templates: `lib/ai/prompt-registry.ts` (used by `lib/sentiment.ts`, `lib/ai-drafts.ts`, etc.)
  - Webhook ingestion routes:
    - `app/api/webhooks/email/route.ts`
    - `app/api/webhooks/ghl/sms/route.ts`
    - `app/api/webhooks/linkedin/route.ts`
  - Email AI work is already offloaded to background jobs (to avoid webhook timeouts):
    - `lib/background-jobs/email-inbound-post-process.ts`
    - cron runner: `app/api/cron/background-jobs/route.ts` (scheduled in `vercel.json`)
  - Inbox/CRM data touch points:
    - Inbox conversations: `actions/lead-actions.ts` + `components/dashboard/inbox-view.tsx`
    - CRM: `actions/crm-actions.ts` + `components/dashboard/crm-view.tsx`
- What the plan currently assumes (and must be made explicit):
  - Scoring can run “after webhooks” without increasing webhook latency/timeouts
  - “ICP” exists as a structured field (it currently does not; add a dedicated ICP field to `WorkspaceSettings` under AI Personality settings)
- Verified touch points:
  - `lib/sentiment.ts` already uses strict JSON-schema output + `runResponseWithInteraction`; lead scoring should follow the same pattern for reliability and telemetry.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Email webhook timeouts if scoring is synchronous → run scoring in the email background job path (not inline in `app/api/webhooks/email/route.ts`).
- Re-score storms + cost blowups (score on every inbound message) → use `gpt-5-nano`, cap transcript/messages, and enforce strict timeouts/budgets; keep debounce as a future escape hatch if needed.
- Invalid/unstable LLM output (scores outside 1-4, missing fields) → enforce `json_schema` with integer enums and strict validation; reject bad outputs (leave null) rather than writing invalid scores.

### Missing or ambiguous requirements
- ICP source of truth → use `WorkspaceSettings.serviceDescription`, `WorkspaceSettings.qualificationQuestions`, and lead/company metadata; define fallback behavior when those are missing (bias toward “unknown”/lower fit rather than guessing high).
- Trigger conditions → inbound-only; skip outbound-only transcripts; align with opt-out/bounce/blacklist handling so we don’t “upgrade” disqualified leads.

### Repo mismatches (fix the plan)
- Webhook paths in code are `app/api/webhooks/...` (not `/api/webhooks/...`).
- Inbox data and filtering live in `actions/lead-actions.ts` and `components/dashboard/inbox-view.tsx` (not only `actions/crm-actions.ts`).

### Data model & migrations
- Filtering/sorting by score needs DB indexes (e.g., `clientId + overallScore + updatedAt`) and `scoreReasoning` likely needs `@db.Text`.
- Decide whether score history/backfill is in-scope; otherwise explicitly defer it.

### Testing / validation
- Add explicit validations: `npm run lint`, `npm run build`, and at least one end-to-end trigger per channel (inbound webhook → score fields updated on Lead → UI shows/filter works).

## Success Criteria

- [x] Lead model has `fitScore`, `intentScore`, `overallScore`, `scoreReasoning`, and `scoredAt` fields (nullable)
- [x] Workspace settings includes a dedicated ICP field (AI Personality settings) used in scoring prompts
- [x] AI scoring uses `gpt-5-nano` + strict structured output (JSON schema) and never writes out-of-range scores
- [ ] Scores automatically update on every new inbound message without jeopardizing webhook latency (run via a dedicated background job type; aligned with Phase 35 architecture)
- [x] Blacklist/opt-out leads are never AI-scored; set `overallScore=1`
- [x] UI displays unscored (`null`) as `-` (never render literal "null")
- [x] Inbox UI shows lead scores with ability to filter by score
- [x] Backfill script exists to enqueue scoring for existing leads (re-score everyone; safe batching)

**Stretch (optional / follow-on):**
- [ ] Analytics can segment meeting outcomes (booked/show/no-show where available) by `overallScore`

## Non-Goals

- Manual score overrides (would reintroduce subjective disputes)
- Full score history UI (can be a later phase if needed)
- Replacing sentiment tagging (lead scoring is additive)

## Subphase Index

* a — Schema & Data Model
* b — AI Scoring Engine
* c — Pipeline Integration
* d — UI Display & Filtering
* e — Hardening & Repo Reality Fixes (RED TEAM)
* f — AI Personality ICP Field (Settings UI)
* g — Backfill Existing Leads

## Phase Summary

- Shipped:
  - Prisma lead score fields + indexes (`fitScore`, `intentScore`, `overallScore`, `scoreReasoning`, `scoredAt`)
  - Dedicated ICP field in AI Personality settings (`WorkspaceSettings.idealCustomerProfile`)
  - Lead scoring engine using `gpt-5-nano` with strict JSON-schema output; disqualified leads set to `overallScore=1`; outbound-only leads remain `null`
  - `LEAD_SCORING_POST_PROCESS` background job type + handler; scoring enqueued from email inbound post-process
  - Inbox: overall score badge + server-side filter options
  - Backfill/rescore script to enqueue scoring jobs in batches (run-until-done + resumable checkpointing)
- Verified (2026-01-18):
  - `npm run lint`: pass (warnings only)
  - `npm run build`: pass
  - `npm run db:push`: pass (already in sync)
- Notes:
  - Scoring job enqueue is currently only wired for Email; Phase 35 should wire SMS next, then LinkedIn (Instantly/SmartLead are email-provider variants).
  - `null` (unscored) renders `-`; disqualified leads are stored/displayed as score `1` (legacy `0` values are normalized to `1` in the badge).
  - CRM uses `overallScore` (legacy `leadScore` no longer used in the CRM list).
