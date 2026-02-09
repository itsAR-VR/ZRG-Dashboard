# Phase 127a — Data Model + Contracts

## Focus
Define the minimal schema + TS contracts to support governed long-term memory proposals, loop observability artifacts, and retention/pruning without creating hot-path coupling.

## Inputs
- Phase 123 schema additions: `DraftPipelineRun`, `DraftPipelineArtifact` (`prisma/schema.prisma`)
- Existing durable memory model: `LeadMemoryEntry` (`prisma/schema.prisma`)
- Artifact payload cap helper: `lib/draft-pipeline/validate-payload.ts`
- Existing per-workspace AI settings: `WorkspaceSettings` (`prisma/schema.prisma`)

## Work
1. Add governance fields to `LeadMemoryEntry`:
   - Add `status` with allowed values: `APPROVED | PENDING`
     - Prefer a Prisma enum (e.g. `MemoryEntryStatus`) over raw strings.
     - Default should remain `APPROVED` for backwards compatibility (manual/system entries).
   - Add provenance fields (nullable):
     - `proposedByDraftPipelineRunId String?`
     - `proposedByDraftId String?`
   - Add indexes:
     - `@@index([clientId, status])` for pending review queries
     - `@@index([proposedByDraftPipelineRunId])` (optional)
2. Add workspace-level durable memory model:
   - New Prisma model `WorkspaceMemoryEntry` keyed by `clientId` (workspace == client):
     - `category`, `content`, `source`, `status`, `expiresAt`
     - provenance fields: `proposedByDraftPipelineRunId`, `proposedByDraftId`
     - `createdByUserId/createdByEmail` for manual entries
   - Indexes:
     - `@@index([clientId])`, `@@index([clientId, status])`, `@@index([expiresAt])`, `@@index([createdAt(sort: Desc)])`
3. Add (or validate) a safe dedupe strategy for inferred memory:
   - Preferred: `createMany({ skipDuplicates: true })` + app-level exact-match checks.
   - Optional: add a unique constraint if needed (watch content length; may require a hash).
4. Add TS contract for memory proposals (strict, bounded):
   - `scope: "lead" | "workspace"`
   - `category: string` (UI-configurable allowlist lives in WorkspaceSettings)
   - `content: string` (max 500 chars)
   - `ttlDays: number` (required, > 0; capped to 90 for persistence)
   - `confidence: number` (0..1)
5. Add per-workspace memory policy settings (Super Admin controlled) on `WorkspaceSettings`:
   - Allowlist categories (UI-configurable):
     - `memoryAllowlistCategories String[] @default([])`
   - Thresholds:
     - `memoryMinConfidence Float @default(0.7)`
     - `memoryMinTtlDays Int @default(1)`
     - `memoryTtlCapDays Int @default(90)`
   - Note: initial allowlist should be seeded in code when creating default WorkspaceSettings.
6. Decide where loop observability lives:
   - Store as `DraftPipelineArtifact` stage `auto_send_revision_loop` (payload only; no draft text), keyed by `(runId, stage, iteration=0)`.
   - Payload includes stopReason, iterationsUsed, start/end confidence, cacheHits, elapsedMs.
7. Retention setting:
   - Env var `DRAFT_PIPELINE_RUN_RETENTION_DAYS` default 30 (document only; enforce in 127c).
8. Evaluator model selection (env fallback + UI):
   - Current evaluator is hard-coded (`gpt-5-mini`, `low` in `lib/auto-send-evaluator.ts`).
   - Add `WorkspaceSettings` fields (Super Admin):
     - `autoSendEvaluatorModel String?`
     - `autoSendEvaluatorReasoningEffort String?`
   - Add env var fallbacks:
     - `AUTO_SEND_EVALUATOR_MODEL`
     - `AUTO_SEND_EVALUATOR_REASONING_EFFORT`
   - Add env var fallbacks for revision (only used if workspace settings are unset):
      - `AUTO_SEND_REVISION_MODEL`
      - `AUTO_SEND_REVISION_REASONING_EFFORT`

## Validation (RED TEAM)
- `npm run db:push` succeeds.
- Prisma Studio: `LeadMemoryEntry.status` exists with default `APPROVED`; `WorkspaceMemoryEntry` exists.
- `npm run build` succeeds after TS contract additions.

## Output
- Schema:
  - Added `MemoryEntryStatus` enum.
  - Added `LeadMemoryEntry.status` + provenance fields + indexes.
  - Added `WorkspaceMemoryEntry` model + indexes + Client relation.
  - Added per-workspace memory policy + evaluator model fields on `WorkspaceSettings`.
  - Added `Client.workspaceMemoryEntries` backref for Prisma relation integrity.
  - Files: `prisma/schema.prisma`
- TS contracts:
  - Memory proposal types + defaults: `lib/memory-governance/types.ts`
  - Minimal scrub helper (emails/phones): `lib/memory-governance/redaction.ts`
  - Registered artifact stage constants: `lib/draft-pipeline/types.ts`

## Handoff
Phase 127b:
- Wire revision agent output → proposal parsing/scrub → approval gate → persistence into `LeadMemoryEntry`/`WorkspaceMemoryEntry`.
- Add super-admin actions + Settings → Admin UI panels for:
  - allowlist/threshold editing
  - pending approvals
  - loop observability viewer
- Add evaluator model selection (WorkspaceSettings + env fallbacks) in `lib/auto-send-evaluator.ts`.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented Phase 127 schema changes (memory governance + workspace memory + evaluator config fields).
  - Added TS contract scaffolding for memory proposals + minimal scrub helper.
  - Added draft pipeline stage constants for `auto_send_revision_loop` + `memory_proposal`.
- Commands run:
  - `npm run db:push` — pass (database in sync; Prisma validation passed)
- Blockers:
  - None
- Next concrete steps:
  - Implement revision agent `memory_proposals` output + approval/persistence.
  - Build super-admin UI/actions for policy + pending approvals + loop observability.
