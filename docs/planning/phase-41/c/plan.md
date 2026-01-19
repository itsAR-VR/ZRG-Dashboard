# Phase 41c — Fix Booking/Campaign UI Refresh + Empty-State Handling

## Focus
Make the campaign-driven UI reflect the latest sync results and avoid confusing “missing campaigns” states when sync is blocked.

## Inputs
- Phase 41b implementation notes
- Campaign-driven UI surfaces (e.g. campaign assignment and Booking-related views)

## Work
- Ensure the UI path(s) that depend on email campaigns:
  - refresh after a successful sync (client-side re-fetch + `revalidatePath` coverage)
  - show an explicit CTA when campaigns are empty due to a sync/auth problem (“Go to Integrations → update API key → Sync Email”)
- Confirm that campaign queries respect the correct workspace scope (`resolveClientScope`) and do not unintentionally filter out campaigns.

## Output
- Improved “missing campaigns” UX in campaign-driven views:
  - `components/dashboard/settings/booking-process-analytics.tsx`: empty state now explicitly calls out the “Sync Email” action (Settings → Integrations) when expected campaigns/metrics aren’t present.
  - `components/dashboard/reactivations-view.tsx`: create/edit dialogs now show a clear hint under the campaign selector when no email campaigns are available, pointing users to Settings → Integrations → “Sync Email”.
- Verified scoping: `actions/email-campaign-actions.ts:getEmailCampaigns()` uses `resolveClientScope` so campaign lists are restricted to the selected workspace (or all accessible workspaces when no workspace is provided).

## Handoff
Proceed to Phase 41d to add regression coverage and a short verification runbook matching the Jam repro steps.
