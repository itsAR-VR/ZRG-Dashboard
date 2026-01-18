# Phase 37b — Replace Non-Semantic Click Targets (Keyboard Support)

## Focus
Fix "clickable div" patterns so all interactive affordances are keyboard accessible and semantically correct.

## Inputs
- WCAG 2.1: 2.1.1 (Keyboard), 4.1.2 (Name/Role/Value)
- RED TEAM verified hotspots:

| File | Location | Pattern | Fix Strategy |
|------|----------|---------|--------------|
| `components/dashboard/crm-view.tsx` | Lines 657-669 | Sortable column headers using `<div onClick>` | Convert to `<button>` with `aria-sort` |
| `components/dashboard/crm-view.tsx` | Lines 721-729 | Clickable table rows using `<div onClick>` | Add `role="button"` + `tabIndex={0}` + `onKeyDown` |

## Work

### Step 1: Fix sortable column headers (crm-view.tsx lines 657-669)

**Current pattern (line 657-662):**
```tsx
<div
  className="flex-[3] min-w-[200px] cursor-pointer hover:bg-muted/50 px-2 py-1 rounded flex items-center gap-1"
  onClick={() => handleSort("firstName")}
>
  Name <SortIcon field="firstName" />
</div>
```

**Fixed pattern:**
```tsx
<button
  type="button"
  className="flex-[3] min-w-[200px] cursor-pointer hover:bg-muted/50 px-2 py-1 rounded flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  onClick={() => handleSort("firstName")}
  aria-sort={sortField === "firstName" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
>
  Name <SortIcon field="firstName" />
</button>
```

Apply same fix to:
- Line ~665-669: Score column header

### Step 2: Fix clickable table rows (crm-view.tsx lines 721-729)

**Current pattern:**
```tsx
<div
  key={lead.id}
  className="absolute top-0 left-0 w-full flex items-center px-4 border-b hover:bg-muted/50 cursor-pointer"
  style={{ ... }}
  onClick={() => openLeadDetail(lead)}
>
```

**Fixed pattern (Option A - role attribute):**
```tsx
<div
  key={lead.id}
  role="button"
  tabIndex={0}
  className="absolute top-0 left-0 w-full flex items-center px-4 border-b hover:bg-muted/50 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
  style={{ ... }}
  onClick={() => openLeadDetail(lead)}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openLeadDetail(lead);
    }
  }}
  aria-label={`View details for ${lead.firstName} ${lead.lastName || ""}`}
>
```

**Note:** We use `role="button"` instead of converting to `<button>` because:
1. The row contains other interactive elements (dropdowns, status selects)
2. Virtualized rows have complex positioning requirements
3. Adding `tabIndex={0}` + `onKeyDown` achieves keyboard access with minimal changes

### Step 3: Ensure nested controls don't break

For rows with nested interactive controls (lines ~783, ~805):
- Existing `onClick={(e) => e.stopPropagation()}` patterns are correct
- Verify that nested controls (DropdownMenu, Select) remain independently focusable and don't fire row click

### Step 4: Validation

```bash
npm run lint
npm run build
```

Manual keyboard test:
1. Tab to "Name" column header → focus ring visible
2. Press Enter → sort toggles
3. Tab to a table row → focus ring visible
4. Press Enter or Space → lead detail opens
5. Tab into row's nested dropdown → dropdown opens (row click doesn't fire)

### Step 5: Run `/impeccable:harden`

After keyboard support is added, invoke the harden skill to check for:
- Edge cases: empty lead names in aria-labels
- Keyboard trap scenarios (can you Tab out of the table?)
- Focus order consistency across different data states (empty list, loading, error)

## Output

**Completed 2026-01-18**

Fixed non-semantic click targets in `components/dashboard/crm-view.tsx`:

1. **Sortable column headers** (lines 657-674):
   - Converted `<div onClick>` to `<button type="button">`
   - Added `aria-sort` attribute with dynamic values (`ascending`/`descending`/`undefined`)
   - Added `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
   - Fixed: Name column and Score column headers

2. **Clickable table rows** (lines 726-742):
   - Added `role="button"` to maintain div structure (needed for virtualization)
   - Added `tabIndex={0}` for keyboard focus
   - Added `onKeyDown` handler for Enter and Space key activation
   - Added `aria-label={`View details for ${lead.name}`}`
   - Added `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`

- `npm run lint --quiet` passes (no errors)
- Nested controls (dropdowns, selects) already have `stopPropagation()` handlers

## Handoff
Proceed to Phase 37c to fix the `.insights-input-focus:focus` pseudo-class issue in `globals.css` and audit other focus visibility patterns.

---

## Validation (RED TEAM)

- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] Tab navigation works: headers → rows → nested controls
- [ ] Enter/Space activates both headers and rows
- [ ] Nested dropdowns don't trigger row click
- [ ] Focus ring visible on all interactive elements

## Assumptions / Open Questions (RED TEAM)

- Assumption: Using `role="button"` on rows is preferred over wrapping in `<button>` due to virtualization and nested controls (confidence ≥90%)
  - Mitigation: If accessibility auditors flag this, consider refactoring to use a table element with `aria-activedescendant` pattern
- Assumption: `focus-visible:ring-inset` is appropriate for rows to avoid ring extending outside virtualized container (confidence ~85%)
  - Mitigation: Test visually; if inset looks odd, use standard ring with overflow handling
