# Phase 123b — Instrumentation: Persist Draft Run Artifacts

## Focus
Create a `runId` for each draft-generation invocation and persist high-signal artifacts for Step 1/2/3 and overseer decisions so downstream agents (revision) can use a consistent snapshot without re-deriving context.

## Inputs
- Phase 123a schema + stage conventions + types
- Existing implementations:
  - Email draft Step 1/2/3 (`lib/ai-drafts.ts` — re-read before editing to catch Phase 119 changes)
  - Meeting Overseer extract/gate (`lib/meeting-overseer.ts`)
  - LeadContextBundle construction (`lib/lead-context-bundle.ts`)
- `validateArtifactPayload()` from Phase 123a
- Artifact write pattern: `@@unique([runId, stage, iteration])` with upsert

## Work

### 0. Pre-flight coordination check
Before editing `lib/ai-drafts.ts`:
- Run `git log --oneline -5 -- lib/ai-drafts.ts` to check for Phase 119 changes
- Re-read the current file state (do not rely on cached content)
- Resolve any conflicts with Phase 119's Step 3 verifier hardening

### 1. DraftPipelineRun creation (idempotent, fail-open)
In `lib/ai-drafts.ts` → `generateResponseDraft()`:
- At the beginning of draft generation, create `DraftPipelineRun` using upsert on `@@unique([triggerMessageId, channel])`:
  ```
  prisma.draftPipelineRun.upsert({
    where: { triggerMessageId_channel: { triggerMessageId, channel } },
    create: { clientId, leadId, triggerMessageId, channel, status: "RUNNING" },
    update: {} // no-op if already exists (retry scenario)
  })
  ```
- **Fail-open:** Wrap in try/catch. If creation fails (DB issue, migration not applied), log error and continue without instrumentation. Set `runId = null` and skip all artifact writes downstream.

### 2. Persist artifacts per step
For each step, write an artifact using `prisma.draftPipelineArtifact.upsert()` with `where: { runId_stage_iteration }`:

- **Step 1 strategy:**
  - Stage: `draft_strategy_step1`, iteration: 0
  - Payload: trimmed strategy JSON (essential fields only: intent, CTA, constraints, archetype)
  - Validate payload size with `validateArtifactPayload()`

- **Step 2 generated draft:**
  - Stage: `draft_generation_step2`, iteration: 0
  - Text: final generated draft text
  - Payload: model ID + prompt key (no raw prompt)

- **Step 3 verifier:**
  - Stage: `draft_verifier_step3`, iteration: 0
  - Payload: before/after diff info, guardrail result
  - Text: resulting draft text after verification

- **Token tracking:** For each artifact, capture `inputTokens`, `outputTokens`, `latencyMs` from the prompt runner response.

### 3. Overseer instrumentation
After overseer calls in `lib/ai-drafts.ts` (or wherever overseer is invoked during draft generation):

- **Extraction:** Stage: `meeting_overseer_extract`, iteration: 0. Payload: extracted intent/slots.
- **Gate:** Stage: `meeting_overseer_gate`, iteration: 0. Payload: gate decision (approve/revise/block) + rationale. Text: revised draft (if gate revised).

### 4. Link AIDraft to run
When the `AIDraft` row is created, update the `DraftPipelineRun` with `draftId`:
```
prisma.draftPipelineRun.update({ where: { id: runId }, data: { draftId } })
```

### 5. Safety and storage rules
- Do not persist full conversation history; store only what is required to support revision.
- All artifact writes are idempotent via `upsert` on `(runId, stage, iteration)`.
- Skip all artifact writes if `runId = null` (fail-open from step 1).

### 6. Artifact write strategy
**Inline writes (not batched):** Each artifact is written immediately after its corresponding step completes. Rationale: if the job crashes mid-pipeline, completed steps' artifacts are already persisted and available for the revision loop's resumability checks.

### 7. Read helpers
In `lib/draft-pipeline/queries.ts` (new file):
- `getDraftPipelineRunByDraftId(draftId: string)`
- `getLatestDraftPipelineRunByTriggerMessageId(triggerMessageId: string, channel: string)`
- `getArtifactsForRun(runId: string)` — returns all artifacts ordered by `(stage, iteration)`

## Validation (RED TEAM)
- Create a test draft via the email webhook test payload
- Verify in Prisma Studio: `DraftPipelineRun` created with correct `clientId`, `leadId`, `draftId`
- Verify artifacts: at least 3 artifacts (step1, step2, step3) with iteration=0
- Verify no regressions: existing Step 1/2/3 behavior unchanged, prompt keys stable
- `npm run build` passes
- `npm run test` passes (existing auto-send tests still green)

## Expected Output
- New drafts create a `DraftPipelineRun` + a set of `DraftPipelineArtifact` rows (iteration=0) that can be re-used by the revision loop.
- No existing prompt keys or behavior regressions in Step 1/2/3, overseer gate, or auto-send.
- Read helpers available for downstream consumers.

## Expected Handoff
Phase 123c builds the weighted revision context pack from these artifacts and integrates it into the revision agent prompt inputs.

## Output
- Draft generation now creates/updates a run-scoped record (fail-open) and persists baseline artifacts (iteration=0):
  - `lib/ai-drafts.ts`:
    - Upserts `DraftPipelineRun` on `(triggerMessageId, channel)` when `triggerMessageId` is present.
    - Upserts `DraftPipelineArtifact` rows for:
      - `draft_strategy_step1` (payload includes strategy + interactionId + archetypeId)
      - `draft_generation_step2` (text = pre-verifier draft)
      - `draft_verifier_step3` (payload includes changed/violations/changes + interactionId; text = verified draft)
      - `meeting_overseer_extract` (payload = cached extract decision)
      - `meeting_overseer_gate` (payload = cached gate decision; text = revised draft if any)
      - `final_draft` (text = final sanitized draft)
    - Links run → draft and sets `DraftPipelineRun.status="COMPLETED"` after draft creation (best-effort).
- Added read helpers for downstream consumers:
  - `lib/draft-pipeline/queries.ts`: `getDraftPipelineRunByDraftId()`, `getLatestDraftPipelineRunByTriggerMessageId()`, `getArtifactsForRun()`
- Verified:
  - `npm test` passes
  - `npm run build` passes

## Handoff
Phase 123c should build the weighted revision context pack from `DraftPipelineArtifact` rows (plus LeadContextBundle) and thread `runId` into the revision agent.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented DraftPipelineRun + artifact writes in `generateResponseDraft()` (iteration=0 baseline) with fail-open behavior.
  - Added draft-pipeline query helpers for later stages.
- Commands run:
  - `npm test` — pass
  - `npm run build` — pass
- Blockers:
  - None
- Next concrete steps:
  - Add a "revision" context profile + `buildDraftRunContextPack()` and thread `runId/iteration` into `lib/auto-send/revision-agent.ts`.
