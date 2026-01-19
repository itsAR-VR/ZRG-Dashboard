# Phase 39c — Persona Manager UI

## Focus

Replace the single-persona form in the AI Personality settings tab with a multi-persona manager interface. Users can view, create, edit, delete, and set default personas.

## Inputs

- Persona CRUD actions from subphase 39b
- Current AI Personality tab structure in `settings-view.tsx`
- Existing UI patterns from `booking-process-manager.tsx` (card-based list, modals)

## Work

### 1. Create `components/dashboard/settings/ai-persona-manager.tsx`

Component structure:
```
AiPersonaManager
├── Header (title, description, "Create Persona" button)
├── PersonaList
│   └── PersonaCard (for each persona)
│       ├── Name + Default badge
│       ├── Persona name (AI display name)
│       ├── Tone badge
│       ├── Actions: Edit | Set Default | Delete
└── PersonaFormDialog (create/edit modal)
    ├── Name (required, unique per workspace)
    ├── AI Display Name (personaName)
    ├── Tone (select: friendly-professional, casual, formal, etc.)
    ├── Email Greeting
    ├── SMS Greeting
    ├── Email Signature (textarea)
    ├── AI Goals & Strategy (textarea)
    ├── Service Description (textarea)
    ├── Ideal Customer Profile (textarea)
    └── Save / Cancel buttons
```

### 2. UI Behavior

#### Persona List
- Show all personas as cards (similar to booking process templates)
- Default persona has a "Default" badge
- Cards show: name, personaName, tone
- Hover/focus shows action buttons

#### Create Persona
- Opens modal dialog with form
- Name is required (validated for uniqueness on save)
- Tone defaults to "friendly-professional"
- Other fields optional
- On save: call `createAiPersona`, refresh list, show toast

#### Edit Persona
- Opens modal dialog pre-filled with persona data
- Same form as create
- On save: call `updateAiPersona`, refresh list, show toast

#### Delete Persona
- Confirmation dialog: "This will remove persona 'X'. Campaigns using this persona will fall back to the default."
- If deleting default: "This is the default persona. Another persona will become the default."
- On confirm: call `deleteAiPersona`, refresh list, show toast

#### Set as Default
- Click "Set as Default" on non-default persona
- Call `setDefaultAiPersona`, refresh list, show toast
- Only one persona can be default at a time

### 3. Empty State

If no personas exist:
- Show message: "No personas yet. Create your first persona to customize how the AI communicates."
- Show prominent "Create First Persona" button
- Behind the scenes: `getOrCreateDefaultPersonaFromSettings` could auto-create a default persona from existing WorkspaceSettings values

### 4. Migration/Import Helper (Optional)

If workspace has WorkspaceSettings persona fields but no AiPersona rows:
- Show info banner: "Your existing AI personality settings can be converted to a persona."
- Button: "Create Persona from Current Settings"
- Calls `getOrCreateDefaultPersonaFromSettings`, then refreshes list

### 5. Update `settings-view.tsx`

- Replace current AI Personality tab content with `<AiPersonaManager />`
- Pass `activeWorkspace` prop
- Remove the old single-persona form state and handlers (aiPersona, setAiPersona)
- Note: `qualificationQuestions` and `companyContext` remain in settings (not per-persona)

### 6. Split Settings Tab (Optional Simplification)

Current AI tab has:
- AI Persona fields → Move to AiPersonaManager
- Service Description → Per-persona
- Ideal Customer Profile → Per-persona
- Qualification Questions → Keep in settings (shared)
- Company Name, Target Result → Keep in settings (shared)
- Draft Generation Model → Keep in settings (shared)
- Insights Chat settings → Keep in settings (or separate tab)

Decision: AI Personality tab becomes Persona Manager + Company/Qualification settings (two sections).

## Output

**Completed 2026-01-19:**

- Created `components/dashboard/settings/ai-persona-manager.tsx` (550+ lines):
  - **AiPersonaManager component** with card-based persona list
  - **Persona cards** show: name, display name, tone badge, default badge, campaign count
  - **Actions**: Edit, Duplicate, Set Default, Delete (with confirmation dialog)
  - **Create/Edit dialog** with all persona fields:
    - Basic: Persona name, AI display name, Tone selector
    - Communication: Email greeting, SMS greeting, Email signature
    - Strategy: AI Goals
    - Advanced (collapsible): Service Description, Ideal Customer Profile
  - **Migration banner** for workspaces with no personas: "Import from Current Settings" or "Create New"
  - **Empty state** with helpful message when no personas exist

- Updated `components/dashboard/settings-view.tsx`:
  - Added import for `AiPersonaManager`
  - Replaced single-persona form with `<AiPersonaManager activeWorkspace={activeWorkspace} />`
  - Moved remaining workspace-level settings (Qualification Questions, Knowledge Assets) into a separate "Workspace Settings" card
  - Kept Insights Chatbot and AI Observability sections unchanged

- `npm run lint` passes (warnings only)
- `npm run build` succeeds

## Handoff

Subphase 39d can now add persona assignment to the campaign assignment panel. The persona manager provides:
- UI for creating/managing personas
- `listAiPersonas` action returns persona summaries with `id`, `name`, `isDefault`, `personaName`, `tone`, `campaignCount`
- The campaign assignment panel can add a "AI Persona" column with a Select dropdown
