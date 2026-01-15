# Phase 23c — Update UI for branding and empty-state

## Focus
Ensure the dashboard UI works for a brand-new workspace with no connected accounts and shows white-label branding where appropriate.

## Inputs
- Workspace list/action(s) in `actions/`
- Sidebar and settings UI in `components/dashboard/*`

## Work
- Update workspace list types/fields to include branding and integration-connected booleans.
- Display workspace branding in the sidebar header (fallback to default if missing).
- Add an empty-state CTA guiding users to connect integrations when the workspace has no connected accounts.
- Ensure integrations UI supports initially-empty GHL fields and does not expose existing keys.

## Output
- Workspace list now includes branding + connection health:
  - `actions/client-actions.ts` selects `settings.brandName/brandLogoUrl` and returns:
    - `hasGhlLocationId`, `hasGhlPrivateKey`, `hasGhlIntegration`
    - `hasConnectedAccounts` (true if any integration is configured)
- Sidebar branding:
  - `components/dashboard/sidebar.tsx` renders `brandName/brandLogoUrl` for the selected workspace (fallbacks to default ZRG branding)
  - Workspace search handles nullable `ghlLocationId`
- Empty workspace inbox UX:
  - `components/dashboard/inbox-view.tsx` shows “This workspace has no connected accounts yet…” plus a CTA linking to `/?view=settings&settingsTab=integrations`
  - `app/page.tsx` passes `workspaceHasConnectedAccounts` into `InboxView`
- Integrations UI supports empty workspaces:
  - `components/dashboard/settings/integrations-manager.tsx` supports nullable `ghlLocationId` and allows adding GHL credentials without ever displaying an existing private key

## Handoff
Proceed to Phase 23d to document curl usage, run validations, and push to GitHub.
