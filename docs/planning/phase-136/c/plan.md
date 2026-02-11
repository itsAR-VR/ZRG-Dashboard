# Phase 136c — Workspace Settings UI (Global Toggle)

## Focus

Add a Switch toggle to the workspace settings for "Skip Human Review" as a global default, placed in the existing "AI Auto-Send Schedule" card.

## Inputs

- Phase 136b outputs (settings action supports the new field)
- `components/dashboard/settings-view.tsx` — Auto-Send Schedule card starts at ~line 2845
- Existing patterns: `Switch` is already imported (line 48), admin-gating via `isWorkspaceAdmin`

## Work

### 1. Add state

Add near existing auto-send state (~line 443):

```ts
const [autoSendSkipHumanReview, setAutoSendSkipHumanReview] = useState(false);
```

### 2. Load from settings

In the settings fetch callback (~line 776, after `setAutoSendSchedule`):

```ts
setAutoSendSkipHumanReview(result.data.autoSendSkipHumanReview ?? false);
```

### 3. Add to save payload

In `handleSave` (~line 1564, in the `isWorkspaceAdmin` block):

```ts
payload.autoSendSkipHumanReview = autoSendSkipHumanReview;
```

### 4. Render the toggle

Inside the "AI Auto-Send Schedule" card (~line 2853), add before the Accordion:

```tsx
<div className="flex items-center justify-between rounded-lg border p-3">
  <div className="space-y-0.5">
    <Label className="text-sm font-medium">Skip Human Review (Global Default)</Label>
    <p className="text-xs text-muted-foreground">
      When enabled, all campaigns skip human review by default.
      Individual campaigns can override this. Hard blocks (opt-out, blacklist) always apply.
    </p>
  </div>
  <Switch
    checked={autoSendSkipHumanReview}
    disabled={!isWorkspaceAdmin}
    onCheckedChange={setAutoSendSkipHumanReview}
  />
</div>
```

## Output

- Workspace settings UI has a visible Switch toggle for global skip-human-review
- Toggle is admin-gated and persists via the existing save flow

## Handoff

Workspace UI is complete. Phase 136d updates the campaign UI to show the "Inherit workspace" option and display the current workspace default.
