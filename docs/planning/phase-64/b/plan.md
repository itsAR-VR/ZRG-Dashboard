# Phase 64b — Outbound Booking Link Resolution: Link A Semantics + Null Handling

## Focus
Lock the correct outbound booking link behavior at the **client level**:

- **Calendly outbound (“send link”)** must use the **branded/public override link** (client-scoped), and it should still map to the **Link A** booking target (with qualification questions).
- **Non-Calendly outbound** must use `CalendarLink.publicUrl` when set, otherwise fall back to `CalendarLink.url`.
- If the outbound booking link is missing/unset, downstream generators must treat it as **no booking link configured** (and should not allow stale links to slip through).

## Inputs
- Phase 64a root-cause classification (A/B/C/D)
- Existing resolver: `lib/meeting-booking-provider.ts:resolveBookingLink()`
- Outbound injection call sites:
  - `lib/ai-drafts.ts` (Step 3 verifier + canonical booking link enforcement)
  - `lib/booking-process-instructions.ts` (`getBookingProcessInstructions()` uses `getBookingLink()`)
  - Optional: `lib/followup-engine.ts`, `lib/lead-scheduler-link.ts`

## Work
1. Update `lib/meeting-booking-provider.ts:resolveBookingLink()` to support branded/public overrides for Calendly outbound:
   - For `meetingBookingProvider === "CALENDLY"`:
     - fetch the workspace default `CalendarLink` (`clientId + isDefault`)
     - return `CalendarLink.publicUrl` when set (trimmed) as the outbound send link
       - if no default `CalendarLink` exists, treat `publicUrl` as unset and proceed to fallback
     - otherwise fall back to `WorkspaceSettings.calendlyEventTypeLink` (trimmed)
     - set `hasPublicOverride=true` iff `CalendarLink.publicUrl` is used (drives canonicalization)
   - Else: keep existing behavior (`publicUrl || url || null` with `hasPublicOverride`)
   - **Important:** Do not repurpose `WorkspaceSettings.calendlyEventTypeLink` to store the branded URL, because direct booking and mismatch tooling resolve Calendly event type IDs from that link when `calendlyEventTypeUri` is missing.
2. Define explicit behavior when `bookingLink === null`:
   - downstream should treat as “no booking link configured”
   - Phase 64c will enforce “no stale booking links” in AI drafts when null
3. Validate that `getBookingLink()` continues to return exactly the resolved outbound booking link.
   - Note: `getBookingLink()` is used by multiple outbound paths (`booking-process-instructions`, follow-ups, scheduler-link). Decide whether this phase intentionally updates all of them, or whether we should introduce a new dedicated outbound resolver and only switch AI drafts + booking process instructions.

## Output
- A clearly defined, client-scoped outbound booking link resolver (no campaign/lead override semantics for A/B).
- Explicit “null means no booking link configured” behavior documented for downstream consumers.

## Handoff
Phase 64c updates AI drafts + Step 3 enforcement to guarantee the outbound booking link in drafts is either:
- the resolved Link A (when configured), or
- absent (when not configured).
