# Phase 29d — Pack Synthesis and Insights Answer Integration

## Focus
Update pack synthesis and chat answering so follow-up response language is the primary “what works” signal.

## Inputs
- Prioritized threads with follow-up effectiveness scores from subphase c
- Extended `ConversationInsight` follow-up fields from subphase b
- Existing synthesis and answer pipeline:
  - `lib/insights-chat/pack-synthesis.ts` (outputs `pack_markdown`, `key_takeaways`, `recommended_experiments`, `data_gaps`)
  - `lib/insights-chat/chat-answer.ts` (outputs `answer_markdown` + citations)
  - Prompt templates in `lib/ai/prompt-registry.ts`

## Work

### Step 1: Pack Markdown Structure (No Schema Breaks)
Keep the existing synthesis JSON schema to avoid cascading changes, but require the `pack_markdown` to be structured with follow-up sections first.

Recommended `pack_markdown` outline:
- Follow-up response effectiveness (PRIMARY)
  - Top converting patterns
  - Objection handling that works
  - Language to avoid / tone guidance
- Cold outreach learnings (SECONDARY)
- Experiments to run next

### Step 2: Update Synthesis Prompts (Map-Reduce Safe)
Update prompts (prefer versioned keys so rollbacks + telemetry are clear):
- `insights.pack_campaign_summarize.v2` (campaign summary must retain follow-up learnings)
- `insights.pack_synthesize.v2` (final pack must lead with follow-up sections)

Prompt guidance:
- Weight follow-up patterns 3x higher than initial outreach patterns.
- When showing “rates”, compute only from provided threads and display as `x/y threads` (no invented KPIs).
- Prefer BOOKED/REQUESTED threads as examples when available, but do not hide failures (they’re useful for “what to avoid”).

### Step 3: Ensure Follow-Up Fields Reach the Synthesizer
Update `compactInsight()` in `lib/insights-chat/pack-synthesis.ts` to include follow-up fields (and effectiveness score). Without this, the map-reduce path may discard follow-up-specific data.

### Step 4: Fast Seed Pack Markdown
Update `buildFastContextPackMarkdown()` in `lib/insights-chat/fast-seed.ts` to include follow-up patterns when present (keep the existing sections as fallback).

### Step 5: Answer Generation Prompt Updates
Update the chat answer prompt (e.g. `insights.chat_answer.v3`) to:
- Lead with follow-up response recommendations by default for “what works / what to say”
- Cite thread refs when referencing example conversations
- Mention cold outreach only when the question is explicitly about first-touch outreach

### Step 6: Citation / Thread Index Enrichment (Optional)
Optionally enrich the **thread index input payload** (not the citation output schema):
- Add follow-up score metadata to `InsightThreadIndexItem` (Phase 29c)
- Include it in the `thread_index` payload passed to the answer model

## Output

**Changes in `lib/insights-chat/pack-synthesis.ts`:**
- Updated `compactInsight()` to preserve follow-up fields:
  - `follow_up.what_worked/what_failed/key_phrases/tone_observations/objection_responses`
  - `follow_up_effectiveness` (score, converted_after_objection, notes)
- Updated synthesis to use v2 prompts

**New prompts in `lib/ai/prompt-registry.ts`:**
- `insights.pack_campaign_summarize.v2` — weights follow-up patterns 3x, leads with follow-up insights
- `insights.pack_synthesize.v2` — structures pack markdown with follow-up sections first:
  - "Follow-Up Response Effectiveness (PRIMARY FOCUS)"
  - "Top Converting Follow-Up Patterns"
  - "Objection Handling Winners"
  - "Language to Avoid in Follow-Ups"
  - Then "Cold Outreach Observations (SECONDARY)"
- `insights.chat_answer.v3` — leads with follow-up response recommendations, prefers threads with high followUpScore

**Prompt registration:**
- All v2 prompts registered in `listAIPromptTemplates()`

**Build verification:** `npm run build` passes.

## Handoff
Phase 29e can now:
1. Implement schema version checking for cached insights
2. Add re-extraction logic when `schema_version !== "v2_followup_weighting"`
3. Add env gate for controlled rollout
