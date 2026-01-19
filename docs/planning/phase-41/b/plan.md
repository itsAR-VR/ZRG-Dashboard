# Phase 41b — Fix EmailBison Campaign Sync (Auth, Request Shape, Error Mapping)

## Focus
Make EmailBison campaign sync succeed when credentials are correct, and fail loudly/clearly when they are not.

## Inputs
- Diagnostics and repro notes from Phase 41a
- `lib/emailbison-api.ts` (`fetchEmailBisonCampaigns`)
- `actions/email-campaign-actions.ts` (`syncEmailCampaignsFromEmailBison`)

## Work
- Verify EmailBison campaign listing call:
  - base URL, endpoint path, required headers, expected response shape
  - any required workspace scoping (if applicable)
- Ensure `401` and `403` are mapped to explicit, user-actionable errors.
- Ensure `syncEmailCampaignsFromEmailBison` upserts all returned campaigns and revalidates the relevant paths so UI updates immediately.
- Validate that SmartLead/Instantly paths still behave correctly (no unintended changes).

## Output
- Improved EmailBison campaign sync robustness:
  - `lib/emailbison-api.ts`: campaign list parsing now supports multiple response shapes (`[]`, `{ campaigns }`, `{ data }`, `{ data: { campaigns } }`, `{ results }`), de-dupes by id, and drops entries with missing ids to avoid bad upserts.
  - `lib/emailbison-api.ts`: non-JSON “success” responses now return a clear error and include a truncated response preview in logs (no secrets).
  - `actions/email-campaign-actions.ts`: campaign sync now revalidates `"/"` and `"/settings"` so campaign-driven UI updates without hard refresh (EmailBison + SmartLead + Instantly).
- Auth failures now consistently return actionable messaging with explicit `401/403` status codes (implemented in Phase 41a; validated here against the EmailBison sync path).

## Handoff
Proceed to Phase 41c to ensure the Booking/campaign views actively refresh after a sync (and present a clear “Sync Email / fix credentials” CTA when campaigns are missing due to auth failures).
