# Phase 72h — Lead Matching Hardening (Promotion Safety)

## Focus

Ensure inbound provider webhooks continue attaching messages to the same Lead even after promoting an alternate contact to primary (i.e., when `Lead.email` changes).

This subphase is a **safety hardening** layer: without it, SmartLead/Instantly events that still key off the original campaign email can create a duplicate Lead after promotion.

## Inputs

- Phase 72a: `prisma/schema.prisma` adds `Lead.alternateEmails[]` (and other replier fields)
- `lib/lead-matching.ts` (`findOrCreateLead`)
- Provider webhooks:
  - `app/api/webhooks/smartlead/route.ts` (uses campaign lead email from webhook payload)
  - `app/api/webhooks/instantly/route.ts` (uses `payload.contact_email`)
  - `app/api/webhooks/email/route.ts` (can match by `emailBisonLeadId`)
- Workspace access helpers: `lib/workspace-access.ts`

## Work

### 1. Schema index for alternate email matching

Add a Postgres index suitable for array membership checks on `Lead.alternateEmails`.

- If keeping `alternateEmails String[]`, prefer a GIN index (Prisma supports `@@index(..., type: Gin)` for Postgres).
- Run `npm run db:push` after schema changes.

### 2. Update lead matching to include `alternateEmails`

In `lib/lead-matching.ts`, when an inbound email address is available:

- Normalize the inbound email.
- Match in this priority order (avoid a single “OR findFirst” if it makes priority ambiguous):
  1) External IDs (e.g., `emailBisonLeadId`, `ghlContactId`)
  2) `Lead.email` (case-insensitive exact)
  3) `Lead.alternateEmails` contains the normalized email (array membership)
  4) Phone matching (existing behavior)

Add explicit logging when a lead is matched via `alternateEmails` so production debugging is straightforward.

### 3. Promotion invariants + permissions (alignment check)

When implementing `promoteAlternateContactToPrimary`:

- Enforce workspace access at minimum via `requireLeadAccessById(leadId)` (or admin-only via `requireClientAdminAccess(clientId)` if that’s the chosen policy).
- Ensure invariants:
  - New primary email is normalized (lowercase, trimmed).
  - Old primary email is added to `alternateEmails` (if present and valid).
  - New primary email is removed from `alternateEmails`.
  - `alternateEmails` stays deduped and never includes the current primary.

### 4. Validation (RED TEAM)

- Manual regression:
  - Promote an alternate email to primary.
  - Trigger a SmartLead/Instantly inbound webhook event whose “lead email” is still the original campaign email.
  - Confirm the message attaches to the existing Lead (not a new one) and log indicates matching via `alternateEmails`.

## Output

- Updated `lib/lead-matching.ts` to use explicit priority matching and include `alternateEmails` membership checks.
- Added `matchedBy: "alternateEmail"` tracking and explicit logging when alternate email matching occurs.
- Matching priority is now deterministic (external IDs → email → alternateEmails → phone).

## Handoff

Phase 72 complete. Update the root plan with success criteria + summary, and note that `npm run db:push` still needs to be run for the schema/index changes.
