# Phase 22a — AI Execution Inventory (Entry Points → Features)

This inventory is based on code search for:
- OpenAI client usage (`openai.*`) and telemetry wrapper usage (`runResponse*`)
- known AI modules (`lib/sentiment`, `lib/ai-drafts`, `lib/insights-chat/*`, `lib/followup-engine`, `lib/knowledge-asset-extraction`)

## AI Features (featureId)

**Prompt-registry backed (from `lib/ai/prompt-registry.ts`)**
- `sentiment.classify`
- `sentiment.email_inbox_analyze`
- `draft.generate.sms`
- `draft.generate.email`
- `draft.generate.linkedin`
- `auto_reply_gate.decide`
- `auto_send.evaluate`
- `signature.extract`
- `timezone.infer`
- `followup.parse_accepted_time`
- `followup.detect_meeting_accept_intent`
- `insights.thread_compress`
- `insights.thread_extract`
- `insights.pack_campaign_summarize`
- `insights.pack_synthesize`
- `insights.chat_answer`

**Code-only (not in prompt registry)**
- `insights.answer_judge` (LLM judge/eval for insights answers)
- `knowledge_assets.summarize_text`
- `knowledge_assets.ocr_pdf`
- `knowledge_assets.ocr_image`

## AI Entry Points (Routes / Jobs / Actions)

### Webhooks (App Router routes)

- `app/api/webhooks/email/route.ts`
  - Sentiment: `sentiment.classify`, `sentiment.email_inbox_analyze`
  - Drafts: `draft.generate.email`
  - Auto-reply / auto-send: `auto_reply_gate.decide`, `auto_send.evaluate`
  - Signature extraction: `signature.extract`
  - Timezone inference (fallback): `timezone.infer`

- `app/api/webhooks/ghl/sms/route.ts`
  - Sentiment: `sentiment.classify`
  - Drafts: `draft.generate.sms`
  - Auto-reply / auto-send: `auto_reply_gate.decide`, `auto_send.evaluate`
  - Timezone inference (fallback): `timezone.infer`

- `app/api/webhooks/linkedin/route.ts`
  - Sentiment: `sentiment.classify`
  - Drafts: `draft.generate.linkedin`
  - Signature/contact extraction: `signature.extract` (message-content extraction)

- `app/api/webhooks/instantly/route.ts`
  - Sentiment: `sentiment.classify`
  - Drafts: `draft.generate.email`
  - Auto-reply / auto-send: `auto_reply_gate.decide`, `auto_send.evaluate`
  - Timezone inference (fallback): `timezone.infer`

- `app/api/webhooks/smartlead/route.ts`
  - Sentiment: `sentiment.classify`
  - Drafts: `draft.generate.email`
  - Auto-reply / auto-send: `auto_reply_gate.decide`, `auto_send.evaluate`
  - Timezone inference (fallback): `timezone.infer`

### Cron (App Router routes)

- `app/api/cron/followups/route.ts`
  - Follow-up AI helpers (when needed): `followup.parse_accepted_time`, `followup.detect_meeting_accept_intent`
  - May indirectly trigger other AI features depending on follow-up flows (e.g. drafts/timezone inference).

- `app/api/cron/insights/booked-summaries/route.ts`
  - Insight extraction for booked leads: `insights.thread_compress`, `insights.thread_extract` (via `extractConversationInsightForLead`)

- `app/api/cron/ai-retention/route.ts`
  - No LLM calls (prunes `AIInteraction` records).

### Server Actions

- `actions/message-actions.ts`
  - Sentiment classification (post-ingestion / UI flows): `sentiment.classify`
  - Draft generation: `draft.generate.*` (via `regenerateDraft` and related flows)

- `actions/insights-chat-actions.ts`
  - Thread extraction/compression: `insights.thread_compress`, `insights.thread_extract`
  - Context pack synthesis: `insights.pack_campaign_summarize`, `insights.pack_synthesize`
  - Chat answer: `insights.chat_answer`
  - Answer eval: `insights.answer_judge`

- `actions/settings-actions.ts`
  - Knowledge asset extraction: `knowledge_assets.*`

## Observability Coverage Notes (Gaps / Risks)

- **LLM calls are centralized**: The only direct OpenAI client calls are in:
  - `lib/ai/openai-telemetry.ts` (Responses API calls; writes `AIInteraction`)
  - `lib/ai/token-budget.ts` (OpenAI input token count endpoint used for budgeting)

- **Potential gap**: `openai.responses.inputTokens.count` (budget sizing) is not persisted to `AIInteraction`.
  - If we care about *API spend* beyond model generations, we may need to track it separately.
  - If we only care about *model usage tokens*, current telemetry is sufficient.

- **UI naming drift**: `actions/ai-observability-actions.ts` has a hard-coded `featureId → name` map that does not cover all features (notably `insights.*` and `knowledge_assets.*`), causing raw ids in the dashboard.

- **Pricing drift**: `lib/ai/pricing.ts` only has defaults for a small set of models; new models will show `costComplete=false` until `AI_MODEL_PRICING_JSON` is configured.

