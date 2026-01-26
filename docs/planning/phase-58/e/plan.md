# Phase 58e — Hardening: Remaining Injection Points + Branded-Domain Canonicalization

## Focus
Close the gaps surfaced in the Phase 58 RED TEAM:
1) ensure manual compose “Insert calendar link” sends the *public* booking link, and
2) ensure AI draft post-processing can canonicalize branded/custom-domain booking links (not just provider URLs).

## Inputs
- Phase 58a: `CalendarLink.publicUrl` exists in `prisma/schema.prisma`
- Phase 58b: `lib/meeting-booking-provider.ts:getBookingLink()` prefers `publicUrl` with fallback
- Phase 58c: UI/server actions can read/write `publicUrl`
- Manual insertion path:
  - `actions/settings-actions.ts:getCalendarLinkForLead()`
  - `components/dashboard/action-station.tsx:handleInsertCalendarLink()`
- AI draft canonicalization:
  - `lib/ai-drafts/step3-verifier.ts:enforceCanonicalBookingLink()`
  - `lib/ai-drafts/__tests__/step3-verifier.test.ts`
  - `lib/ai-drafts.ts` (calls `enforceCanonicalBookingLink(draftContent, bookingLink)`)

## Work

### Step 1 — Fix Action Station “Insert calendar link” to use `publicUrl`

Update the server action `getCalendarLinkForLead()` to select and prefer `publicUrl`:
- When selecting `preferredCalendarLink` and default `calendarLinks`, include `publicUrl` in the Prisma `select`.
- Compute a single “public booking link” value:
  - `publicBookingLink = trim(publicUrl) || trim(url) || null`
- Return the public booking link to the UI (keep the existing response shape so the UI change is minimal).

**RED TEAM validation:**
- With `publicUrl = NULL`, insertion inserts `url` (existing behavior).
- With `publicUrl` set to a branded domain, insertion inserts the branded link.
- If the lead has a preferred calendar link, insertion uses that link’s `publicUrl || url`.

### Step 2 — Harden `enforceCanonicalBookingLink()` for branded/custom domains

Problem: current URL regexes are tuned for known provider URLs, so branded domains may not be canonicalized if the model mutates them.

Update `enforceCanonicalBookingLink(draft, canonicalBookingLink)`:
- If `canonicalBookingLink` is non-empty:
  - Parse it as a URL and extract the hostname.
  - Replace any `http(s)` URL in the draft that matches the canonical hostname with the canonical booking link.
  - Keep existing behavior for:
    - `[calendar link]` placeholders
    - `calendly.com` / `cal.com` URLs
    - `/widget/booking(s)/` URLs (GHL widget paths)
- If parsing the canonical link fails (invalid URL), fall back to existing behavior (do not throw).

**RED TEAM constraint:** avoid “replace any URL” logic; host-only replacement reduces risk of clobbering unrelated links.

### Step 3 — Add/extend unit tests

Extend `lib/ai-drafts/__tests__/step3-verifier.test.ts`:
- Branded-domain drift is replaced with canonical:
  - canonical = `https://book.company.com/meeting`
  - input contains `https://book.company.com/meeting-typo` → output contains canonical
- Non-matching URLs are not replaced (e.g., `https://docs.company.com/...` stays intact).

### Step 4 — Validation

- Targeted test run:
  - `node --import tsx --test lib/ai-drafts/__tests__/step3-verifier.test.ts`
- Manual smoke test:
  - In Action Station, click “Insert calendar link” and confirm the inserted URL respects `publicUrl` with fallback.

## Output
- Manual compose uses the public booking link (with fallback to `url`).
- AI draft step-3 canonicalization supports branded/custom domains safely.
- Unit tests cover the new canonicalization behavior.

## Handoff
Return to Phase 58d for full QA (lint/build) and documentation updates (CLAUDE/README as appropriate).

