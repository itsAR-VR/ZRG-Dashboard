# Phase 47f — UI: Nested Snippet Editor + Effective Prompt Preview

## Focus

Extend the “Backend Prompts” dialog in Settings → AI Dashboard so admins can:
- edit prompt **message overrides** (Phase 47d)
- view/edit “tiny” prompt composition pieces (**snippets/variables**, Phase 47e), starting with email forbidden terms
- see an “effective” prompt preview where snippet placeholders (ex: `{forbiddenTerms}`) are expanded

## Inputs

- Existing prompt modal UI in `components/dashboard/settings-view.tsx` ("Backend Prompts")
- Prompt templates: `getAiPromptTemplates(activeWorkspace)` (note: `activeWorkspace` is a string clientId)
- Prompt override server actions (Phase 47c)
- Snippet override server actions (Phase 47e)
- Toast pattern: `toast.success(...)` / `toast.error(...)` (sonner)

## Work

1. **Fetch editor data when the modal opens:**
   - Load in parallel:
     - prompt templates
     - prompt overrides (message-level)
     - snippet overrides (variable/snippet-level)
   - Store overrides/snippets in maps keyed by:
     - message override: `${promptKey}:${role}:${index}`
     - snippet override: `${snippetKey}`

2. **Render each message with three layers (preview vs edit):**
   - Raw template content (from registry)
   - Message override (if any)
   - Effective preview: apply snippet replacement (ex: replace `{forbiddenTerms}` with effective forbidden terms value)

3. **Nested UX for snippet placeholders:**
   - Detect known snippet placeholders in message content (MVP: `{forbiddenTerms}`)
   - Under that message block, show an expandable “Snippets” section that:
     - displays the current value (default vs overridden)
     - allows editing (textarea or line-item editor)
     - supports Save + Reset to Default

4. **Guardrails:**
   - Keep lead-specific placeholders unexpanded (or use sample values) to avoid PII.
   - Show a warning banner for prompts used with strict JSON/Structured Outputs and validate required placeholders are still present before saving.

5. **User feedback + state hygiene:**
   - On save/reset success:
     - update the relevant map
     - show `toast.success(...)`
   - On failure:
     - show `toast.error(...)` with server error message
   - Ensure switching workspaces resets cached prompt data to avoid leaking overrides between workspaces.

## Validation (RED TEAM)

- Non-admin users can open the modal but cannot save overrides/snippets (server rejects).
- Effective preview expands snippet placeholders (forbidden terms) and shows “Modified” badges consistently.
- No lead data is shown; preview uses template placeholders or clearly labeled sample values only.

## Output

**Completed:**

1. **Added imports:**
   - `getPromptSnippetOverrides`, `savePromptSnippetOverride`, `resetPromptSnippetOverride`
   - `PromptSnippetOverrideRecord` type
   - `ChevronDown`, `ChevronRight` icons

2. **Added state variables:**
   - `snippetOverrides: Map<string, string>` — loaded from server
   - `expandedSnippets: Set<string>` — tracks which snippets are expanded
   - `editingSnippet: string | null` — which snippet is being edited
   - `snippetEditContent: string` — edit textarea content
   - `savingSnippet: boolean` — save in progress

3. **Updated data loading:**
   - Modal now loads prompt templates, message overrides, AND snippet overrides in parallel
   - Builds `snippetOverrides` map from server response

4. **Added nested snippet editor UI:**
   - Detects `{forbiddenTerms}` placeholder in message content
   - Shows expandable section with chevron toggle
   - Displays "Customized" badge if snippet has override
   - Collapsed: shows snippet key and badge
   - Expanded: shows current value (override or default preview)
   - Edit mode: textarea for editing, Save/Cancel buttons
   - Reset button to restore to default

5. **State cleanup on dialog close:**
   - Clears `editingSnippet`, `snippetEditContent`, `expandedSnippets`

**Verification:**
- `npm run lint` — passed
- `npm run build` — passed

**File modified:** `components/dashboard/settings-view.tsx`

## Handoff

Phase 47g will expand the editable variables system to include:
- Email length bounds (min/max characters)
- Email archetypes configuration

## Review Notes

- Evidence: `components/dashboard/settings-view.tsx` caches `aiPromptTemplates` and does not reset it on workspace change or modal close; the load effect short-circuits on `if (aiPromptTemplates) return`.
- Gap: the “avoid leaking overrides between workspaces” requirement is not met yet; see `docs/planning/phase-47/review.md`.
