# Phase 29b — Follow-Up Response Extraction and Scoring

## Focus
Enhance the AI extraction to separately analyze follow-up response patterns and score their effectiveness based on conversation outcomes.

## Inputs
- Transcript messages labeled with deterministic `response_type` from subphase a
- Existing `ConversationInsight` schema in `lib/insights-chat/thread-extractor.ts` (Zod + strict JSON schema)
- Outcome enum already passed into extraction: `ConversationInsightOutcome` (`BOOKED|REQUESTED|STALLED|NO_RESPONSE|UNKNOWN`)
- Helpful metadata already present: `sentimentTag`, `appointmentBookedAt`

## Work

### Step 1: Extend ConversationInsight Schema
Update both:
- the Zod `ConversationInsightSchema`
- the strict `jsonSchema` passed to the Responses API

Recommended additions (keep arrays bounded to avoid output-token blowups):
- `schema_version: "v2_followup_weighting"` (supports Phase 29e backfills)
- `follow_up` (object, can be empty):
  - `what_worked: string[]`
  - `what_failed: string[]`
  - `key_phrases: string[]`
  - `tone_observations: string[]`
  - `objection_responses: { objection_type, agent_response, outcome }[]`
- `follow_up_effectiveness` (object, can be null if no follow-up exists):
  - `score: number` (0–100)
  - `converted_after_objection: boolean`
  - `notes: string[]` (short evidence-based bullets)

Keep the existing top-level keys (`what_worked`, `what_failed`, etc.) intact for compatibility. If necessary, allow the model to include follow-up bullets inside the existing arrays, but the new `follow_up.*` fields are the source-of-truth for Phase 29 synthesis.

### Step 2: Update Extraction Prompt
Update the prompt template in `lib/ai/prompt-registry.ts` (preferred) and bump the prompt key version (recommended) so telemetry and rollbacks are clear:
- `insights.thread_extract.v2` (or `v2_followup`) instead of mutating `v1` silently.

```markdown
## Follow-Up Response Analysis (HIGHEST PRIORITY)

The messages labeled response_type=follow_up_response are agent replies after prospect engagement.
These are the MOST IMPORTANT messages to analyze.

For follow-up responses specifically:
1. What language patterns led to positive outcomes (booking, continued engagement)?
2. What language patterns killed the conversation?
3. How did agents handle objections? What objection types appeared?
4. What phrases showed high conversion potential?
5. What tone/style observations apply specifically to follow-up responses?

Weight follow-up response analysis 3x higher than initial outreach analysis.
```

### Step 3: Follow-Up Effectiveness Scoring
Decide where the score comes from:
- **Recommended (v1):** have the LLM output a 0–100 score and short notes, then clamp/validate in code.
- Optional (future): compute an outcome-only baseline score in code and use the LLM score as a modifier.

**Base score calculation:**
- Start at 50 points
- +40 points: Outcome `BOOKED`
- +25 points: Outcome `REQUESTED`
- -10 points: Outcome `STALLED`
- -25 points: Outcome `NO_RESPONSE`
- ±0 points: `UNKNOWN`

**Outcome attribution:**
- Only score follow-up effectiveness if at least one follow-up response exists
- Attribute to the follow-up portion of the thread; do not over-credit cold outreach copy

### Step 4: Objection Response Mapping
Build a lightweight taxonomy for objection types:
- `pricing` — cost, budget, ROI concerns
- `timing` — not now, busy, check back later
- `authority` — need to check with boss/team
- `need` — not sure we need this, already have something
- `trust` — need more info, who are you, references
- `competitor` — using X, happy with current solution

Map objections inside the **same** extraction call (no extra OpenAI requests):
- only tag objection types when clearly present
- return `objection_type: "none"` (or omit) when not applicable

## Output

**Schema changes in `lib/insights-chat/thread-extractor.ts`:**
- Added `CONVERSATION_INSIGHT_SCHEMA_VERSION = "v2_followup_weighting"` constant for backfill detection
- Added `OBJECTION_TYPES` taxonomy: `pricing`, `timing`, `authority`, `need`, `trust`, `competitor`, `none`
- Extended `ConversationInsightSchema` with:
  - `schema_version` field (literal `"v2_followup_weighting"`)
  - `follow_up` object: `what_worked`, `what_failed`, `key_phrases`, `tone_observations`, `objection_responses`
  - `follow_up_effectiveness` object (nullable): `score` (0-100), `converted_after_objection`, `notes`
- Added helper functions:
  - `computeFollowUpStats(messages)` — counts follow-up/initial/inbound messages
  - `computeBaseEffectivenessScore(outcome)` — deterministic base score from outcome enum

**Prompt changes in `lib/ai/prompt-registry.ts`:**
- Added `insights.thread_extract.v2` prompt template with follow-up weighting instructions
- Prompt emphasizes `[FOLLOW-UP]` messages as "MOST IMPORTANT" (3x weight)
- Includes objection taxonomy reference for consistent classification

**Extraction changes:**
- `extractConversationInsightForLead()` now uses v2 prompt
- Input payload includes `follow_up_stats` object for model context
- JSON schema updated with full v2 structure including `anyOf` for nullable `follow_up_effectiveness`
- Token budget increased: min 800→2400, overhead 520, attempts up to 3200 tokens

**Exported types:**
- `ConversationInsight` (extended)
- `FollowUpAnalysis`
- `FollowUpEffectiveness`
- `ObjectionResponse`
- `ObjectionType`

**Build verification:** `npm run build` passes.

## Handoff
Subphase c can now:
1. Access `insight.follow_up_effectiveness?.score` for thread prioritization
2. Use `insight.follow_up_effectiveness?.converted_after_objection` for additional boost
3. Sort threads by follow-up effectiveness before outcome priority
4. Use `CONVERSATION_INSIGHT_SCHEMA_VERSION` for backfill detection in Phase 29e
