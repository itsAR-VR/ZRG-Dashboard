# Phase 129a — Data Model + Super-Admin Actions

## Focus
Add system-level storage for prompt defaults (templates + snippets) and expose super-admin-only Server Actions to manage them safely (CRUD + revisions). Extract a reusable `requireSuperAdminUser()` helper.

## Inputs
- Root plan: `docs/planning/phase-129/plan.md`
- Existing workspace models/actions:
  - `prisma/schema.prisma` (`PromptOverride` L1922, `PromptSnippetOverride` L1942, revision models)
  - `actions/ai-observability-actions.ts` (workspace prompt/snippet CRUD: `savePromptOverride` L480, `resetPromptOverride` L553, `getSnippetRegistry` L1018)
- Super-admin gating:
  - `lib/workspace-access.ts` (`requireAuthUser` L41, `isTrueSuperAdminUser` L29)
  - Pattern used in 7+ action files: `const user = await requireAuthUser(); if (!isTrueSuperAdminUser(user)) return { success: false, error: "Unauthorized" };`
- Hash utility: `computePromptMessageBaseHash` in `lib/ai/prompt-registry.ts:1529`

## Work

### 1. Extract `requireSuperAdminUser()` helper
- File: `lib/workspace-access.ts`
- Add:
  ```typescript
  export async function requireSuperAdminUser(): Promise<{ userId: string; userEmail: string | null }> {
    const user = await requireAuthUser();
    if (!isTrueSuperAdminUser(user)) throw new Error("Unauthorized: Super admin required");
    return { userId: user.id, userEmail: user.email ?? null };
  }
  ```
- This DRYs up the pattern currently duplicated in `ai-interaction-inspector-actions.ts`, `memory-governance-actions.ts`, `auto-send-loop-observability-actions.ts`, `auto-send-revision-rollout-actions.ts`, `confidence-policy-actions.ts`, `lead-context-bundle-rollout-actions.ts`, `message-performance-proposals.ts`.

### 2. Prisma schema — system override models
- File: `prisma/schema.prisma`
- Re-read current schema from HEAD before editing (phases 123/126/127 added models recently).
- Add models:

**`SystemPromptOverride`** (mirrors `PromptOverride` without `clientId`):
  - `id` String @id @default(uuid())
  - `promptKey` String
  - `role` String
  - `index` Int
  - `baseContentHash` String — anchored to code default content hash (flat drift model)
  - `content` String @db.Text
  - `createdAt` DateTime @default(now())
  - `updatedAt` DateTime @updatedAt
  - `revisions` → `SystemPromptOverrideRevision[]`
  - `@@unique([promptKey, role, index])`

**`SystemPromptOverrideRevision`** (mirrors `PromptOverrideRevision`):
  - `id` String @id @default(uuid())
  - `systemPromptOverrideId` String → relation
  - `content` String @db.Text
  - `baseContentHash` String?
  - `changedBy` String?
  - `changeNote` String?
  - `createdAt` DateTime @default(now())
  - `@@index([systemPromptOverrideId])`

**`SystemPromptSnippetOverride`** (mirrors `PromptSnippetOverride` without `clientId`):
  - `id` String @id @default(uuid())
  - `snippetKey` String
  - `content` String @db.Text
  - `codeDefaultSnapshot` String? @db.Text — optional snapshot of code default at save time (for UI "code changed" warning, not runtime drift gating)
  - `createdAt` DateTime @default(now())
  - `updatedAt` DateTime @updatedAt
  - `revisions` → `SystemPromptSnippetOverrideRevision[]`
  - `@@unique([snippetKey])`

**`SystemPromptSnippetOverrideRevision`** (mirrors `PromptSnippetOverrideRevision`):
  - `id` String @id @default(uuid())
  - `systemPromptSnippetOverrideId` String → relation
  - `content` String @db.Text
  - `changedBy` String?
  - `changeNote` String?
  - `createdAt` DateTime @default(now())
  - `@@index([systemPromptSnippetOverrideId])`

**Note:** No `baseContentHash` on `SystemPromptSnippetOverride` — matches existing snippet behavior (no drift protection for snippets). The `codeDefaultSnapshot` is for UI warnings only.

