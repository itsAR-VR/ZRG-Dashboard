# Phase 115a - Context Sources + Agentic Selector (Auto-Send)

## Focus
Provide a compact, high-signal "optimization context" for auto-send revision by pulling in:
1) the latest Message Performance synthesis ("what worked / failed" for booked meetings), and
2) the most relevant Insights context pack,
then using an LLM selector step ("agentic search") to pick only the most similar/relevant sections for the current draft + inbound.

## Inputs
- Auto-send case inputs (already available in runtime context):
  - `channel`, `latestInbound`, `subject`, `conversationHistory`, `draft`, evaluator `{ confidence, reason }`
  - optional lead memory context (already available when LeadContextBundle is enabled)
- Persisted artifacts:
  - Message Performance pack: `InsightContextPack` found via `InsightsChatSession` with `title = "Message Performance"` (reuse `MESSAGE_PERFORMANCE_SESSION_TITLE` constant from `lib/message-performance-report.ts:8`), then `InsightContextPack` by `sessionId + status=COMPLETE + computedAt desc`
  - Insights pack: `InsightContextPack.synthesis` structured fields (`key_takeaways`, `recommended_experiments`, `data_gaps`) from `lib/insights-chat/pack-synthesis.ts`. **Note:** Skip raw `pack_markdown` for v1 (PII risk from `evidence_quotes` — see RED TEAM RT-12).
- Telemetry constraints: stats-only `AIInteraction.metadata` (Phase 112)

## Work
1. Implement context fetch helpers (server-only):
   - `getLatestMessagePerformanceSynthesis(clientId)`:
     - **Step 1:** Find `InsightsChatSession` where `title = MESSAGE_PERFORMANCE_SESSION_TITLE` (reuse constant from `lib/message-performance-report.ts:8`) and `clientId` matches and `deletedAt = null`
     - **Step 2:** Find latest `InsightContextPack` where `sessionId = session.id` and `status = "COMPLETE"` and `deletedAt = null`, order by `computedAt desc`, take 1
     - **Step 3:** Parse `synthesis` Json field as `MessagePerformanceSynthesis` type (import from `lib/message-performance-synthesis.ts:9`)
     - Extract: `summary`, `highlights`, `patterns`, `antiPatterns`, `recommendations`, `caveats`, `confidence`
   - `getMostRelevantInsightsPack(clientId, campaignId | null)`:
     - prefer latest COMPLETE pack where `effectiveCampaignIds: { has: campaignId }` (Prisma array `has` operator) if `campaignId` provided
     - else pick latest COMPLETE pack excluding packs from the `Message Performance` session (find session ID first, then `sessionId: { not: mpSessionId }`)
     - Extract structured fields only: `synthesis.key_takeaways`, `synthesis.recommended_experiments`, `synthesis.data_gaps`. **Do NOT use `pack_markdown`** (PII risk — RT-12).
   - Guardrails:
     - cap lookback window for packs (default 30d via `computedAt >= now - 30d`) to avoid stale guidance
     - if no packs exist, selector is skipped (revision proceeds without optimization context, or skips revision entirely per 115b rules)

2. Build candidate "chunks" for selector input (deterministic, no embeddings in v1):
   - Convert Message Performance synthesis into 10-25 short bullets:
     - `what_worked` from `highlights[]` + `patterns[]` + high-confidence `recommendations[]` (filter `confidence >= 0.7`)
     - `what_failed` from `antiPatterns[]` + `caveats[]`
     - Include `summary` as a single overview chunk
   - Convert Insights pack structured fields into individual bullet chunks:
     - Each `key_takeaways[]` item → one chunk (source: `insights_pack`, type: `takeaway`)
     - Each `recommended_experiments[]` item → one chunk (source: `insights_pack`, type: `experiment`)
     - Each `data_gaps[]` item → one chunk (source: `insights_pack`, type: `gap`)
     - (**Skip `pack_markdown`** — PII risk per RT-12; enable in future phase with PII scrubber)
   - Add a lightweight lexical prefilter:
     - extract keywords from `(latestInbound + draft + evaluator.reason)` and score chunks by token overlap
     - keep top N chunks (e.g. 24) to bound selector prompt size

3. Add selector prompt template:
   - Prompt key: `auto_send.context_select.v1`
   - FeatureId: `auto_send.context_select`
   - Model: `gpt-5-mini` (or the existing "small, cheap" default), reasoningEffort `low`, temperature `0`
   - **Timeout: 10_000ms** (10s hard limit — RT-10; fail → return null, revision proceeds without context)
   - Input JSON includes:
     - case summary (channel, inbound summary, draft summary, evaluator reason)
     - candidate chunks: `{ id, source: "message_performance"|"insights_pack", text }[]`
   - Output strict JSON schema:
     - `selected_chunk_ids: string[]` (max 8)
     - `selected_context_markdown: string` (assembled, max 2500 chars)
     - `what_to_apply: string[]` (max 10)
     - `what_to_avoid: string[]` (max 10)
     - `missing_info: string[]` (max 6)
     - `confidence: number` (0-1)
   - Hard rules:
     - no PII (no emails, phones, URLs); no raw quoting from inbound
     - keep outputs short; prefer actionable directives

4. Telemetry (stats-only):
   - Add metadata fields (sanitized allowlist):
     - `chunks_considered`, `chunks_selected`, `sources_used`, `selector_confidence`
     - `mp_pack_present`, `insights_pack_present`

5. Tests
   - Unit tests for deterministic chunking + prefilter:
     - ensures stable ordering and caps
   - Unit tests for pack selection:
     - prefers campaign-matching pack when available
     - excludes `Message Performance` pack from Insights pack retrieval

## Output
- `lib/auto-send/optimization-context.ts`:
  - loads latest Message Performance synthesis + latest Insights pack synthesis (structured fields only)
  - builds redacted candidate chunks
  - deterministic lexical prefilter + LLM selector (`auto_send.context_select.v1`)
- `lib/ai/prompt-registry.ts`:
  - new prompt key `auto_send.context_select.v1` (featureId `auto_send.context_select`)
- `lib/__tests__/auto-send-optimization-context.test.ts`:
  - unit tests for deterministic ranking behavior

## Handoff
Provide `selected_context_markdown` + apply/avoid bullets to Phase 115b as the optimization context for the reviser prompt.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented optimization context loader + chunking + selector prompt (`lib/auto-send/optimization-context.ts`).
  - Registered selector prompt template (`lib/ai/prompt-registry.ts`).
  - Added unit tests for ranking behavior (`lib/__tests__/auto-send-optimization-context.test.ts`).
- Commands run:
  - `npm test` — pass
  - `npm run lint` — pass (warnings only, pre-existing)
  - `npm run build` — pass
- Blockers:
  - None
- Next concrete steps:
  - Wire selection output into revision agent prompt input (Phase 115b).
