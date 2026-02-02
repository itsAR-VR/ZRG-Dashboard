# Phase 90d — CRM Table UI Inline Editing + Remove Rolling Columns

## Focus
Make Analytics → CRM behave like a spreadsheet: inline editing, fast save, clear validation errors, and per-edit prompts for automation-coupled changes.

## Inputs
- `components/dashboard/analytics-crm-table.tsx` (Phase 83, lines 1-339)
- Server actions from Phase 90c (`getCrmAssigneeOptions`, `updateCrmSheetCell`)

## Work
### 1) Remove rolling rate columns from table UI
- **Delete from TableHeader** (lines 264-265):
  - `<TableHead>Rolling Meeting Request Rate</TableHead>`
  - `<TableHead>Rolling Booking Rate</TableHead>`
- **Delete from TableRow** (lines 317-318):
  - `<TableCell>{row.rollingMeetingRequestRate...}</TableCell>`
  - `<TableCell>{row.rollingBookingRate...}</TableCell>`
- **Update colSpan** in loading/empty states (change `35` to `33`)

### 2) Inline cell editing UX

**Editable cells:**
| Column | Edit type | Special handling |
|--------|-----------|------------------|
| Job Title | Text input | — |
| Lead Category | Text input + dropdown toggle | Show "Update automation?" toggle |
| Lead Status | Text input + dropdown toggle | Show "Update automation?" toggle |
| Lead Type | Text input | — |
| Application Status | Text input | — |
| Notes | Textarea | — |
| Campaign | Text input | — |
| Lead's Email | Text input | Validation + dedupe |
| Phone Number | Text input | Validation + normalize |
| Lead LinkedIn | Text input | Validation + normalize |
| Appointment Setter | Dropdown | Populated from `getCrmAssigneeOptions` |

**Non-editable cells (computed):**
- DATE, Initial response date, Follow-up 1-5, Response step complete
- AI vs Human Response, Lead Score, Step Responded
- Company Name, Website, First Name, Last Name (editable in Phase 90+)

**UX pattern:**
- Click cell → shows input/dropdown overlaying the cell
- Enter or blur → save (call `updateCrmSheetCell`)
- Escape → cancel edit
- Show inline spinner during save
- Show inline error message on failure (red text below input)
- On success → update local state, flash green briefly

### 3) Per-edit prompt for automation-coupled fields
When user edits **Lead Category** or **Lead Status**:
- Show a small toggle/checkbox below the input: "☐ Also update automation"
- Default: unchecked (CRM-only)
- If checked, call `updateCrmSheetCell({ ..., updateAutomation: true })`

**Implementation:** Use a small inline dropdown or toggle, NOT a blocking modal.

### 4) Assignment dropdown
- On component mount (or first click), fetch `getCrmAssigneeOptions({ clientId })`
- Cache options in component state for session duration
- Show dropdown with setter emails
- On select, call `updateCrmSheetCell({ field: 'assignedToUserId', value: selectedUserId })`

### 5) Performance considerations
- Keep existing pagination ("Load more") behavior
- Only re-render the edited cell, not the entire table (use local state per cell or row)
- Consider `React.memo` for TableRow components
- Optimistic UI: update local state immediately, revert on error

## Validation (RED TEAM)
- [ ] Rolling rate columns no longer appear in table
- [ ] Click-to-edit works for all editable cells
- [ ] Lead Category/Status edits show "update automation" toggle
- [ ] Assignment dropdown loads and saves correctly
- [ ] Error messages display inline (not alert/toast)
- [ ] Table doesn't re-render entirely on single cell save

## Output
- CRM table renders without rolling columns (colSpan updated for empty/loading states)
- Inline editing added for supported fields with optimistic updates + inline errors
- Appointment setter dropdown wired to `getCrmAssigneeOptions`
- Lead Category/Status edits show "Also update automation" toggle

## Coordination Notes
**No direct conflicts** in files touched for this subphase.

## Validation Notes
- Manual UI verification not run in this environment.

## Handoff
Proceed to Phase 90e to fix response attribution data behavior and ensure interest upserts don't encode the old "pre-interest outbound" response logic.
