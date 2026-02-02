# Phase 81e — UI: Settings Member Picker Component

## Focus

Add a member selection UI in the Settings → Integrations → Slack section for choosing AI auto-send approval recipients.

## Inputs

- Phase 81c: Server actions `getSlackMembers()`, `updateSlackApprovalRecipients()`, `getSlackApprovalRecipients()` available
- Existing UI: `components/dashboard/settings-view.tsx` has Slack integration section (around line 2525+)
- Existing pattern: Channel selection uses chip-based multi-select

## Work

### 1. Add State Variables

In `settings-view.tsx`, add new state for member selection:

```typescript
// Near other Slack-related state
const [slackMembers, setSlackMembers] = useState<SlackApprovalRecipient[]>([]);
const [selectedApprovalRecipients, setSelectedApprovalRecipients] = useState<SlackApprovalRecipient[]>([]);
const [isLoadingSlackMembers, setIsLoadingSlackMembers] = useState(false);
```

### 2. Add Type Import

```typescript
import type { SlackApprovalRecipient } from "@/lib/auto-send/get-approval-recipients";
import {
  getSlackMembers,
  updateSlackApprovalRecipients,
  getSlackApprovalRecipients
} from "@/actions/slack-integration-actions";
```

### 3. Load Recipients on Mount

In the settings loading effect (where other settings are loaded):

```typescript
// In the useEffect that loads settings
if (selectedClientId) {
  // ... existing loads ...

  // Load approval recipients
  getSlackApprovalRecipients(selectedClientId).then((result) => {
    if (result.success && result.recipients) {
      setSelectedApprovalRecipients(result.recipients);
    }
  });

  // Load cached members (will auto-refresh if stale)
  getSlackMembers(selectedClientId).then((result) => {
    if (result.success && result.members) {
      setSlackMembers(result.members);
    }
  });
}
```

### 4. Add Handler Functions

```typescript
// Refresh members from Slack API
async function handleRefreshSlackMembers() {
  if (!selectedClientId) return;
  setIsLoadingSlackMembers(true);
  try {
    const result = await refreshSlackMembersCache(selectedClientId);
    if (result.success && result.members) {
      setSlackMembers(result.members);
      toast({ title: "Slack members refreshed" });
    } else {
      toast({ title: "Failed to refresh members", description: result.error, variant: "destructive" });
    }
  } finally {
    setIsLoadingSlackMembers(false);
  }
}

// Toggle a member in the selection
function toggleApprovalRecipient(member: SlackApprovalRecipient) {
  setSelectedApprovalRecipients((prev) => {
    const exists = prev.some((r) => r.id === member.id);
    if (exists) {
      return prev.filter((r) => r.id !== member.id);
    } else {
      return [...prev, member];
    }
  });
  setHasChanges(true);
}
```

### 5. Add to Save Handler

In the settings save function:

```typescript
// When saving settings
if (hasChanges && selectedClientId) {
  // ... existing saves ...

  // Save approval recipients
  await updateSlackApprovalRecipients(selectedClientId, selectedApprovalRecipients);
}
```

### 6. Add UI Component

Add after the existing Slack channels section (around line ~2640):

```tsx
<Separator />

<div className="space-y-3">
  <div className="flex items-center justify-between">
    <div>
      <Label className="text-sm font-medium">AI Auto-Send Approval Recipients</Label>
      <p className="text-xs text-muted-foreground mt-0.5">
        Team members who receive Slack DMs when AI auto-send needs human review
      </p>
    </div>
    <Button
      variant="outline"
      size="sm"
      onClick={handleRefreshSlackMembers}
      disabled={isLoadingSlackMembers || !slackTokenStatus?.configured}
    >
      {isLoadingSlackMembers && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
      Refresh members
    </Button>
  </div>

  {!slackTokenStatus?.configured ? (
    <p className="text-xs text-muted-foreground">
      Configure a Slack bot token above to select approval recipients.
    </p>
  ) : slackMembers.length === 0 ? (
    <p className="text-xs text-muted-foreground">
      No members found. Click "Refresh members" to load your Slack workspace members.
    </p>
  ) : (
    <div className="flex flex-wrap gap-2">
      {slackMembers.map((member) => {
        const isSelected = selectedApprovalRecipients.some((r) => r.id === member.id);
        return (
          <button
            key={member.id}
            type="button"
            onClick={() => toggleApprovalRecipient(member)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-colors",
              isSelected
                ? "border-primary bg-primary/10 text-primary"
                : "border-muted hover:border-primary/50"
            )}
          >
            {member.avatarUrl && (
              <img
                src={member.avatarUrl}
                alt=""
                className="h-5 w-5 rounded-full"
              />
            )}
            <span>{member.displayName}</span>
            {isSelected && <Check className="h-3 w-3" />}
          </button>
        );
      })}
    </div>
  )}

  {slackTokenStatus?.configured && slackMembers.length > 0 && selectedApprovalRecipients.length === 0 && (
    <p className="text-xs text-amber-600 dark:text-amber-400">
      No recipients selected. Using fallback recipient for approval notifications.
    </p>
  )}

  {selectedApprovalRecipients.length > 0 && (
    <p className="text-xs text-muted-foreground">
      {selectedApprovalRecipients.length} recipient{selectedApprovalRecipients.length > 1 ? "s" : ""} selected
    </p>
  )}
</div>
```

### 7. Validation

- [ ] Run `npm run lint` — should pass
- [ ] Run `npm run build` — should pass
- [ ] Manual test:
  - Open Settings → Integrations → Slack
  - Verify "Refresh members" button appears
  - Click to load members
  - Select 1-2 recipients
  - Save settings
  - Refresh page — verify selection persists

## Output

- `components/dashboard/settings-view.tsx`: Member picker UI wired to Slack members + recipients CRUD
- Save flow persists approval recipients alongside other settings

## Handoff

Phase 81 complete. Full verification:
1. `npm run lint` passes
2. `npm run build` passes
3. `npm run db:push` applied schema changes
4. Manual test: Configure recipients → trigger low-confidence draft → verify DMs arrive
