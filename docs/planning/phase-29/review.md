# Phase 29 — Review

## Summary
- Shipped deterministic message `response_type` classification and threaded transcript annotations so Insights can weight follow-up responses above first-touch outreach.
- Upgraded the thread-extract schema to include follow-up-specific fields (`follow_up`, `follow_up_effectiveness`) while preserving existing v1 keys for backward compatibility.
- Updated pack synthesis + chat answer prompts to use the follow-up-weighted v2/v3 flows.
- Added a schema-upgrade re-extraction gate so cached `LeadConversationInsight` rows can be upgraded safely (`INSIGHTS_ALLOW_SCHEMA_UPGRADE_REEXTRACT`).

## What Shipped
- Deterministic message classification + transcript labeling
  - `lib/insights-chat/message-response-type.ts`
  - `lib/insights-chat/message-classifier.ts`
  - `lib/insights-chat/transcript.ts`
- Follow-up-weighted insight extraction schema
  - `lib/insights-chat/thread-extractor.ts` (`CONVERSATION_INSIGHT_SCHEMA_VERSION = "v2_followup_weighting"`)
- Follow-up-weighted pack synthesis
  - `lib/insights-chat/pack-synthesis.ts`
- Follow-up-weighted insights chat answers + citations
  - `lib/insights-chat/chat-answer.ts`
  - `lib/ai/prompt-registry.ts` (`insights.chat_answer.v3`, plus related prompt keys)
- Cached-insight upgrade gating (re-extract)
  - `lib/insights-chat/context-pack-worker.ts`
  - `actions/insights-chat-actions.ts`
  - `app/api/cron/insights/booked-summaries/route.ts`

## Verification

### Commands
- `npm run lint` — **PASS** (0 errors, warnings only) (2026-01-18T13:08:31+03:00)
- `npm run build` — **PASS** (2026-01-18T13:08:31+03:00)
- `npm run db:push` — **PASS** (“already in sync”) (2026-01-18T13:08:31+03:00)

### Notes
- Previous sandbox-only Turbopack build failure (“binding to a port … Operation not permitted”) could not be reproduced during re-verification on 2026-01-18.

## Success Criteria → Evidence

1) Transcripts label each message with a deterministic `response_type` (at minimum: `initial_outbound`, `follow_up_response`, `inbound`)
   - Evidence:
     - `lib/insights-chat/message-classifier.ts`
     - `lib/insights-chat/transcript.ts` (annotates `response_type=...`)
   - Status: met

2) `ConversationInsight` includes follow-up-focused fields (patterns + effectiveness) while keeping existing top-level keys intact
   - Evidence:
     - `lib/insights-chat/thread-extractor.ts` (`ConversationInsightSchema` includes `follow_up` + `follow_up_effectiveness`, and preserves v1 keys)
   - Status: met

3) Pack markdown leads with follow-up response learnings; cold outreach learnings are explicitly secondary
   - Evidence:
     - `lib/insights-chat/pack-synthesis.ts` (compacts + passes follow-up fields into synthesis input; uses follow-up-weighted prompt)
   - Status: met (implementation-level; output quality requires runtime validation on real packs)

4) Insights chat answers default to follow-up language recommendations unless the user explicitly asks about first-touch outreach
   - Evidence:
     - `lib/insights-chat/chat-answer.ts` uses `insights.chat_answer.v3` and includes follow-up metadata in `thread_index`
   - Status: met (implementation-level; prompt behavior requires runtime validation on real sessions)

5) Backfill strategy exists so cached `LeadConversationInsight` rows upgrade to the new schema
   - Evidence:
     - `lib/insights-chat/thread-extractor.ts` schema version constant (`CONVERSATION_INSIGHT_SCHEMA_VERSION`)
     - `INSIGHTS_ALLOW_SCHEMA_UPGRADE_REEXTRACT` gating in `lib/insights-chat/context-pack-worker.ts`, `actions/insights-chat-actions.ts`, and `app/api/cron/insights/booked-summaries/route.ts`
   - Status: met

6) A/B-like breakdown is possible at the pack level (e.g. grouped by objection type), with clearly defined positive vs negative outcome
   - Evidence:
     - Objection taxonomy + follow-up effectiveness structures in `lib/insights-chat/thread-extractor.ts`
     - `lib/insights-chat/thread-index.ts` / pack synthesis path includes outcome + follow-up-weighted ranking inputs
   - Status: met (implementation-level; needs runtime validation on real datasets)

## Plan Adherence
- Matches Phase 29 intent: classification is deterministic (no AI), and follow-up learnings are first-class in the insight schema and downstream prompts.
- Known deviation: none identified in code review (Phase 29 is largely self-contained within `lib/insights-chat/*` + prompt registry + worker wiring).

## Follow-ups
- Run a real pack extraction + chat session in production/staging and spot-check:
  - `response_type` labeling on transcripts
  - follow-up sections appearing consistently in pack markdown
  - cached-insight upgrade behavior with `INSIGHTS_ALLOW_SCHEMA_UPGRADE_REEXTRACT=true`
