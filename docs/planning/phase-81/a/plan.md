# Phase 81a — Schema: Add Fields to WorkspaceSettings

## Focus

Add three new fields to `WorkspaceSettings` model for storing Slack approval recipients and caching workspace members.

## Inputs

- Root plan context: Need per-workspace storage for selected Slack users who receive AI auto-send approval DMs
- Existing schema pattern: `WorkspaceSettings` uses JSON fields for complex config (e.g., `notificationSentimentRules`)
- Phase 80 coordination: Schema changes should be placed after the `autoSendScheduleMode` fields added by Phase 80

## Work

### 1. Add Fields to WorkspaceSettings

**File**: `prisma/schema.prisma`

Add after the calendar settings block (around line 306, after Phase 80's `autoSendCustomSchedule`):

```prisma
// AI Auto-Send Approval Recipients (Phase 81)
// JSON array: [{ id: string, email: string, displayName: string, avatarUrl?: string }]
slackAutoSendApprovalRecipients Json?
// Cached Slack members for settings UI (1-hour TTL)
slackMembersCacheJson           Json?
slackMembersCachedAt            DateTime?
```

### 2. Field Descriptions

| Field | Type | Purpose |
|-------|------|---------|
| `slackAutoSendApprovalRecipients` | `Json?` | Array of selected Slack users who receive approval DMs |
| `slackMembersCacheJson` | `Json?` | Cached list of all Slack workspace members (for UI dropdown) |
| `slackMembersCachedAt` | `DateTime?` | Timestamp of last cache refresh (for TTL logic) |

### 3. Type Definition

Create TypeScript type for the JSON structure:

```typescript
// In lib/auto-send/get-approval-recipients.ts (created in 81c)
export type SlackApprovalRecipient = {
  id: string;           // Slack user ID (U...)
  email: string;        // For DM lookup / display
  displayName: string;  // User's display name
  avatarUrl?: string;   // Profile image URL (optional)
};
```

### 4. Validation

- [ ] Run `npm run db:push` to apply schema changes
- [ ] Verify in Prisma Studio that new fields appear in WorkspaceSettings
- [ ] Run `npm run lint` — should pass
- [ ] Run `npm run build` — should pass

## Output

- Schema updated with 3 new fields on `WorkspaceSettings`:
  - `slackAutoSendApprovalRecipients`, `slackMembersCacheJson`, `slackMembersCachedAt`
- `npm run db:push` completed successfully against Supabase

## Coordination Notes

**Integrated from Phase 80:** Added fields after `autoSendCustomSchedule` to align with Phase 80 schedule fields.
**Files affected:** `prisma/schema.prisma`

## Handoff

Schema is ready for Phase 81b to add Slack API functions that will populate `slackMembersCacheJson`.
