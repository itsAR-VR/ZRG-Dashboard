# Phase 18c — LLM Runtime, Context Optimization, and Orchestration (Read‑Only v1)

## Focus
Implement the LLM pipeline and orchestration that produces high-signal, context-efficient insights:
1) per-thread extraction (full thread in, compact JSON out)
2) cross-thread synthesis into a reusable session context pack
3) follow-up answers grounded in stored pack + analytics snapshot

## Inputs
- Phase 18a thread selection + transcript contract
- Phase 18b persistence model (packs, lead insights, prefs)
- Existing OpenAI Responses API wrapper + telemetry utilities

## Work
- LLM config:
  - Workspace AI Personality settings store: model + reasoning effort
  - Defaults: `gpt-5-mini` + `medium`
  - Efforts: low/medium/high for all; extra_high only for `gpt-5.2`
  - Strict coercion/validation server-side
- Context efficiency:
  - Per-thread extractor gets full normalized transcript (with map-reduce compression when oversized)
  - Store extracted “Conversation Insight” JSON on the lead for reuse
  - Session context pack stores only compact artifacts; follow-ups never re-send full threads
- Orchestration:
  - Seed question triggers pack build (incremental compute ticks + polling for serverless safety)
  - Subsequent questions require pack COMPLETE
- Guardrails:
  - Answers must be grounded in analytics snapshot JSON (no hallucinated numbers)

## Output
- Implemented runtime config (model + effort coercion):
  - `lib/insights-chat/config.ts` (`gpt-5-mini|gpt-5.1|gpt-5.2` + effort validation; extra_high only for `gpt-5.2`)
  - `actions/insights-chat-actions.ts` loads `WorkspaceSettings.insightsChatModel/insightsChatReasoningEffort`
- Implemented context-efficient LLM pipeline:
  - Per-thread extractor: `lib/insights-chat/thread-extractor.ts`
    - full normalized transcript in (`lib/insights-chat/transcript.ts`)
    - oversized threads: chunked map-reduce compression via prompt `insights.thread_compress.v1`
    - outputs compact JSON “Conversation Insight” and stores it in `LeadConversationInsight`
  - Pack synthesis: `lib/insights-chat/pack-synthesis.ts`
    - if pack is large (>120 insights), summarizes per campaign first then runs final synthesis
  - Follow-up answers: `lib/insights-chat/chat-answer.ts`
- Implemented orchestration for serverless safety:
  - `actions/insights-chat-actions.ts:runInsightContextPackStep()` executes select → extract batch → synthesize and is safe to poll from UI
- Added prompt templates in `lib/ai/prompt-registry.ts`:
  - `insights.thread_compress.v1`
  - `insights.thread_extract.v1`
  - `insights.pack_campaign_summarize.v1`
  - `insights.pack_synthesize.v1`
  - `insights.chat_answer.v1`
- Added evaluation scaffolding (direct scoring, JSON schema outputs): `lib/insights-chat/eval.ts`

## Handoff
Phase 18d wires the UX (Insights Console + settings UI) to these actions and shows progress/admin controls.

