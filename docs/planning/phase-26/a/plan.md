# Phase 26a — Citation schema + backend plumbing

## Focus
Define how citations are represented and returned from the Insights answer pipeline so the UI can render consistent, clickable thread references.

## Inputs
- `docs/planning/phase-26/plan.md`
- Existing Insights pipeline (sessions, messages, context packs) and thread extractor outputs.
- Existing Master Inbox deep-link pattern: `/?view=inbox&leadId=<id>`.

## Work
1. Decide citation payload shape (v1):
   - `type: "thread"`
   - `leadId`
   - optional: `leadName`, `leadEmail`, `campaignId`, `campaignName`, `sentimentTag`, `outcome`, `windowFrom/windowTo`
   - optional: `snippet` (short excerpt) and/or `insightId` for internal traceability
2. Decide where citations are stored:
   - Option A (fast): store citations as JSON on `InsightChatMessage` (or message metadata JSON).
   - Option B (normalized): new `InsightChatCitation` table keyed by `messageId` with `leadId` and display metadata.
3. Update answer generation to output citations deterministically:
   - Prefer structured output (JSON) from the LLM: `{ answerMarkdown, citations[] }`.
   - Add a fallback: if citations parsing fails, return answer without citations (never crash UI).
4. Enforce access boundaries server-side:
   - Only include citations to leads in the selected `clientId`.
   - Only return citation metadata the user can already view in the UI.
5. Add telemetry hooks:
   - Count citations per response.
   - Record “open citation” events (later, in UI subphase) for measuring usefulness.

## Output
- Implemented citation storage + schemas:
  - Prisma: added `InsightChatMessage.citations Json?` (`prisma/schema.prisma`).
  - Types: `lib/insights-chat/citations.ts` (`InsightThreadCitation`, `InsightThreadIndexItem`).
- Implemented deterministic, validated citation generation in the answer pipeline:
  - New prompt: `insights.chat_answer.v2` in `lib/ai/prompt-registry.ts` (read-only + citation rules).
  - `lib/insights-chat/chat-answer.ts` now uses `json_schema` output with `answer_markdown` + `citations[]`, validates with Zod, and maps citations to stored leadIds via `threadIndex`.
- Added thread-index builder used by chat answers:
  - `lib/insights-chat/thread-index.ts` builds `threadIndex` from `selectedLeadsMeta` + `LeadConversationInsight.summary` + lead/campaign labels (scoped to `clientId`).
- Wired citations through all answer creation paths (seed/regen/followups/cron worker):
  - `actions/insights-chat-actions.ts` + `lib/insights-chat/context-pack-worker.ts` now pass `threadIndex` and persist `citations`.
- Ran DB sync for the schema change:
  - `npm run db:push` succeeded against Supabase.

## Handoff
Phase 26b:
- Render citations in the chat UI (chips + Sources drawer) from `InsightChatMessage.citations`.
- Add “Open in Inbox” deep links using `/?view=inbox&leadId=<leadId>` and ensure layout doesn’t clip horizontally.
