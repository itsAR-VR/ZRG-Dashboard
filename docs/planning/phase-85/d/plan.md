# Phase 85d — UI: Read-Only Settings Mode + Hide Prompt/Cost + Simplify Client Experience

## Focus
Make the client portal experience “safe by default”: clients can view their workspace and work the Inbox/CRM/drafting, but Settings are read-only and prompt/cost internals are not visible.

## Inputs
- Capabilities server action from Phase 85a
- Settings UI entrypoint: `components/dashboard/settings-view.tsx`

## Work
1. **Read capabilities**
   - Fetch workspace capabilities when `activeWorkspace` changes.
2. **Read-only Settings**
   - If `isClientPortalUser`:
     - Disable/hide all mutation controls (save/add/delete/reconnect/etc.)
     - Show a banner: “Settings are read-only. Request changes from ZRG.”
     - Ensure secret values remain masked (never show raw API keys).
3. **AI personality UI**
   - For client portal users: show AI personality summary (read-only), hide persona manager controls.
4. **Hide prompt/cost sections**
   - Do not render AI observability + prompt override sections for client portal users.
5. **Primary surfaces**
   - Confirm Inbox includes “All Responses” and “Requires Attention” filters and drafting UI.
   - Confirm CRM view remains accessible and scoped.

## Output
- `components/dashboard/settings-view.tsx` now loads workspace capabilities and derives `isClientPortalUser`.
- Added read-only banner + settings fieldsets to disable mutation controls for client portal users (save/add/delete/reconnect).
- AI Personality tab renders a read-only persona summary for client portal users and suppresses prompt/AI observability UI + fetches.
- Save button and prompt modal are hidden for client portal users; client portal user manager is hidden in Team tab.
- No Inbox/CRM UI changes required; existing filters/drafting remain intact.

## Coordination Notes
**Files modified:** `components/dashboard/settings-view.tsx`  
**Potential conflicts with:** Phase 86/88/81 (Settings UI edits)  
**Integration note:** Merge fieldset wrappers + read-only banner carefully if other phases adjust Settings tab structure.

## Handoff
Subphase 85f validates behavior end-to-end (manual QA + tests), including read-only banner, disabled controls, and hidden prompt/cost sections for client portal users.
