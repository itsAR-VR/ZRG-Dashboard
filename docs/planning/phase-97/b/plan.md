# Phase 97b — Campaign Panel Warnings (Warn-only)

## Focus
Reduce confusion about "AI not auto-sending" by flagging when a campaign appears intended for AI auto-send (by naming convention) but is configured as draft-only (`SETTER_MANAGED`).

## Inputs
- Campaign assignment UI: `components/dashboard/settings/ai-campaign-assignment.tsx:144-550`
- Decision: warn-only (no bulk enable / no auto-enable-by-name).
- Existing UI structure: uses `Collapsible` per campaign row with badges for mode/threshold.

## Work

### Step 1: Add warning detection helper

At the top of the component (after imports), add:

```tsx
const AI_NAME_PATTERN = /ai\s*(responses?|auto[-\s]?send)/i;

function shouldWarnMismatch(row: CampaignRow): boolean {
  return row.responseMode !== "AI_AUTO_SEND" && AI_NAME_PATTERN.test(row.name);
}
```

### Step 2: Add per-row warning indicator

In the campaign row rendering (around line 433-444), after the campaign name, add a warning badge when `shouldWarnMismatch(row)` is true:

```tsx
<div className="flex flex-wrap items-center gap-2">
  <span className="text-sm font-medium">{row.name}</span>
  {shouldWarnMismatch(row) && (
    <Badge variant="destructive" className="text-[10px] uppercase tracking-wide">
      ⚠️ Not AI
    </Badge>
  )}
  {isDirty ? (
    <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
      Unsaved
    </Badge>
  ) : null}
</div>
```

### Step 3: Add summary indicator near header badges

In the header section (around line 368-376), add a warning count badge:

```tsx
// Compute mismatch count
const mismatchCount = useMemo(() => {
  return rows.filter(shouldWarnMismatch).length;
}, [rows]);

// In the header badges area:
{mismatchCount > 0 && (
  <Badge variant="destructive" className="whitespace-nowrap">
    ⚠️ {mismatchCount} not AI
  </Badge>
)}
```

### Step 4: Add tooltip/description for the warning

In the description area (inside the `rounded-lg border bg-muted/30` section around line 379-393), add:

```tsx
{mismatchCount > 0 && (
  <span className="text-amber-600 dark:text-amber-400">
    ⚠️ {mismatchCount} campaign{mismatchCount > 1 ? "s" : ""} named "AI Responses" but set to Setter-managed.
    Switch to AI auto‑send to enable sending.
  </span>
)}
```

## Validation (RED TEAM)

1. **Manual QA:** Create or find a campaign named "AI Responses Test" with `SETTER_MANAGED` mode. Verify:
   - Warning badge appears on the row
   - Summary count appears in header
   - Changing to `AI_AUTO_SEND` removes the warning
2. **Build check:** `npm run build` passes.
3. **Lint check:** `npm run lint` passes.
4. **Visual regression:** Verify warning styling is consistent with design system (destructive badge for errors, amber text for info).

## Output
- UI warning/indicator added; no backend changes.
- Per-row warning badge when campaign name implies AI but mode is setter-managed.
- Summary count in header for quick visibility.

### Completed (2026-02-03)
- Added warn-only UI for campaigns named “AI Responses” but still `SETTER_MANAGED`:
  - Header badge: `AI Responses (setter): <count>`
  - Per-row inline warning with `AlertTriangle` + actionable copy
  (`components/dashboard/settings/ai-campaign-assignment.tsx`)

## Handoff
Proceed to Phase 97c to add stats (server action + UI) to quantify extent (configured vs blocked vs sent).
