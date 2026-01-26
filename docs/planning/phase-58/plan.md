# Phase 58 — Public Booking Link Override (Backend/Frontend Calendar Link Separation)

## Purpose
Separate the calendar link used for **fetching availability slots** (backend) from the calendar link **sent to leads in messages** (frontend/public), enabling scenarios like using a branded/shortened link for leads while still pulling availability from the original provider API.

## Context
Currently, `CalendarLink.url` serves a dual purpose:
1. **Backend**: Used by `lib/calendar-availability.ts` and `lib/availability-cache.ts` to fetch availability slots from Calendly/HubSpot/GHL APIs.
2. **Frontend**: Used by `getBookingLink()` in `lib/meeting-booking-provider.ts` to inject into AI drafts, follow-up sequences, and all outbound messaging to leads.

**Important note (repo reality):** not every user-facing “send a booking link” flow goes through `getBookingLink()` today:
- Manual compose “Insert calendar link” uses `actions/settings-actions.ts:getCalendarLinkForLead()` (currently returns `CalendarLink.url`) and inserts it into `components/dashboard/action-station.tsx`.
- AI draft post-processing uses `lib/ai-drafts/step3-verifier.ts:enforceCanonicalBookingLink()`, whose URL-matching is tuned for known provider URLs (Calendly/Cal.com/GHL widget). Custom branded domains may require additional canonicalization rules.

**The Problem**: Users need the ability to:
- Send leads a branded, shortened, or different booking page URL (e.g., `book.company.com/meeting`)
- While still using the original provider's API link to fetch availability slots (e.g., `calendly.com/company/30min`)

**Real-world scenarios**:
- A company uses a URL shortener or branded domain for their booking page
- A proxy service wraps the Calendly/GHL link for tracking
- The public-facing link differs from the API endpoint (common with enterprise calendar setups)
- White-label booking pages that redirect to the actual provider

**Key Insight**: The Calendly path already has partial precedent—`WorkspaceSettings.calendlyEventTypeLink` stores a "public" Calendly link used in `getBookingLink()`, while availability fetching can use different metadata. We're generalizing this pattern.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 56 | Active | Production rollout/monitoring | No direct file overlap; independent |
| Phase 57 | Complete | Appointment reconciliation | No overlap; focuses on GHL reconcile, not calendar links |
| Phase 52 | Complete | Booking + settings UI | Calendar Links UI lives in `components/dashboard/settings-view.tsx`; coordinate carefully with existing settings UI changes |
| Phase 50 | Complete | Inbox compose UI | Calendar link insertion lives in `components/dashboard/action-station.tsx`; avoid regressing compose/editor behavior |

## Multi-Agent / Repo Reality Check

- Last 10 phases by mtime: `phase-58, 57, 56, 52, 54, 55, 53, 51, 50, 49`
- Working tree is currently dirty (uncommitted changes). Before implementing Phase 58, do a pre-flight check:
  - `git status --porcelain` (confirm no unexpected edits to files you’ll touch)
  - Re-read the current versions of `prisma/schema.prisma`, `actions/settings-actions.ts`, `components/dashboard/settings-view.tsx`, `components/dashboard/action-station.tsx`, `lib/meeting-booking-provider.ts`, `lib/ai-drafts/step3-verifier.ts`.

## Repo Reality Check (RED TEAM)

- What exists today:
  - Calendar link management (UI): `components/dashboard/settings-view.tsx` (“Calendar Links” card)
  - Calendar link management (server actions): `actions/settings-actions.ts` (`getCalendarLinks`, `addCalendarLink`, `deleteCalendarLink`, `setDefaultCalendarLink`)
    - Note: there is **no** “edit calendar link” server action today; only add/delete/default.
  - Booking link resolution for outbound templates/drafts: `lib/meeting-booking-provider.ts:getBookingLink()`
    - `CALENDLY` → `WorkspaceSettings.calendlyEventTypeLink`
    - otherwise → workspace default `CalendarLink.url`
  - Availability fetching/caching uses `CalendarLink.url` (and must remain so): `lib/calendar-availability.ts`, `lib/availability-cache.ts`
  - Manual compose link insertion: `actions/settings-actions.ts:getCalendarLinkForLead()` + `components/dashboard/action-station.tsx:handleInsertCalendarLink()`
  - AI draft “booking link canonicalization”: `lib/ai-drafts/step3-verifier.ts:enforceCanonicalBookingLink()`
- What this plan assumes:
  - `CalendarLink.publicUrl` is optional and used only for outbound/public links; `CalendarLink.url` remains the availability source-of-truth.
  - Empty/whitespace-only `publicUrl` is treated as “unset” (persist as `null`, and fall back to `url` at read time).
- Verified touch points:
  - `prisma/schema.prisma:model CalendarLink` (starts around line 1166)
  - `lib/meeting-booking-provider.ts:getBookingLink` (currently selects `{ url: true }`)
  - Outbound injection call sites: `lib/booking-process-instructions.ts`, `lib/followup-engine.ts`, `lib/ai-drafts.ts`, `lib/lead-scheduler-link.ts`, `components/dashboard/action-station.tsx`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Wrong link still sent from manual compose:** Action Station “Insert calendar link” will keep inserting `CalendarLink.url` unless updated → leads still receive the backend/provider URL.
