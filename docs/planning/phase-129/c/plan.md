# Phase 129c — UI Surfaces (System Defaults + Indicators + Reset)

## Focus
Extend the existing AI Prompts modal in Settings to:
1) show which content is code/system/workspace with colored badges,
2) allow super admins to edit system defaults,
3) keep workspace edits isolated and resettable,
4) show stale warning badges when system defaults change after workspace overrides were saved.

## Inputs
- Root plan: `docs/planning/phase-129/plan.md`
- 129a: super-admin system prompt/snippet actions (`actions/system-prompt-actions.ts`), expanded `getSnippetRegistry()` return shape
- 129b: effective-source semantics (`source: "workspace"|"system"|"code"`), stale detection rule, telemetry key formats
- Existing UI: `components/dashboard/settings-view.tsx` (AI Prompts dialog L5912+, tabs: "prompts" + "variables", `promptModalTab` state)
- Super-admin detection: `getGlobalAdminStatus()` in `actions/access-actions.ts:6`

## Work

### 1. Add "System Defaults" tab (super-admin only)
- File: `components/dashboard/settings-view.tsx`
- Gate visibility using `getGlobalAdminStatus()` (returns `{ isAdmin: boolean }`).
- Add new tab value: `promptModalTab === "system-prompts"` and `"system-variables"` (or a single "system" tab with internal sub-tabs).
- **System Prompts editor:**
  - List all prompt templates from `getAiPromptTemplates()`.
  - For each template, show messages with current effective content.
  - Per-message: show "System Override" badge (amber) if system override exists, or "Code Default" (gray) if not.
  - Edit button → opens editor pre-filled with current system override or code default.
  - Save calls `saveSystemPromptOverride()` from `actions/system-prompt-actions.ts`.
  - "Reset to Code Default" button → calls `resetSystemPromptOverride()`.
- **System Variables editor:**
  - List all snippet keys from system-level data.
  - For each: show current system override or code default.
  - Edit/save/reset mirrors prompts.

### 2. Workspace prompt editor — 3-state badges
- File: `components/dashboard/settings-view.tsx`
- Per-message badge colors:
  - **"Workspace Custom"** → `bg-blue-500/10 text-blue-500` (existing "Customized" badge style)
  - **"System Default"** → `bg-amber-500/10 text-amber-500` (new)
  - **"Code Default"** → `bg-muted text-muted-foreground` or no badge (new)
- Badge logic uses `source` field from 129b's expanded return data.

### 3. Stale warning badges
- When a workspace override exists AND the corresponding system default's `updatedAt` is more recent than the workspace override's `updatedAt`:
  - Show amber warning badge: **"System default changed"** next to the message.
  - Tooltip or subtitle: "The system default was updated after your workspace customization. Review and re-save or reset."
- Data source: `isStale` field from expanded `getSnippetRegistry()` return (129a) and per-message system override data.
- Badge style: `bg-amber-500/10 text-amber-700 border border-amber-300` with a small warning icon.

### 4. Reset button semantics
- **Workspace prompt editor:**
  - If system default exists for this message: button reads **"Reset to System Default"**
  - If no system default: button reads **"Reset to Code Default"**
  - Action: calls existing `resetPromptOverride()` which deletes workspace override → resolution falls through to system/code automatically.
- **Workspace variables tab:**
  - Same logic: "Reset to System Default" / "Reset to Code Default"
  - Action: calls existing `resetPromptSnippetOverride()`.
- **System Defaults editor (super-admin):**
  - Button reads **"Reset to Code Default"**
  - Action: calls `resetSystemPromptOverride()` / `resetSystemSnippetOverride()`.

### 5. Provenance hint text
- Below each prompt message and snippet in the workspace editor, show a subtle text line:
  - "Currently using: Workspace customization (saved Feb 5, 2026)"
  - "Currently using: System default (set by admin, Feb 3, 2026)"
  - "Currently using: Code default"
- Style: `text-xs text-muted-foreground` — informational, not prominent.

### 6. Workspace variables tab improvements
- File: `components/dashboard/settings-view.tsx`
- Use expanded `getSnippetRegistry()` return shape to show:
  - 3-state badge per snippet key (workspace/system/code)
  - Stale warning badge where applicable
  - Reset button with dynamic copy
  - Effective value vs code default comparison

### 7. State isolation
- Ensure modal state cannot leak across workspaces (preserve existing `clientId`-scoped data fetching).
- When switching workspaces, re-fetch all data including system override status.

## Validation (RED TEAM)
- Run `npm run lint` — no errors.
- Run `npm run build` — succeeds.
- Manual UI smoke tests:
  - Non-super-admin: "System Defaults" tab should NOT be visible.
  - Super-admin: "System Defaults" tab IS visible, can edit system prompts/snippets.
  - Workspace editor: badges correctly reflect source (workspace/system/code).
  - Stale badge: edit system default → workspace override shows "System default changed".
  - Reset in workspace: correctly falls back to system default or code default.
  - Reset in system: correctly falls back to code default.

## Output
- Settings UI supports system defaults editing (super admin only) with clear tab separation.
- 3-state badges (blue/amber/gray) on all prompt messages and snippet variables.
- Stale warning badges when system defaults change after workspace overrides.
- Code-drift warning badges ("Code changed") when an override exists but is not applied due to `baseContentHash` mismatch.
- History dialogs for system prompts/variables and workspace variables, with rollback.
- One-click "Set as system default" promotion from workspace overrides.
- Dynamic reset button copy reflecting target layer.
- Provenance hint text showing current source and timestamp.

## Handoff
Provide to 129d:
- Screens/flows list for manual smoke testing:
  1. Super-admin: System Defaults tab → edit prompt → save → verify workspace picks it up
  2. Super-admin: System Defaults tab → edit snippet → save → verify
  3. Workspace admin: edit prompt → save → verify "Workspace Custom" badge
  4. Workspace admin: verify "System Default" badge when system override exists
  5. Workspace admin: reset → verify falls back to system/code
  6. Stale flow: edit system default AFTER workspace override → verify amber warning
  7. Non-admin: verify System Defaults tab is hidden
- UI-only edge cases to test:
  - Drifted workspace override (code changed, hash mismatch) → should show code default, no workspace badge
  - Drifted system override (code changed, hash mismatch) → should show code default
  - Workspace and system both drifted → code default shown

## Progress This Turn (Terminus Maximus)
- Work done:
  - Extended Settings → Backend Prompts modal to include super-admin-only tabs: "System Prompts" and "System Variables". (`components/dashboard/settings-view.tsx`)
  - Added UI badges for effective source + stale-warning indicator:
    - `Workspace Custom` (blue)
    - `System Default` (amber)
    - `System default changed` (amber warning)
  - Updated reset UX copy to reflect whether the baseline is system default vs code default. (`components/dashboard/settings-view.tsx`)
  - Added code-drift indicator for prompts ("Code changed") and made the workspace Prompts tab render effective runtime content (workspace > system > code). (`components/dashboard/settings-view.tsx`, `actions/ai-observability-actions.ts`)
  - Added history dialogs (system prompts, system variables, workspace variables) with rollback actions. (`components/dashboard/settings-view.tsx`)
  - Added one-click "Set as system default" buttons to promote a workspace override into system defaults. (`components/dashboard/settings-view.tsx`)
- Commands run:
  - `npm run build` — pass (covered in 129d)
- Blockers:
  - None
- Next concrete steps:
  - Complete Phase 129 test coverage and quality gates; write the phase review doc.
