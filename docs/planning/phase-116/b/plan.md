# Phase 116b — Prisma Schema: `AIDraft` Revision Tracking Fields

## Focus
Add durable revision tracking fields to `AIDraft` so auto-send revision becomes retry-safe (idempotent) and measurable from DB-backed surfaces.

## Inputs
- `prisma/schema.prisma` (`model AIDraft`)
- Phase 115 deferred item: schema-level revision tracking (RT-17)
- Phase 116 root plan: field names and semantics

## Work
1. Update `prisma/schema.prisma` → `model AIDraft` with fields:
   - `autoSendRevisionAttemptedAt DateTime?`
   - `autoSendOriginalConfidence Float?`
   - `autoSendRevisionConfidence Float?`
   - `autoSendRevisionApplied Boolean @default(false)`
   - `autoSendRevisionSelectorUsed Boolean?`

2. Add per-workspace rollout toggle (super-admin controlled)
   - Update `prisma/schema.prisma` → `model WorkspaceSettings` with:
     - `autoSendRevisionEnabled Boolean @default(false)`

3. Indexing (keep minimal)
   - Add `@@index([autoSendRevisionAttemptedAt])` for bounded-window admin queries (last 72h).

4. DB sync + verification
   - Confirm Prisma CLI will use the **non-pooled** connection (`DIRECT_URL`) for schema changes.
   - Run `npm run db:push` (requires correct `DIRECT_URL`).
   - Verify columns exist:
     - `npm run db:studio` (or SQL inspection) confirms the new fields are present.
   - Confirm no backfill is required:
     - existing rows: `autoSendRevisionApplied=false`, other fields null.
     - existing workspaces: `autoSendRevisionEnabled=false` by default.

## Output
- DB schema updated and verified; Prisma client reflects new fields.

## Handoff
- Phase 116c will use `autoSendRevisionAttemptedAt` as the idempotent claim to prevent repeated revision attempts across retries.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added durable revision tracking fields to `AIDraft` and a per-workspace rollout toggle (`WorkspaceSettings.autoSendRevisionEnabled`). (files: `prisma/schema.prisma`)
  - Synced schema to the database. (command: `npm run db:push`)
- Commands run:
  - `npx prisma validate` — pass
  - `npx prisma generate` — pass
  - `npm run db:push` — pass (DB in sync)
- Blockers:
  - None
- Next concrete steps:
  - Finish rollout controls + observability surfaces (Phase 116d), then do a full phase review.
