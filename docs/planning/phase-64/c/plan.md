# Phase 64c — AI Drafts Integration: Enforce Canonical Outbound Link + Prevent Stale Links

## Focus
Ensure AI-generated drafts:

- always include the correct client-scoped outbound booking link (Link A) when configured, and
- never contain stale/hallucinated booking links when Link A is missing.

## Inputs
- Phase 64b outbound booking link semantics (`resolveBookingLink()`; Link A + null behavior)
- `lib/ai-drafts.ts` Step 3 flow:
  - `runEmailDraftVerificationStep3(...)`
  - `enforceCanonicalBookingLink(...)`
- `lib/ai-drafts/step3-verifier.ts` canonicalization rules

## Work
1. In `lib/ai-drafts.ts`:
   - keep using `resolveBookingLink(lead.clientId, settings)` for outbound booking link
   - treat `bookingLink === null` as a first-class state:
     - pass `bookingLink=null` into Step 3 verifier so it can remove/avoid booking links
     - add a deterministic post-pass that strips known booking-link URLs (Calendly / GHL / HubSpot patterns) if `bookingLink` is null
   - confirm whether booking-link canonicalization is only applied for `channel === "email"` today; if other channels can contain booking links (SMS/LinkedIn), decide whether to apply the same enforcement there too.
2. Ensure enforcement is strong enough for the reported failure mode:
   - If Phase 64a indicates pattern mismatch (stale link not replaced), extend `enforceCanonicalBookingLink()` to cover the stale-link format observed (without clobbering unrelated URLs).
   - For Calendly branded/public overrides, confirm `hasPublicOverride` drives the intended behavior:
     - If `hasPublicOverride=true`, we may replace more aggressively (e.g., replace-all-URLs mode) so raw `calendly.com` links cannot leak.
3. Align booking process instructions:
   - confirm `lib/booking-process-instructions.ts` inserts the same outbound booking link via `getBookingLink()`
   - if Phase 64b decided to keep scope tight (AI drafts + booking process instructions only), ensure other call sites (`lib/followup-engine.ts`, `lib/lead-scheduler-link.ts`) are either updated or intentionally left unchanged with a clear rationale.

## Output
- AI drafts always show Link A when configured
- AI drafts contain no booking link when Link A is missing (no stale/hallucinated links)
- Canonical enforcement updated to cover the observed stale-link pattern (if needed)

## Handoff
Phase 64d investigates the “old membership fee” / pricing-context drift (persona/knowledge) if still required.
