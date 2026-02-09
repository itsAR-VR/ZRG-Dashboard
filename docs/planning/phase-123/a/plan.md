# Phase 123a — Data Model + Contracts

## Focus
Define the persistent "draft run" data model and contracts needed to unify context across draft generation, overseer, evaluator, and revision stages, including support for up to 3 loop iterations and per-workspace revision model configuration.

## Inputs
- Root objectives in `docs/planning/phase-123/plan.md`
- Existing Prisma models:
  - `AIDraft`, `MeetingOverseerDecision`, `LeadMemoryEntry`, `WorkspaceSettings` (`prisma/schema.prisma`)
- Existing multi-agent stages and contracts:
  - Draft step 1/2/3 (`lib/ai-drafts.ts`)
  - Overseer (`lib/meeting-overseer.ts`)
  - Auto-send evaluator + revision agent (`lib/auto-send/*`)
  - LeadContextBundle (`lib/lead-context-bundle.ts`)
- Coordination constraints from Phase 115/116/119/122 (do not regress existing reliability hardening)
- Existing `AutoSendContext.workspaceSettings` type at `lib/auto-send/types.ts:66-73`

## Work

### 1. Add Prisma models

#### DraftPipelineRun
```prisma
model DraftPipelineRun {
  id                String    @id @default(uuid())
  clientId          String
  client            Client    @relation(fields: [clientId], references: [id], onDelete: Cascade)
  leadId            String
  lead              Lead      @relation(fields: [leadId], references: [id], onDelete: Cascade)
  triggerMessageId  String?
  draftId           String?
  channel           String
  status            String    @default("RUNNING") // RUNNING | COMPLETED | FAILED | ABORTED
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  artifacts         DraftPipelineArtifact[]

  @@unique([triggerMessageId, channel])
  @@index([draftId])
  @@index([clientId, createdAt(sort: Desc)])
}
```

#### DraftPipelineArtifact
```prisma
model DraftPipelineArtifact {
  id           String    @id @default(uuid())
  runId        String
  run          DraftPipelineRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  stage        String    // canonical stage name (see below)
  iteration    Int       @default(0) // 0 = baseline, 1-3 = loop iterations
  promptKey    String?
  model        String?
  payload      Json?     // structured output (max 32KB enforced in code)
  text         String?   @db.Text // draft text or summary
  inputTokens  Int?
  outputTokens Int?
  latencyMs    Int?
  createdAt    DateTime  @default(now())

  @@unique([runId, stage, iteration])
  @@index([runId, createdAt])
}
```

#### Model relations
- Add `draftPipelineRuns DraftPipelineRun[]` to `Client` model
- Add `draftPipelineRuns DraftPipelineRun[]` to `Lead` model

### 2. Canonical stage names (TS string enum)
Define in `lib/draft-pipeline/types.ts` (new file):
- `draft_strategy_step1`
- `draft_generation_step2`
- `draft_verifier_step3`
- `meeting_overseer_extract`
- `meeting_overseer_gate`
- `auto_send_evaluation`
- `auto_send_revision_selector` (optimization context selection)
- `auto_send_revision_reviser`
- `final_draft`
- `loop_error` (for recording mid-loop failures)

### 3. DraftPipelineRun status state machine
Valid statuses: `RUNNING`, `COMPLETED`, `FAILED`, `ABORTED`
Allowed transitions (forward-only):
- `RUNNING` → `COMPLETED` | `FAILED` | `ABORTED`
- No backwards transitions (enforce in update helper)

### 4. Add per-workspace revision model settings to WorkspaceSettings
All nullable with defaults (safe for existing rows):
```prisma
autoSendRevisionModel            String?  @default("gpt-5.2")
autoSendRevisionReasoningEffort  String?  @default("high")
autoSendRevisionMaxIterations    Int?     @default(3)
```

### 5. Add loop iteration tracking to AIDraft
```prisma
autoSendRevisionIterations  Int?  @default(0)
```
Semantics: `autoSendOriginalConfidence` = iteration-0 eval, `autoSendRevisionConfidence` = final/best iteration confidence, `autoSendRevisionApplied` = true if any revision was used, `autoSendRevisionIterations` = number of iterations that actually ran.

