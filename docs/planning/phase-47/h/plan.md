# Phase 47h — UI: Master Variables Editor + Expanded Nested UX

## Focus

Make the “Backend Prompts” dialog a complete editor for:
- prompt message overrides (system/assistant/user)
- master variables (AI persona fields injected into draft prompts) **inside the modal**
- all prompt-building snippets/variables (forbidden terms, length rules, booking templates, archetypes)

## Inputs

- Existing prompt modal: `components/dashboard/settings-view.tsx`
- Persona CRUD actions: `actions/ai-persona-actions.ts` (default + campaign personas)
- Prompt overrides actions (Phase 47c)
- Snippet/variable actions + registry (Phase 47e + 47g)
- Existing admin gate: `isWorkspaceAdmin` from `getWorkspaceAdminStatus(activeWorkspace)`

## Work

1. **Modal layout (avoid a “wall of text”):**
   - Convert modal body to a 2-column layout at `max-w-6xl`:
     - Left: navigation (Tabs or Accordion)
       - Prompts (templates list)
       - Variables (workspace + snippets)
     - Right: editor + preview for the selected item

2. **Variables section (master variables editable in modal):**
   - Add a “Master Variables (AI Persona)” panel that edits the persona used for draft injection:
     - default AI persona (workspace)
     - campaign-assigned AI persona (select campaign → persona)
   - Fields:
     - personaName, tone, greeting, smsGreeting, signature, goals
     - serviceDescription, idealCustomerProfile
   - Save plumbing:
     - load via `getAiPersona(...)` / `getDefaultAiPersona(...)`
     - save via `updateAiPersona(...)` (admin-gated)
     - optional shortcuts: “Set as default”, “Duplicate persona”
   - Note: legacy `WorkspaceSettings.ai*` is fallback-only; do not treat it as the primary “master variables” surface.

3. **Snippets section (nested UX driven by the variable registry):**
   - Render editors by snippet type:
     - `list`: line-item editor (add/remove/reorder) + raw textarea toggle
     - `number`: numeric input with validation
     - `template`: textarea with placeholder helper + “insert placeholder” buttons
     - `text`: textarea
   - Save/Reset actions:
     - Save → `savePromptSnippetOverride`
     - Reset → `resetPromptSnippetOverride`

4. **Prompts section (message overrides + variable linking):**
   - Keep the per-message editor (Phase 47d/f style).
   - Add a “Referenced Variables” block under each message that:
     - detects placeholders present in the message content
     - links to the corresponding variable editor
     - shows current value (default vs overridden)

5. **Effective preview (no PII):**
   - Preview should render:
     - base template message content
     - apply message override (if present)
     - expand placeholders using:
       - current selected AI persona master variables
       - current snippet/variable values
       - safe sample values for lead-specific placeholders (explicitly labeled as sample)
   - Add a small “Preview context” selector for non-PII scenario toggles:
     - channel: email/sms/linkedin
     - booking process stage: sample stage number (1/2/3) for previewing booking instruction templates

6. **Guardrails + UX safety:**
   - Warn on templates used for strict JSON outputs:
     - highlight required placeholders / required JSON keys
     - optionally block saving if required placeholders are removed (define the rule and document it)
   - Add “Reset All for Workspace” option (behind confirm) that clears:
     - prompt overrides for selected prompt
     - snippet overrides for the related snippet keys

7. **State hygiene:**
   - When `activeWorkspace` changes:
     - clear cached prompt templates + overrides/snippets
     - refetch on next modal open
   - Avoid leaking edits across workspaces.

## Validation (RED TEAM)

- Non-admin cannot save anything (server rejects; UI shows toast).
- Editing master variables in modal updates runtime draft generation immediately (same as editing in AI Personality today).
- Editing forbidden terms / length rules / booking templates updates effective preview and is reflected in a real draft generation path.
- No lead data is shown in the modal; preview uses placeholders/sample context only.

## Output

**Completed (MVP scope):**

1. **Modal tab navigation:**
   - Added "Prompts" and "Variables" tabs to the Backend Prompts dialog
   - Tab switching preserves state (editing state, loaded data)

2. **Variables tab (snippet registry editor):**
   - Renders all snippet registry entries with label, description, type
   - Shows "Customized" badge when workspace has an override
   - Edit mode: number input for `number` type, textarea for `list`/`text`/`template` types
   - Placeholder hints displayed for template types
   - Save/Cancel buttons with loading state
   - Reset button (only shown when override exists)
   - Admin-gated edit controls

3. **State management:**
   - `snippetRegistry` loaded on modal open via `getSnippetRegistry()`
   - `snippetOverrides` Map tracks current override values
   - Local state updates on save/reset for immediate UI feedback

**Deferred to follow-up phases:**

- 2-column layout (left nav, right editor) — current single-column works well for MVP
- Master Variables (AI Persona) editing inside modal — uses existing AiPersonaManager component on AI tab
- Effective preview with placeholder expansion — Phase 47i handles runtime alignment
- "Reset All for Workspace" option — can be added later

**Verification:**
- `npm run lint` — passed
- `npm run build` — passed

## Handoff

Phase 47i audits remaining AI call sites to ensure the editor reflects runtime behavior for all prompts shown in the modal.

## Review Notes

- Evidence: `actions/ai-observability-actions.ts:getSnippetRegistry` is hardcoded to 4 entries and uses truncated default values (not the canonical registry in `lib/ai/prompt-snippets.ts`).
- Impact: archetype instruction overrides exist at runtime, but there is no UI to view/edit them from the prompt modal.
