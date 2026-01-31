# Phase 72a — Schema Enhancement

## Focus

Add fields to the `Lead` model to track alternate email addresses associated with a conversation and the current active replier (who may differ from the original lead email).

## Inputs

- Current `Lead` model in `prisma/schema.prisma`
- Phase 70's uncommitted schema changes (must layer on top, not conflict)

## Work

### 1. Pre-Flight Check

```bash
git status --porcelain prisma/schema.prisma
```

Read current schema state to understand Phase 70's changes.

### 2. Add Fields to Lead Model

Add after `externalSchedulingLinkLastSeenAt` (around line 429):

```prisma
// Phase 72: CC'd recipient tracking
alternateEmails         String[]   @default([])  // Email addresses of people who have replied to this thread
currentReplierEmail     String?                  // Email of most recent inbound sender (if different from lead.email)
currentReplierName      String?                  // Name of most recent inbound sender
currentReplierSince     DateTime?                // When they started being the active replier
```

### 3. Run Migration

```bash
npm run db:push
```

### 4. Verify in Prisma Studio

```bash
npm run db:studio
```

Confirm fields appear on Lead model and are nullable/have correct defaults.

## Output

- Added Phase 72 Lead fields in `prisma/schema.prisma`:
  - `alternateEmails`, `currentReplierEmail`, `currentReplierName`, `currentReplierSince`
  - Added GIN index on `alternateEmails` for array membership queries
- **Not run**: `npm run db:push` (requires DB credentials) and `npm run db:studio`

## Coordination Notes

**Potential conflicts with:** Phase 70 (uncommitted `prisma/schema.prisma` changes)
**Files affected:** `prisma/schema.prisma`
**Integration notes:** Appended new fields near `externalSchedulingLinkLastSeenAt`; did not modify Phase 70 fields.

## Handoff

Schema updated. Phase 72b can now extend `lib/email-participants.ts` with Phase 72 helpers and add tests.
