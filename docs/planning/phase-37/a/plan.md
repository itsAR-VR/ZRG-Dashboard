# Phase 37a — Inventory + Fix Icon-Only Controls (Accessible Names)

## Focus
Eliminate "button has no accessible name" cases by adding `aria-label` (or SR-only text) to icon-only controls throughout the dashboard.

## Inputs
- WCAG 2.1: 4.1.2 (Name, Role, Value)
- RED TEAM verified files with icon-only buttons missing aria-labels:

| File | Count | Priority |
|------|-------|----------|
| `components/dashboard/followup-sequence-manager.tsx` | 5 | HIGH (destructive actions) |
| `components/dashboard/settings-view.tsx` | 5+ | HIGH (destructive actions) |
| `components/dashboard/settings/booking-process-manager.tsx` | 6 | HIGH (destructive actions) |
| `components/dashboard/action-station.tsx` | 4 | MEDIUM (draft actions) |
| `components/dashboard/crm-view.tsx` | 3 | MEDIUM (navigation) |
| `components/dashboard/conversation-feed.tsx` | 2 | MEDIUM (navigation) |
| `components/dashboard/crm-drawer.tsx` | 1 | MEDIUM (close button) |
| `components/dashboard/chatgpt-export-controls.tsx` | 1 | LOW (settings) |
| `components/dashboard/insights-chat-sheet.tsx` | 1 | LOW (send button) |
| `components/dashboard/settings/integrations-manager.tsx` | 1 | LOW (settings) |

## Work

### Step 1: Fix HIGH priority files (destructive actions first)

**followup-sequence-manager.tsx** (5 buttons):
- Line ~404: Collapsible trigger → `aria-label="Expand sequence details"` / `"Collapse sequence details"` (dynamic)
- Line ~431: Play/pause icon → `aria-label="Pause sequence"` / `"Resume sequence"` (dynamic based on state)
- Line ~443: Edit button → `aria-label="Edit sequence"`
- Line ~450: Delete button → `aria-label="Delete sequence"`
- Line ~613: Delete step button → `aria-label="Delete step"`

**settings-view.tsx** (5+ buttons):
- Line ~1334: Delete calendar link → `aria-label="Delete calendar link"`
- Line ~2173: Delete question → `aria-label="Delete qualification question"`
- Line ~2199: Add button → `aria-label="Add qualification question"`
- Line ~2262: Action button → `aria-label="Edit item"` (check context)
- Line ~2272: Delete button → `aria-label="Delete item"`

**settings/booking-process-manager.tsx** (6 buttons):
- Line ~380: Edit button → `aria-label="Edit booking process"`
- Line ~387: Duplicate button → `aria-label="Duplicate booking process"`
- Line ~394: Delete button → `aria-label="Delete booking process"`
- Line ~626: Move up button → `aria-label="Move stage up"`
- Line ~634: Move down button → `aria-label="Move stage down"`
- Line ~642: Remove button → `aria-label="Remove stage"`

### Step 2: Fix MEDIUM priority files (navigation/draft actions)

**action-station.tsx** (4 buttons):
- Line ~745: Calendar link button → `aria-label="Insert calendar link"`
- Line ~757: Reject draft button → `aria-label="Reject draft"`
- Line ~769: Regenerate draft button → `aria-label="Regenerate draft"`
- Line ~805: Calendar link button (alternate) → `aria-label="Insert calendar link"`

**crm-view.tsx** (3 buttons):
- Line ~643: Jump to top → `aria-label="Jump to top"`
- Line ~646: Jump to bottom → `aria-label="Jump to bottom"`
- Line ~808: Dropdown trigger → `aria-label="Lead actions menu"`

**conversation-feed.tsx** (2 buttons):
- Line ~309: Jump to top → `aria-label="Jump to top"`
- Line ~318: Jump to bottom → `aria-label="Jump to bottom"`

**crm-drawer.tsx** (1 button):
- Line ~730: Close button → `aria-label="Close lead details"`

### Step 3: Fix LOW priority files

**chatgpt-export-controls.tsx** (1 button):
- Line ~150: Settings button → `aria-label="ChatGPT export settings"`

**insights-chat-sheet.tsx** (1 button):
- Line ~1819: Send button → `aria-label="Send message"`

**settings/integrations-manager.tsx** (1 button):
- Line ~989: Delete client → `aria-label="Delete client"`

### Step 4: Validation

```bash
npm run lint
npm run build
```

Manual check: Use browser DevTools Accessibility panel to verify each button now has an accessible name.

### Step 5: Run `/impeccable:harden`

After all aria-labels are added, invoke the harden skill to check for:
- Edge cases where dynamic labels might produce empty strings
- Text overflow in aria-labels (shouldn't truncate)
- Any interactive elements missed in the scan

## Output

**Completed 2026-01-18**

Added `aria-label` attributes to 28+ icon-only buttons across 10 files:

| File | Buttons Fixed |
|------|---------------|
| `components/dashboard/followup-sequence-manager.tsx` | 5 (collapsible trigger, play/pause, edit, delete sequence, delete step) |
| `components/dashboard/settings-view.tsx` | 4 (delete calendar link, delete question, retry scrape, delete asset) |
| `components/dashboard/settings/booking-process-manager.tsx` | 6 (edit, duplicate, delete process; move up/down, remove stage) |
| `components/dashboard/action-station.tsx` | 4 (insert calendar link x2, reject draft, regenerate draft) |
| `components/dashboard/crm-view.tsx` | 3 (jump to top, jump to bottom, lead actions menu) |
| `components/dashboard/conversation-feed.tsx` | 2 (jump to top, jump to bottom) |
| `components/dashboard/crm-drawer.tsx` | 1 (close lead details) |
| `components/dashboard/chatgpt-export-controls.tsx` | 1 (ChatGPT export settings) |
| `components/dashboard/insights-chat-sheet.tsx` | 1 (send message) |
| `components/dashboard/settings/integrations-manager.tsx` | 1 (delete client) |

- `npm run lint` passes (only pre-existing warnings)
- Used action-describing labels (e.g., "Pause sequence" describes what will happen)
- Dynamic labels for state-dependent buttons (expand/collapse, pause/resume)

## Handoff
Proceed to Phase 37b to address non-semantic click targets and keyboard access. Key file: `crm-view.tsx` has sortable headers and clickable rows that need keyboard support.

---

## Validation (RED TEAM)

- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] Spot-check 3 files in browser DevTools Accessibility panel: buttons show accessible names
- [ ] VoiceOver/NVDA announces button purpose when focused

## Assumptions / Open Questions (RED TEAM)

- Assumption: Dynamic labels (e.g., "Pause/Resume") should reflect current state, not action (confidence ~85%)
  - Alternative: Labels could describe the action ("Pause sequence" when playing)
  - Mitigation: Use action-describing labels for consistency with button purpose pattern
