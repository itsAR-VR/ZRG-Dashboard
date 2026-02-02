# Phase 89a — Schema + WorkspaceSettings Fields

## Focus
Add the minimum schema surface needed to configure weighted round-robin assignment per workspace, while keeping backward compatibility with the existing `roundRobinEnabled` + `roundRobinLastSetterIndex` mechanism.

## Inputs
- Existing assignment state fields in `WorkspaceSettings`:
  - `roundRobinEnabled`
  - `roundRobinLastSetterIndex`
- Current assignment implementation: `lib/lead-assignment.ts`
- Current admin assignments UI: `components/dashboard/settings/integrations-manager.tsx`

## Work
1. Update `prisma/schema.prisma`:
   - Add `WorkspaceSettings.roundRobinSetterSequence` as `String[] @default([])`
     - Stores **Supabase Auth user IDs** in exact rotation order.
     - Duplicates allowed (enables weighting).
   - Add `WorkspaceSettings.roundRobinEmailOnly` as `Boolean @default(false)`
2. Decide pointer semantics:
   - Treat `roundRobinLastSetterIndex` as the last-used index into the **effective sequence**:
     - If `roundRobinSetterSequence` is non-empty, the pointer is against that sequence.
     - Else, the pointer is against the fallback “active setters (createdAt asc)” list.
3. Database sync:
   - Run `npm run db:push` to apply schema changes.
   - Ensure Prisma client regeneration is healthy (`npm run build` runs `prisma generate`).

## Output
- Added new WorkspaceSettings fields in `prisma/schema.prisma`:
  - `roundRobinSetterSequence String[] @default([])` (duplicates allowed; ordered Supabase Auth user IDs)
  - `roundRobinEmailOnly Boolean @default(false)` (email-only assignment gate)
- Ran `npm run db:push` successfully; database is in sync with the updated schema.
- Pointer semantics: `roundRobinLastSetterIndex` will be interpreted against the effective sequence (custom sequence when configured; otherwise the fallback active-setter list).

## Validation (RED TEAM)

1. Run `npm run db:push` — should complete without errors
2. Run `npm run build` — Prisma client regenerates; no TypeScript errors
3. Verify in Prisma Studio (`npm run db:studio`):
   - Navigate to WorkspaceSettings
   - Confirm `roundRobinSetterSequence` column exists (empty array default)
   - Confirm `roundRobinEmailOnly` column exists (false default)
4. Spot-check one Founders Club record: both new fields present with defaults

## Schema Insertion Point (RED TEAM)

**Pre-flight check:** Re-read `prisma/schema.prisma` before editing. Phase 83 has uncommitted changes that may shift line numbers. Look for the existing round-robin fields:
```prisma
  // Round-robin lead assignment (Phase 43)
  roundRobinEnabled         Boolean  @default(false)
  roundRobinLastSetterIndex Int?
```

Insert new fields immediately after `roundRobinLastSetterIndex`:

```prisma
  // Round-robin lead assignment (Phase 43)
  roundRobinEnabled         Boolean  @default(false)  // When true, new positive leads are assigned to setters in rotation
  roundRobinLastSetterIndex Int?                      // Index of last assigned setter (for rotation)
  // Weighted round-robin sequence (Phase 89)
  roundRobinSetterSequence  String[] @default([])     // Ordered Supabase Auth user IDs; duplicates allowed for weighting. Empty = use active setters in createdAt order.
  roundRobinEmailOnly       Boolean  @default(false)  // When true, only inbound Email events trigger assignment (SMS/LinkedIn triggers are ignored)
```

**Note:** The new fields use `String[]` for the sequence (not a relation) because:
1. Duplicates are needed for weighting (e.g., Vee appears twice)
2. Order matters and must be preserved
3. Supabase Auth user IDs are stable UUIDs

## Handoff
Proceed to Phase 89b to update `lib/lead-assignment.ts` (and trigger call sites) to use the configured sequence and enforce the email-only gate.
