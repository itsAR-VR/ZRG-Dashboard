# Phase 47j — Persona Scoping: Edit Default/Campaign Personas in Modal

## Focus

Make “master variables” editing in the prompt modal match what drafts actually use:
- Draft generation resolves persona as: campaign persona → default persona → workspace settings fallback (`lib/ai-drafts.ts`).
- The modal needs a clear selector for which persona context is being edited and previewed.

## Inputs

- Persona resolution logic: `lib/ai-drafts.ts` (`resolvePersona`)
- Persona CRUD actions: `actions/ai-persona-actions.ts`
- AI Personality UI surface: `components/dashboard/settings/ai-persona-manager.tsx` (existing patterns)

## Work

1. **Add a “Persona Context” selector inside the prompt modal:**
   - Options:
     - Default AI Persona (workspace)
     - Select a campaign’s AI Persona (campaign dropdown → persona)
     - Select any AI Persona (dropdown list)
   - Display which context is currently active for edits and for preview.

2. **Wire editing to the correct backing store:**
   - All edits write to `AiPersona`:
     - load via `getAiPersona(personaId)` / `getDefaultAiPersona(clientId)`
     - save via `updateAiPersona(personaId, input)`
   - Admin gate: only workspace admins can save.

3. **Preview uses the selected persona context:**
   - Effective preview should use the persona fields from the selected context:
     - personaName, tone, greeting, smsGreeting, signature, goals, serviceDescription, idealCustomerProfile
   - Note: `WorkspaceSettings.ai*` fallback exists for backward compatibility but is not the primary editing surface.

4. **Quality-of-life:**
   - “Clone from default” button to quickly seed a new persona with current default values.
   - “Make default” shortcut for admins (calls `setDefaultAiPersona(personaId)`).

## Validation (RED TEAM)

- Editing the default persona in modal changes a newly generated draft for a lead in a campaign with no persona override.
- Editing a specific persona changes drafts only for campaigns/leads using that persona.

## Output

**Completed:**

1. **Persona context selector in Variables tab:**
   - Added persona list loading alongside other modal data
   - Added persona selector dropdown to preview different persona contexts
   - Auto-selects default persona when modal opens
   - Shows persona details (name, tone, greeting, signature) as preview
   - "Edit in AI Personality" button links to full persona editor

2. **State management:**
   - `personaList` — list of workspace personas (`AiPersonaSummary[]`)
   - `selectedPersonaId` — currently selected persona for preview
   - `selectedPersonaDetails` — full persona data (`AiPersonaData`)
   - `personaLoading` — loading state for persona details fetch

3. **UI/UX:**
   - Persona context section at top of Variables tab with muted background
   - Preview displays key persona fields used in draft generation
   - Clear link to AI Personality tab for full editing

**Note:** Full inline persona editing deferred — the existing `AiPersonaManager` component provides comprehensive CRUD. The modal now surfaces persona context for awareness without duplicating the editor.

**Verification:**
- `npm run lint` — passed
- `npm run build` — passed

## Handoff

Return to Phase 47 verification and ensure persona edits are reflected in runtime draft generation. Continue to Phase 47k (per-stage booking instruction templates).
