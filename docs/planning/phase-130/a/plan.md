# Phase 130a — Schema + Types + Orchestrator Logic

## Focus

Add the `autoSendSkipHumanReview` field to the database schema and type definitions, then implement the core decision logic change in the orchestrator. This is the foundational subphase — all downstream work depends on these changes.

## Inputs

- Root plan context: compound condition at `orchestrator.ts:437` bypasses threshold when `safeToSend = false`
- Existing type: `AutoSendContext.emailCampaign` in `lib/auto-send/types.ts:54-62`
- Existing decision: `orchestrator.ts:437`

## Work

### 1. Schema change

**File:** `prisma/schema.prisma` — `EmailCampaign` model (near line 1415, after `autoSendConfidenceThreshold`)

Add:
```prisma
autoSendSkipHumanReview Boolean @default(false)
```

Run `npm run db:push`.

### 2. Type update

**File:** `lib/auto-send/types.ts` — `emailCampaign` type within `AutoSendContext` (~line 54-62)

Add `autoSendSkipHumanReview?: boolean` to the campaign context interface.

### 3. Orchestrator decision logic

**File:** `lib/auto-send/orchestrator.ts` (~line 437)

Replace:
```typescript
if (evaluation.safeToSend && evaluation.confidence >= threshold) {
```

With:
```typescript
const skipHumanReview = context.emailCampaign?.autoSendSkipHumanReview === true;
const source = evaluation.source ?? "model";
const isHardBlock = source === "hard_block" || Boolean(evaluation.hardBlockCode);
const passesConfidence = evaluation.confidence >= threshold;
const passesSafety = evaluation.safeToSend || (skipHumanReview && !isHardBlock);

if (passesSafety && passesConfidence) {
```

**Logic explanation:**
- `skipHumanReview=false` (default): `passesSafety = evaluation.safeToSend` — unchanged behavior
- `skipHumanReview=true`: `passesSafety = true` UNLESS it's a hard block — bypasses model's `requires_human_review` opinion
- Hard blocks (`source === "hard_block"` or `hardBlockCode`) always make `passesSafety = false` regardless of toggle

### 4. Log the toggle state

In the same orchestrator file, add `skipHumanReview` to the console.log metadata near the decision point so it's visible in observability logs.

## Output

- `EmailCampaign` table has the new column with default `false`
- Type system recognizes `autoSendSkipHumanReview` on the campaign context
- Orchestrator respects the toggle: model-flagged drafts auto-send when toggle is on; hard blocks still prevented
- All existing behavior unchanged when toggle is `false`

## Handoff

Subphase **b** wires the field through the pipeline (DB selects in background jobs + inbound pipeline), adds the server action save logic, and builds the UI toggle in the Campaign Assignment table.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added `EmailCampaign.autoSendSkipHumanReview` with default `false`. (`prisma/schema.prisma`)
  - Updated `AutoSendContext.emailCampaign` typing to include `autoSendSkipHumanReview`. (`lib/auto-send/types.ts`)
  - Updated orchestrator decision to optionally bypass evaluator `safeToSend` when the campaign toggle is enabled, while still respecting hard blocks. (`lib/auto-send/orchestrator.ts`)
  - Added an `AUTO_SEND_DEBUG=1` decision log that includes `skipHumanReview` + derived booleans for observability. (`lib/auto-send/orchestrator.ts`)
  - Coordination: `prisma/schema.prisma` was already modified by Phase 129; this change is additive (new `EmailCampaign` field) and was merged without conflicting edits.
- Commands run:
  - `npm run db:push` — pass (database in sync)
- Blockers:
  - None
- Next concrete steps:
  - Wire the field through the campaign actions + inbound pipelines + UI toggle (Phase 130b).
