# Phase 29 — Follow-Up Response Language Effectiveness Analysis

## Purpose
Enhance the AI insights system to heavily weight and analyze the language used in follow-up responses (replies to prospect messages), identifying which response patterns convert leads to positive outcomes.

## Context
Currently, the insights system extracts `what_worked` and `what_failed` from entire conversations without distinguishing between:
- **Initial outbound messages** (cold outreach)
- **Follow-up responses** (agent replies to prospect messages)

The user wants follow-up response language to receive the **highest weighting** in LLM evaluation because:
1. Follow-up responses are direct reactions to prospect engagement—they either nurture or kill the opportunity
2. The language patterns in successful follow-ups are more valuable than initial outreach templates (which are often A/B tested separately)
3. Analyzing what agents say *in response to* prospect questions/objections reveals the most actionable optimization opportunities

Key insight from Jam: "We want to highly value that information in the AI analysis to figure out what language in follow-up responses is working the best. And that's the highest weighting in our LLM evaluation."

## What Exists Today (Repo Reality Check)
- Conversation insights are extracted in `lib/insights-chat/thread-extractor.ts` using a **strict JSON schema** (Zod + Responses API `json_schema`).
- Prompts are defined in `lib/ai/prompt-registry.ts` (e.g. `insights.thread_extract.v1`, `insights.pack_synthesize.v1`, `insights.chat_answer.v2`).
- Extracted insights are cached per-lead in `LeadConversationInsight` and **skipped** on future runs if a row already exists (pack worker + actions + booked cron).

## Objectives
* [x] Classify messages as "initial outbound" vs "follow-up response" based on conversation position
* [x] Extract and score follow-up response language patterns separately from initial outreach
* [x] Create a weighting system that prioritizes follow-up response effectiveness in insights
* [x] Surface top-performing follow-up response patterns with outcome correlation
* [x] Integrate weighted scoring into the existing insights pack synthesis

## Constraints
- Maintain backwards compatibility with existing insights extraction schema
- Follow existing AI interaction logging patterns (`AIInteraction` table)
- Respect rate limits on OpenAI calls during extraction
- Follow-up classification must be deterministic (based on message sequence, not AI inference)
- Preserve existing `what_worked` / `what_failed` structure but enrich with response-type attribution
- Do not break strict-schema parsing: update Zod schema + JSON schema + prompt in lockstep
- Avoid adding extra OpenAI calls: fold objection mapping + follow-up extraction into the existing thread extract call

## Success Criteria
- [x] Transcripts label each message with a deterministic `response_type` (at minimum: `initial_outbound`, `follow_up_response`, `inbound`)
- [x] `ConversationInsight` includes follow-up-focused fields (patterns + effectiveness) while keeping existing top-level keys intact
- [x] Pack markdown leads with follow-up response learnings; cold outreach learnings are explicitly secondary
- [x] Insights chat answers default to follow-up language recommendations unless the user explicitly asks about first-touch outreach
- [x] Backfill strategy exists so cached `LeadConversationInsight` rows upgrade to the new schema (otherwise Phase 29 has no impact for previously-processed leads)
- [x] A/B-like breakdown is possible at the pack level (e.g. grouped by objection type), with **clearly defined** "positive outcome" vs "negative outcome"

## Non-Goals (Keep Scope Contained)
- Building a full UI for “follow-up templates library” (phase later)
- Persisting new DB columns for scores unless performance forces it (JSON-only is fine initially)
- Rewriting thread selection heuristics unless we can safely leverage cached insights

## Subphase Index
* a — Message classification (initial outbound vs follow-up response)
* b — Follow-up response extraction and scoring
* c — Thread prioritization & scoring integration (fast seed, pack ordering, thread index)
* d — Pack synthesis and insights answer integration
* e — Backfill + rollout gating (cached insights upgrade path)

---

## Phase Summary

- Shipped:
  - Deterministic `response_type` classification + transcript annotations for Insights (`lib/insights-chat/message-classifier.ts`, `lib/insights-chat/transcript.ts`)
  - v2 follow-up-weighted insight schema (`lib/insights-chat/thread-extractor.ts`)
  - Pack synthesis + chat answer prompt upgrades (`lib/insights-chat/pack-synthesis.ts`, `lib/insights-chat/chat-answer.ts`, `lib/ai/prompt-registry.ts`)
  - Cached-insight upgrade gating (`INSIGHTS_ALLOW_SCHEMA_UPGRADE_REEXTRACT`)
- Verified (Sun Jan 18 11:12:49 +03 2026):
  - `npm run lint`: pass (warnings only)
  - `npm run build`: failed under Turbopack in this sandbox (see `docs/planning/phase-29/review.md`)
  - `npm run build -- --webpack`: pass
  - `npm run db:push`: skipped (Prisma config targets remote `DIRECT_URL`; requires explicit confirmation)
