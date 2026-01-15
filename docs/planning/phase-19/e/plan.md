# Phase 19e — Settings UI + README Updates

## Focus
Expose provider selection + credentials safely in the UI, and document setup for all providers.

## Inputs
- Phase 19a/b backend interfaces and constraints

## Work
- Update the Integrations Manager UI:
  - Single-select provider dropdown (None/EmailBison/SmartLead/Instantly)
  - Provider-specific fields and webhook URLs
  - Campaign sync button routes to the active provider
  - Never render stored secrets; show “configured” state via booleans.
- Update `README.md` with:
  - Provider exclusivity rules
  - Webhook endpoints + auth conventions
  - Admin provisioning payload fields

## Output
- Updated Settings → Integrations Manager:
  - `components/dashboard/settings/integrations-manager.tsx` adds a single-select email provider dropdown and provider-specific credential fields (EmailBison/SmartLead/Instantly), using `has*` booleans (no secret leakage).
  - Email campaign sync button routes to the active provider’s sync action.
  - Webhook URL panel now lists EmailBison/SmartLead/Instantly endpoints.
- Updated docs:
  - `README.md` documents the single-select email provider model and setup for EmailBison, SmartLead, and Instantly (including webhook endpoints).

## Handoff
- Proceed to Phase 19f to run `npm run lint` / `npm run build`, fix any issues, and push the branch to GitHub.