### 6. Update AutoSendContext.workspaceSettings type
In `lib/auto-send/types.ts:66-73`, add:
- `autoSendRevisionModel?: string | null`
- `autoSendRevisionReasoningEffort?: string | null`
- `autoSendRevisionMaxIterations?: number | null`

### 7. Update all Prisma select clauses for workspace settings
Update these locations to include the three new fields:
- `lib/inbound-post-process/pipeline.ts:102-111`
- Any other entry points that load workspace settings for auto-send context

### 8. Extend `auto-send-revision-rollout-actions.ts`
Add the three new fields to the super-admin rollout actions with `isTrueSuperAdminUser()` gating (matching existing pattern).

### 9. Define TS contracts (in `lib/draft-pipeline/types.ts`)
- `DraftRunSnapshot` — run metadata + resolved bundle stats
- `DraftRunContextPack` — weighted sections + token/char stats per section
- `DraftPipelineStage` — string union of canonical stage names
- `DraftPipelineRunStatus` — string union: "RUNNING" | "COMPLETED" | "FAILED" | "ABORTED"

### 10. Payload size validation
Create `lib/draft-pipeline/validate-payload.ts`:
- `validateArtifactPayload(payload: unknown): Json` — truncate/reject if serialized size > 32KB
- Used before every artifact write

### 11. Retention policy
Default retention: 30 days (env: `DRAFT_PIPELINE_RUN_RETENTION_DAYS`, default 30). Implementation deferred to Subphase E.

### 12. Model coercion
Add `coerceAutoSendRevisionModel()` function matching existing `coerceEmailDraftVerificationModel()` pattern. Validates model string is a known model identifier; falls back to `"gpt-5.2"`.

## Validation (RED TEAM)
- `npm run db:push` succeeds against dev DB
- Verify in Prisma Studio: DraftPipelineRun, DraftPipelineArtifact tables exist; WorkspaceSettings rows have new fields with defaults
- `npm run build` passes (no type errors from new types)
- Confirm `autoSendRevisionMaxIterations` is `3` on existing WorkspaceSettings rows

## Output
- Prisma schema updated for run/artifact persistence + revision loop knobs:
  - `prisma/schema.prisma`: added `DraftPipelineRun`, `DraftPipelineArtifact`, `WorkspaceSettings.autoSendRevision*` fields, and `AIDraft.autoSendRevisionIterations`.
- Prisma validation + DB sync complete:
  - `npx prisma validate` passes
  - `npm run db:push` synced successfully
- TypeScript scaffolding added:
  - `lib/draft-pipeline/types.ts` (stage + status contracts)
  - `lib/draft-pipeline/validate-payload.ts` (32KB payload cap helper)
  - `lib/auto-send/revision-config.ts` (model/effort/max-iterations coercion)
- Auto-send context + selects updated to carry new per-workspace fields:
  - `lib/auto-send/types.ts`
  - `lib/inbound-post-process/pipeline.ts`
  - `lib/background-jobs/email-inbound-post-process.ts`
- Super-admin rollout actions extended to read/write the new knobs:
  - `actions/auto-send-revision-rollout-actions.ts`
- Build sanity check:
  - `npm run build` passes (warnings only; pre-existing CSS warnings)

## Handoff
Phase 123b threads `runId` through draft generation and overseer, and persists the artifacts using these models + stage conventions.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added Prisma models + settings fields for draft run artifacts and revision-loop tuning.
  - Added TS contracts + payload cap helper + coercion helpers.
  - Updated workspace settings selects and the auto-send rollout action to include new fields.
- Commands run:
  - `npx prisma validate` — pass
  - `npx prisma generate` — pass
  - `npm run db:push` — pass
  - `npm run build` — pass (warnings only)
- Blockers:
  - None
- Next concrete steps:
  - Implement DraftPipelineRun + DraftPipelineArtifact writes in `lib/ai-drafts.ts` (Step 1/2/3 + overseer) with fail-open behavior.
