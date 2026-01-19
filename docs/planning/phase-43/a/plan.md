# Phase 43a — Schema Changes (Lead + WorkspaceSettings Fields)

## Focus
Add database fields to support lead assignment and round-robin configuration. This is the foundation for all subsequent subphases.

## Inputs
- Existing `Lead` model in `prisma/schema.prisma`
- Existing `WorkspaceSettings` model in `prisma/schema.prisma`
- Current working tree state (Phase 42 may have uncommitted schema changes)

## Work

### 1. Pre-flight check
```bash
git status --porcelain -- prisma/schema.prisma
```
If modified, read current state before editing.

### 2. Add fields to Lead model

```prisma
model Lead {
  // ... existing fields ...

  assignedToUserId    String?    // Supabase Auth user ID of assigned setter
  assignedAt          DateTime?  // When assignment occurred

  // ... existing indexes ...
  @@index([clientId, assignedToUserId])  // For efficient workspace + assignee queries
}
```

### 3. Add fields to WorkspaceSettings model

```prisma
model WorkspaceSettings {
  // ... existing fields ...

  roundRobinEnabled         Boolean  @default(false)
  roundRobinLastSetterIndex Int?     // Index of last assigned setter (for rotation)
}
```

### 4. Apply schema changes

```bash
npm run db:push
```

### 5. Verify in Prisma Studio

```bash
npm run db:studio
```
- Confirm `Lead` table has `assignedToUserId` (nullable String) and `assignedAt` (nullable DateTime)
- Confirm `WorkspaceSettings` table has `roundRobinEnabled` (Boolean, default false) and `roundRobinLastSetterIndex` (nullable Int)

## Output
- Updated `prisma/schema.prisma` with new fields:
  - `Lead.assignedToUserId` (nullable String)
  - `Lead.assignedAt` (nullable DateTime)
  - `WorkspaceSettings.roundRobinEnabled` (Boolean, default false)
  - `WorkspaceSettings.roundRobinLastSetterIndex` (nullable Int)
- Added indexes:
  - `@@index([assignedToUserId])`
  - `@@index([clientId, assignedToUserId])`
- Applied via Supabase MCP migration (migration: `phase_43_lead_assignment_fields`)
- Note: `npm run db:push` failed due to direct DB connection timeout; used MCP SQL instead
- Prisma client regenerated successfully

## Handoff
Schema is ready. Proceed to Phase 43b to create setter accounts and enable round-robin for Founders Club.
