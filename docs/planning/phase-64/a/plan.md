# Phase 64a — Root Cause: Reproduce + Confirm Config Expectations

## Focus
Confirm why AI drafts can contain an outdated booking link, given the 2026-01-27 clarification that booking links are **client-scoped** (not campaign-scoped) and outbound messaging should always use **Link A** (Calendly with-questions link) represented as a branded/public override.

## Inputs
- Jam recording: `https://jam.dev/c/59c23d20-c308-48ec-ba07-722a5b0be62d`
- Client-level booking link configuration:
  - Calendly: `WorkspaceSettings.calendlyEventTypeLink` (Link A) + `calendlyDirectBookEventTypeLink` (Link B)
  - Non-Calendly: `CalendarLink.publicUrl` fallback (Phase 58)
- AI draft generation:
  - `lib/ai-drafts.ts` (persona resolution, availability, booking link enforcement)
  - `lib/ai-drafts/step3-verifier.ts` (`enforceCanonicalBookingLink`)
- Booking process instructions:
  - `lib/booking-process-instructions.ts` (`getBookingProcessInstructions()` uses `getBookingLink()`)

## Work
1. Identify a concrete failing lead/campaign/client from the Jam report (or a replicated lead).
2. Verify client settings:
   - `meetingBookingProvider`
   - Calendly Link A / Link B settings (trimmed, correct event type links)
   - Confirm the branded/public “send link” is set (expected: default `CalendarLink.publicUrl` for the client).
   - Default `CalendarLink` and `publicUrl` state (if non-Calendly)
3. Trace AI draft generation for that lead:
   - Confirm which persona source is used (`resolvePersona()` debug log already exists).
   - Confirm what `resolveBookingLink(clientId, settings)` returns for outbound link.
   - Confirm what `bookingLink` is passed into Step 3 verifier and `enforceCanonicalBookingLink()`.
   - Capture the **exact stale booking link shape** observed in the draft (domain + path pattern), since canonicalization is pattern-based.
4. Determine failure mode category (write down which one it is):
   - A) Link A is unset → model includes stale link; no enforcement happens
   - B) Link A is set but verifier/enforcer fails to replace the stale link (pattern mismatch)
   - C) Some other injection point overwrites the link post-verification
   - D) Expectation mismatch: branded/public “send link” exists, but Calendly resolver ignores it and returns the raw event-type link

## Output
- A short written root-cause classification (A/B/C/D) with the exact config state observed (no PII).
- A scoped “fix target” list for Phase 64b/64c (exact files/functions to adjust).

## Handoff
Proceed to Phase 64b to implement the correct outbound booking-link resolution semantics (client-scoped Link A + safe null behavior) based on the root-cause classification.
