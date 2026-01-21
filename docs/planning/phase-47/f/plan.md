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

- Updated “Backend Prompts” dialog with:
  - message-level editing (existing Phase 47d behavior)
  - nested snippet editor (forbidden terms MVP)
  - effective preview rendering

## Handoff

Back to root Phase 47 verification:
- `npm run lint`
- `npm run build`
- Manual smoke test:
  - edit forbidden terms snippet → generate an email draft → confirm the new forbidden terms are reflected in runtime prompt behavior

