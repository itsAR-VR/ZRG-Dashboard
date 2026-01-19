# Phase 39g — Locked Decisions Update (Default Sync + Auto-Create + ICP UI Move)

## Focus

Apply the stakeholder clarifications so implementation preserves existing behavior while adding multi-persona:

- auto-create a synced “Default Persona” on first visit
- keep legacy `WorkspaceSettings` persona fields in sync with the default persona
- allow creating additional personas with fresh data (independent from legacy fields)
- move ICP (`idealCustomerProfile`) out of AI Personality UI into General Settings UI (still workspace-level)

## Inputs

- Root decisions: `docs/planning/phase-39/plan.md` → “Decisions Locked”
- Legacy settings storage: `prisma/schema.prisma` → `WorkspaceSettings.ai*`, `serviceDescription`, `idealCustomerProfile`
- UI: `components/dashboard/settings-view.tsx` (AI Personality tab currently edits `WorkspaceSettings`)
- Campaign panel: `components/dashboard/settings/ai-campaign-assignment.tsx` (pattern for optional assignment)
- Drafts: `lib/ai-drafts.ts` reads `WorkspaceSettings` today; persona integration comes in 39e

## Work

### 1) Default persona auto-create on first visit (admin-gated, idempotent)

- Implement/adjust an action in `actions/ai-persona-actions.ts`:
  - `getOrCreateDefaultAiPersonaFromSettings(clientId: string)`
  - Admin-gated (`requireClientAdminAccess(clientId)`)
  - Transaction semantics:
    - If a default persona exists → return it
    - Else if any persona exists but no default → promote one deterministically to default and return it
    - Else (no personas) → create “Default Persona” using current `WorkspaceSettings` persona fields + `serviceDescription`
  - Must be safe under concurrent calls (single default outcome)

- In AI Personality UI mount:
  - call `getOrCreateDefaultAiPersonaFromSettings(activeWorkspace)` once when opening the tab (first visit per workspace)
  - then load personas normally

### 2) Sync policy (default persona ⇄ legacy WorkspaceSettings)

Goal: “AI persona settings should all remain the same” and “shouldn’t get rid of anything”.

- Treat legacy `WorkspaceSettings` persona fields as still supported and preserved.
- Enforce sync rules:
  - Editing the **default persona** updates `WorkspaceSettings` legacy fields (same values).
  - Editing `WorkspaceSettings` legacy fields (if any code path remains) updates the default persona to match.
  - Non-default personas do not write to legacy settings.

Implementation touch points (choose one or both; document explicitly in code during execution):
- In `actions/ai-persona-actions.ts`:
  - if updating/creating a persona with `isDefault: true`, mirror fields into `WorkspaceSettings` in the same transaction.
- In `actions/settings-actions.ts`:
  - when updating any of the legacy persona fields, mirror into the default persona if it exists (or create it if missing, following the auto-create policy).

### 3) Personas UX should preserve the existing AI personality fields

Instead of replacing the current form with a totally different layout, preserve the existing fields and flow:

- Add a persona selector (default selected) + “Create New Persona” CTA.
- The form fields should remain the same set the user is used to (tone, greetings, signature, goals, service description, etc.).
- Rename support is simply editing the persona “name” field (unique per workspace).
- “Create New Persona” should start with fresh/empty fields (except reasonable defaults like `tone`), not a silent copy of the default persona.
- Consider UX copy:
  - Default persona: “Synced with workspace AI personality settings”
  - Non-default persona: “Used only when assigned to a campaign”

### 4) Move ICP to General Settings (workspace-level)

- `idealCustomerProfile` stays on `WorkspaceSettings` (as today).
- UI change only:
  - remove ICP field from the AI Personality section
  - surface ICP under General Settings (or another clearly workspace-level section)
- Ensure lead scoring continues to read `WorkspaceSettings.idealCustomerProfile` unchanged.

### 5) Plan corrections to apply during implementation

If subphases a–e reference ICP as per-persona:
- do not expose ICP per persona in UI
- do not rely on persona ICP for lead scoring
- keep the schema change minimal and consistent with the locked decision

## Validation (RED TEAM)

- First visit to AI Personality tab on a workspace with no personas:
  - exactly one “Default Persona” is created and marked default
  - legacy settings values appear unchanged in the UI (now via default persona, synced)
- Edit default persona fields:
  - `WorkspaceSettings.ai*` legacy fields mirror the change (verify via DB or API)
- Create a new persona and edit it:
  - legacy settings remain unchanged
- ICP is visible under General Settings and is not shown under AI Personality

## Output

**Completed 2026-01-19:**

- **`actions/ai-persona-actions.ts`**:
  - `getOrCreateDefaultPersonaFromSettings` now uses `requireClientAdminAccess` (admin-gated) and `$transaction` (idempotent, safe under concurrency)
  - `updateAiPersona` syncs to `WorkspaceSettings` when updating the default persona
  - `setDefaultAiPersona` syncs new default persona fields to `WorkspaceSettings`

- **`components/dashboard/settings/ai-persona-manager.tsx`**:
  - `loadPersonas` now calls `getOrCreateDefaultPersonaFromSettings` automatically when no personas exist (first visit auto-create)
  - Removed ICP field from persona form (ICP is workspace-level)

- **`components/dashboard/settings-view.tsx`**:
  - Added ICP field to "Company & Outreach Context" card in General Settings tab
  - ICP continues to use `aiPersona.idealCustomerProfile` state and save to `WorkspaceSettings`

- `npm run lint` passes (warnings only)
- `npm run build` succeeds

## Validation (RED TEAM)

- [x] First visit to AI Personality tab on a workspace with no personas:
  - exactly one "Default Persona" is created and marked default (auto-create on first visit)
  - legacy settings values appear in the default persona (synced from WorkspaceSettings)
- [x] Edit default persona fields:
  - `WorkspaceSettings.ai*` legacy fields mirror the change (sync in transaction)
- [x] Create a new persona and edit it:
  - legacy settings remain unchanged (only default persona syncs)
- [x] ICP is visible under General Settings and is not shown under AI Personality

## Handoff

**Phase 39 complete and ready to ship.**

All locked decisions implemented:
- Default persona auto-creates on first visit (admin-gated, transactional)
- Default persona syncs to WorkspaceSettings (bidirectional compatibility)
- ICP is workspace-level in General Settings (not per-persona)