**Rollback safety:** All changes are additive (new tables only, no column drops or renames). If rollback needed, unused tables can remain safely.

### 3. Server Actions — system prompt CRUD
- File: `actions/system-prompt-actions.ts` (new file)
- Gate ALL mutations with `requireSuperAdminUser()` from `lib/workspace-access.ts`.
- Return shapes: `{ success: boolean; data?: T; error?: string }` (standard pattern).
- Implement:
  - `getSystemPromptOverrides(promptKey?: string)` — list all system prompt overrides, optionally filtered by promptKey
  - `saveSystemPromptOverride({ promptKey, role, index, content })` — upsert + create revision; compute `baseContentHash` via `computePromptMessageBaseHash` from `lib/ai/prompt-registry.ts`
  - `resetSystemPromptOverride({ promptKey, role, index })` — delete override + create audit revision
  - `getSystemSnippetOverrides()` — list all system snippet overrides
  - `saveSystemSnippetOverride({ snippetKey, content })` — upsert + create revision; store `codeDefaultSnapshot` from `SNIPPET_DEFAULTS`
  - `resetSystemSnippetOverride({ snippetKey })` — delete + audit
  - `getSystemPromptOverrideRevisions({ overrideId })` — revision history
  - `getSystemSnippetOverrideRevisions({ overrideId })` — revision history

### 4. Update `getSnippetRegistry()` return shape
- File: `actions/ai-observability-actions.ts`
- Current per-snippet return: `{ key, label, description, currentValue, isOverride, updatedAt }`
- Expanded return shape:
  ```typescript
  {
    key: string;
    label: string;
    description: string;
    codeDefault: string;
    systemOverrideValue: string | null;
    systemOverrideUpdatedAt: Date | null;
    workspaceOverrideValue: string | null;
    workspaceOverrideUpdatedAt: Date | null;
    effectiveValue: string;
    source: "workspace" | "system" | "code";
    isStale: boolean; // workspace override updatedAt < system override updatedAt
  }
  ```
- Query `SystemPromptSnippetOverride` alongside existing workspace query.

### 5. Update prompt template data for UI
- File: `actions/ai-observability-actions.ts`
- Update `getAiPromptTemplates()` or add a new helper to return per-message system override status:
  - For each message in each template: `{ hasSystemOverride, systemOverrideUpdatedAt, hasWorkspaceOverride, workspaceOverrideUpdatedAt, source, isStale }`

## Validation (RED TEAM)
- Run `npm run db:push` — verify no errors.
- Run `npm run db:studio` — confirm 4 new tables exist with correct columns.
- Run `npm run lint` — no errors in new/modified files.
- Run `npm run build` — succeeds.
- Verify `requireSuperAdminUser()` is importable and works (manual test or quick unit test).

## Output
- Prisma schema updated with 4 system override tables (2 main + 2 revision).
- `requireSuperAdminUser()` helper extracted in `lib/workspace-access.ts`.
- New super-admin Server Actions in `actions/system-prompt-actions.ts`.
- `getSnippetRegistry()` returns expanded shape with `source`, `isStale`, system override data.
- Prompt template data includes system override status per message.

## Handoff
Provide to 129b:
- Final model names/fields: `SystemPromptOverride`, `SystemPromptOverrideRevision`, `SystemPromptSnippetOverride`, `SystemPromptSnippetOverrideRevision`
- `requireSuperAdminUser()` location: `lib/workspace-access.ts`
- System prompt action contracts (input/output types)
- Expanded snippet registry return shape for UI consumption

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added system-default prompt/snippet override Prisma models + revision tables. (`prisma/schema.prisma`)
  - Extracted `requireSuperAdminUser()` helper for super-admin gating. (`lib/workspace-access.ts`)
  - Implemented super-admin Server Actions for system prompt + snippet overrides (CRUD + history + rollback). (`actions/system-prompt-actions.ts`)
  - Expanded snippet registry to include system defaults + provenance metadata (including handling empty-string overrides correctly). (`actions/ai-observability-actions.ts`)
- Commands run:
  - `npm run db:push` — pass (`The database is already in sync with the Prisma schema.`)
- Blockers:
  - None
- Next concrete steps:
  - Finalize remaining subphase documentation and run Phase 129 review (`docs/planning/phase-129/review.md`).
