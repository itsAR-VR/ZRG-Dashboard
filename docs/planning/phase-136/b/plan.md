# Phase 136b — Backend Logic (Orchestrator + Server Actions)

## Focus

Wire up the resolution logic so the orchestrator correctly resolves campaign → workspace → false, and update server actions to read/write the new workspace field.

## Inputs

- Phase 136a outputs (schema + types updated)
- `lib/auto-send/orchestrator.ts` — line 279 (current: `context.emailCampaign?.autoSendSkipHumanReview === true`)
- `actions/settings-actions.ts` — `UserSettingsData` interface (line 17), `getUserSettings()` (line 129), `updateUserSettings()` (line 337)
- `actions/email-campaign-actions.ts` — types (lines 22, 113, 124), `updateEmailCampaignConfig()` (line 159)

## Work

### 1. Orchestrator resolution — `lib/auto-send/orchestrator.ts`

Replace line 279:

```ts
// Before:
const skipHumanReview = context.emailCampaign?.autoSendSkipHumanReview === true;

// After:
const campaignSkip = context.emailCampaign?.autoSendSkipHumanReview;
const skipHumanReview = typeof campaignSkip === "boolean"
  ? campaignSkip
  : context.workspaceSettings?.autoSendSkipHumanReview === true;
```

Logic: if campaign has an explicit boolean, use it. Otherwise inherit from workspace. If neither is set, defaults to `false`.

### 2. Settings action — `actions/settings-actions.ts`

**UserSettingsData interface** (~line 64, after `autoSendCustomSchedule`):
```ts
autoSendSkipHumanReview: boolean;
```

**getUserSettings() — default creation** (~line 220):
```ts
autoSendSkipHumanReview: false,
```

**getUserSettings() — return mapping** (~line 248):
```ts
autoSendSkipHumanReview: ws.autoSendSkipHumanReview,
```

**updateUserSettings() — admin-gated update** (~line 398+):
Add handling for the new field in the workspace update payload, gated by `isWorkspaceAdmin` (same pattern as `autoSendScheduleMode`).

### 3. Campaign action — `actions/email-campaign-actions.ts`

Update all type definitions to use `boolean | null` instead of `boolean`:
- Line 22: `autoSendSkipHumanReview: boolean | null;`
- Line 113 (opts): `autoSendSkipHumanReview?: boolean | null;`
- Line 124 (return): `autoSendSkipHumanReview: boolean | null;`

Update `updateEmailCampaignConfig()` (line 159-160) to accept `null`:
```ts
if (opts.autoSendSkipHumanReview !== undefined) {
  data.autoSendSkipHumanReview = opts.autoSendSkipHumanReview;
}
```

## Output

- Orchestrator correctly resolves: campaign explicit → workspace default → false
- Settings actions read/write the workspace-level toggle
- Campaign actions handle nullable field

## Handoff

Backend is complete. Phase 136c can now build the workspace UI knowing the settings action supports the new field.
