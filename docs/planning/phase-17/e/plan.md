# Phase 17e — Secondary Issues Triage (EmailBison, Calendars, Enrichment)

## Focus
Reduce operator-impacting errors found alongside the SMS sync issue.

## Inputs
- Vercel log excerpts:
  - EmailBison 422 invalid `sender_email_id`
  - Availability refresh error for unsupported calendar URL (e.g., `link.deal-studio.com/...`)

## Work
1. EmailBison invalid sender ID:
   - Validate `lead.senderAccountId` is numeric.
   - If the configured sender is invalid/unsendable, refresh sender snapshots and pick a sendable fallback, update the lead, and retry once.
2. Unsupported calendar URL messaging:
   - Improve the persisted `WorkspaceAvailabilityCache.lastError` message to tell users what link types are supported.

## Output
- Email sender fallback + retry-on-invalid-sender:
  - `actions/email-actions.ts` (both draft sends and manual replies)
  - Uses `EmailBisonSenderEmailSnapshot` + `refreshSenderEmailSnapshotsDue()` to recover from stale sender IDs.
- More actionable calendar error messaging:
  - `lib/availability-cache.ts` now stores an error that lists supported providers (Calendly/HubSpot/GHL).

## Handoff
If SMS still lags post-deploy, create a follow-on phase focused on webhook coverage auditing + storing “last webhook received per workspace” diagnostics (requires schema/UI work).

