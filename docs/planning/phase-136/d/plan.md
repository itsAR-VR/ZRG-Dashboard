# Phase 136d — Campaign Settings UI (3-State Selector)

## Focus

Replace the per-campaign "Skip human review" checkbox with a 3-state Select that supports "Inherit workspace" (null), "Skip review" (true), and "Require review" (false).

## Inputs

- Phase 136c outputs (workspace toggle is functional)
- `components/dashboard/settings/ai-campaign-assignment.tsx` — existing checkbox at lines 559-578
- `CampaignRow` type (line ~21): `autoSendSkipHumanReview: boolean`

## Work

### 1. Update CampaignRow type

Change `autoSendSkipHumanReview` from `boolean` to `boolean | null`:

```ts
autoSendSkipHumanReview: boolean | null;
```

### 2. Replace checkbox with Select

Replace the checkbox block (lines 559-578) with a Select component:

```tsx
{row.responseMode === "AI_AUTO_SEND" ? (
  <div className="mt-1 space-y-1">
    <Label className="text-xs text-muted-foreground">Human review</Label>
    <Select
      value={row.autoSendSkipHumanReview === null ? "inherit" : row.autoSendSkipHumanReview ? "skip" : "require"}
      disabled={thresholdDisabled}
      onValueChange={(v) =>
        updateRow(row.id, {
          autoSendSkipHumanReview: v === "inherit" ? null : v === "skip",
        })
      }
    >
      <SelectTrigger className="h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="inherit">Inherit workspace</SelectItem>
        <SelectItem value="skip">Skip review</SelectItem>
        <SelectItem value="require">Require review</SelectItem>
      </SelectContent>
    </Select>
    <p className="text-xs text-muted-foreground">
      Hard blocks (opt-out, blacklist) always apply.
    </p>
  </div>
) : null}
```

### 3. Update save logic

In `updateRow` / `handleSave`, ensure `null` is passed through to the server action (not coerced to `false`).

### 4. Verification

- `npm run lint` — no errors
- `npm run build` — TypeScript compiles
- Manual: set workspace toggle ON → campaign shows "Inherit workspace" → auto-send skips review
- Manual: set campaign to "Require review" → overrides workspace → review required
- Manual: hard blocks still prevent sending regardless

## Output

- Campaign UI shows 3-state selector with clear inherit/override semantics
- All files compile and lint cleanly

## Handoff

Phase 136 is complete. All changes verified via build + lint + manual testing.
