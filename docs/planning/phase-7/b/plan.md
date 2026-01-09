# Phase 7b — Implement GHL Email→Contact Match + Lead Hydration Rules

## Focus
Add a best-effort GHL enrichment pass to hydrate missing lead fields (especially phone) by searching GHL contacts by email and/or fetching the linked contact.

## Inputs
- GHL API endpoints:
  - `POST /contacts/search` (email match)
  - `GET /contacts/{contactId}` (authoritative contact fields)
- Existing utilities:
  - `lib/ghl-contacts.ts` (`ensureGhlContactIdForLead`)
  - `lib/ghl-api.ts` (`searchGHLContactsAdvanced`, `getGHLContact`)
  - `lib/phone-utils.ts` (`toStoredPhone`)

## Work
1. Define hydration rules (fill only missing fields; never overwrite user-entered values):
   - `Lead.phone` from `contact.phone` (normalize with `toStoredPhone`)
   - `Lead.firstName/lastName` from `contact.firstName/lastName`
   - Optional: `Lead.companyName` from `contact.companyName`
2. Decide how to mark enrichment:
   - When phone is hydrated from GHL, update `Lead.enrichmentStatus/enrichmentSource/enrichedAt` (PII-safe logging).
3. Implement hydration in the safest shared location(s) (e.g., inside `ensureGhlContactIdForLead` and/or a small helper called by sync/webhooks).
4. Add defensive behavior:
   - Fail open (don’t break webhook/sync if GHL contact lookup fails)
   - Avoid GHL “upsert after search” behavior if it risks creating duplicates (only patch by `contactId`)

## Output
- A deterministic, best-effort GHL hydration pass that can be reused by webhook ingestion, manual sync, and follow-up automation.

## Handoff
Wire the hydration into SMS sync + UI refresh behavior in Phase 7c.