- **AI drafts can mutate branded domains:** `enforceCanonicalBookingLink()` may not recognize custom branded domains, so step-3 post-processing may fail to re-canonicalize the link if the model mutates it.
- **UI may be “write-only”:** without an edit action/UI, existing workspaces cannot easily set/clear `publicUrl` without delete/recreate.

### Repo mismatches (fix the plan)
- Phase 58c references `actions/calendar-link-actions.ts` and `components/dashboard/settings/calendar-*` as likely locations → **actual locations** are `actions/settings-actions.ts` and `components/dashboard/settings-view.tsx`.

### Testing / validation gaps
- No explicit unit coverage planned for:
  - `getBookingLink()` preference ordering (`publicUrl` → `url`)
  - branded-domain canonicalization in `enforceCanonicalBookingLink()`

### Security / permissions
- Ensure all writes remain behind `requireClientAccess(clientId)` and validate `publicUrl` (only accept absolute `http(s)` URLs; store `null` for empty).

## Objectives
* [ ] Enumerate all outbound booking-link injection points and ensure they use the *public* booking link resolution (including Action Station “Insert calendar link”)
* [ ] Add a `publicUrl` field to `CalendarLink` model (nullable, defaults to `url` when not set)
* [ ] Update `getBookingLink()` to prefer `publicUrl` over `url` when configured
* [ ] Update the CalendarLink UI to support editing the public booking link separately
* [ ] Harden AI draft booking-link canonicalization for branded/custom domains (so the link can’t drift)
* [ ] Add migration path for existing data (no breaking changes)

## Constraints
- **Backwards compatible**: If `publicUrl` is null/empty, fall back to `url` (existing behavior)
- **No change to availability fetching**: `lib/calendar-availability.ts` and `lib/availability-cache.ts` continue using `CalendarLink.url` exclusively
- **Settings UI parity**: Keep Calendly's `calendlyEventTypeLink` behavior consistent with GHL/HubSpot `CalendarLink` behavior
- **Minimal schema changes**: Single new field addition, no model restructuring
- **Public URL validation**: `publicUrl` must be an absolute `http(s)` URL (allow branded/shortened domains); store `null` when unset

## Success Criteria
- [ ] `CalendarLink.publicUrl` field exists and is optional
- [ ] `getBookingLink()` returns `publicUrl` when set, otherwise falls back to `url`
- [ ] AI drafts and follow-up messages use the correct (possibly overridden) booking link
- [ ] Manual Action Station “Insert calendar link” inserts the public booking link (with fallback)
- [ ] Settings UI allows editing the public booking link separately from the availability URL
- [ ] Existing workspaces with no `publicUrl` continue working exactly as before (no migration required)
- [ ] Step-3 verifier canonicalizes branded/custom-domain booking links (no drift)
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] `npm test` passes (or at minimum, add/execute targeted unit coverage for the changed helpers)
- [ ] `npm run db:push` succeeds

## Subphase Index
* a — Schema update: Add `publicUrl` field to `CalendarLink`
* b — Core logic: Update `getBookingLink()` to use `publicUrl` with fallback
* c — UI update: Add public booking link field to Calendar Link settings
* d — Testing + documentation: Verify all injection points and document the feature
* e — Hardening: Fix remaining injection points + branded-domain canonicalization (with unit tests)

## Open Questions (Need Human Input)

- [ ] Should we support a branded “public link override” for Calendly workspaces too (separate from `calendlyEventTypeLink`)? (confidence ~70%)
  - Why it matters: `calendlyEventTypeLink` may need to remain a canonical Calendly URL for UUID/mismatch tooling; a separate public link would keep tooling stable while allowing branded links.
  - Current assumption in this plan: Calendly behavior stays unchanged in Phase 58; non-Calendly providers use `CalendarLink.publicUrl`.
- [ ] Do we want a full “edit calendar link” UI (recommended) or is delete/recreate acceptable? (confidence ~75%)
  - Why it matters: determines whether we add a new server action (update) + inline edit controls in `settings-view.tsx`.
  - Current assumption in this plan: add edit support so existing workspaces can set/clear `publicUrl` without destructive changes.
- [ ] For AI draft canonicalization, should we only canonicalize URLs matching the canonical host (safe) or try to replace any “likely booking link” URL (riskier)? (confidence ~80%)
  - Why it matters: broader matching could clobber unrelated URLs in drafts; host-only matching may miss some drift cases.
  - Current assumption in this plan: canonicalize known provider patterns + canonical-host matches.

## Assumptions (Agent)

- `publicUrl` is intended for **outbound/public** messages only and may be any branded/shortened absolute `http(s)` URL (confidence ~90%).
  - Mitigation check: confirm UX copy emphasizes `url` is used for availability and should remain a provider URL.
