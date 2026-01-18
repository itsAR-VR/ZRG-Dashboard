# Phase 29c — Thread Prioritization & Scoring Integration (Fast Seed, Pack Ordering, Thread Index)

## Focus
Make follow-up effectiveness the highest-weighted signal when choosing which threads to surface first (fast seed answer, pack synthesis ordering, thread index presentation).

## Inputs
- `follow_up_effectiveness.score` from subphase b
- Existing fast seed selection in `lib/insights-chat/fast-seed.ts`
- Existing pack worker ordering in `lib/insights-chat/context-pack-worker.ts` and `actions/insights-chat-actions.ts`
- Thread index generation in `lib/insights-chat/thread-index.ts`

## Work

### Step 1: Define a Follow-Up Priority Score Helper
Add a helper (location flexible) that returns a single numeric priority score for ordering:
- If `follow_up_effectiveness` is missing/null → score 0
- Else use `follow_up_effectiveness.score` (0–100), with a small boost if `converted_after_objection`

### Step 2: Fast Seed Thread Ordering
Update `selectFastSeedThreads()` in `lib/insights-chat/fast-seed.ts`:
- Today it sorts mostly by outcome priority.
- New ordering:
  1) follow-up priority score (desc)
  2) outcome priority (BOOKED > REQUESTED > STALLED > NO_RESPONSE > UNKNOWN)
  3) stable fallback (original order / leadId)

### Step 3: Pack Synthesis Thread Ordering
Before calling `synthesizeInsightContextPack()`:
- Sort `threadsForSynthesis` by follow-up priority score (desc), then outcome.
- This ensures the model sees the highest-signal follow-up examples first (important when context is truncated or map-reduced).

### Step 4: Thread Index Enrichment (Optional)
Enhance `InsightThreadIndexItem` to include follow-up context:
- `follow_up_score?: number`
- `converted_after_objection?: boolean`
Then pass these fields into `answerInsightsChatQuestion()` input payload so the model can cite “high follow-up effectiveness” threads more explicitly.

### Step 5: Robustness
- Treat missing follow-up fields as “no signal” (score 0) rather than failing.
- Keep this logic compatible with Phase 29e backfill gating; ordering should still work during gradual rollout.

## Output

**Changes in `lib/insights-chat/fast-seed.ts`:**
- Added `computeFollowUpPriorityScore(effectiveness)` — returns 0-105 (base score + objection boost)
- Extended `FastSeedThread` type with `followUpScore: number | null`
- Updated `selectFastSeedThreads()` to sort by:
  1. Follow-up score descending (highest signal first)
  2. Outcome priority (BOOKED > REQUESTED > STALLED > NO_RESPONSE > UNKNOWN)
- Updated `buildFastContextPackMarkdown()` to include **Follow-Up Response Patterns (PRIMARY)** section with:
  - What worked/failed in follow-ups
  - Tone observations
  - Objection handling examples

**Changes in `lib/insights-chat/citations.ts`:**
- Extended `InsightThreadIndexItem` with:
  - `followUpScore?: number` — effectiveness score (0-105; includes objection boost)
  - `convertedAfterObjection?: boolean` — objection handling success flag

**Changes in `lib/insights-chat/thread-index.ts`:**
- Updated `buildInsightThreadIndex()` to:
  - Extract `follow_up_effectiveness` from cached insights
  - Compute follow-up score via `computeFollowUpPriorityScore()`
  - Include `followUpScore` and `convertedAfterObjection` in thread index items

**Changes in `lib/insights-chat/context-pack-worker.ts` and `actions/insights-chat-actions.ts`:**
- Sort `threadsForSynthesis` before calling `synthesizeInsightContextPack()` by:
  1. Follow-up score descending
  2. Outcome priority (BOOKED > REQUESTED > STALLED > NO_RESPONSE > UNKNOWN)

**Build verification:** `npm run build` passes.

## Handoff
Subphase d can now:
1. Access `followUpScore` on thread index items for answer generation context
2. Rely on fast seed threads being sorted by follow-up effectiveness
3. Build pack markdown that foregrounds follow-up patterns
