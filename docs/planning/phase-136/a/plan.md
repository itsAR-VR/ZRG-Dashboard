# Phase 136a — Schema + Types

## Focus

Add the workspace-level field to the database schema and update the TypeScript types that carry auto-send context through the pipeline.

## Inputs

- `prisma/schema.prisma` — WorkspaceSettings model (line ~386), EmailCampaign model (line ~1467)
- `lib/auto-send/types.ts` — AutoSendContext interface (lines 29-83)

## Work

### 1. WorkspaceSettings schema

Add after the existing auto-send fields (~line 386):

```prisma
autoSendSkipHumanReview   Boolean  @default(false)
```

### 2. EmailCampaign schema

Change (~line 1467):

```prisma
// Before:
autoSendSkipHumanReview Boolean @default(false)

// After:
autoSendSkipHumanReview Boolean?
```

Making it nullable means `null` = "inherit from workspace". Existing rows keep their `false` value.

### 3. AutoSendContext type

In `lib/auto-send/types.ts`:

**`emailCampaign.autoSendSkipHumanReview` (line 60):**
```ts
// Before:
autoSendSkipHumanReview?: boolean;
// After:
autoSendSkipHumanReview?: boolean | null;
```

**`workspaceSettings` (add after line 74):**
```ts
autoSendSkipHumanReview?: boolean | null;
```

### 4. Run schema push

```bash
npm run db:push
```

## Output

- Schema updated with new workspace field and nullable campaign field
- TypeScript types updated to carry the workspace value through the pipeline
- Database migrated

## Handoff

Types and schema are ready for Phase 136b to implement the resolution logic in the orchestrator and server actions.
