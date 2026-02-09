# Phase 125b — Draft Refresh Hardening + Non-PII Logging

## Focus
Keep the server action and user-facing behavior stable while adding safe debug logging for refresh failures and ensuring error mapping remains correct after the Phase 125a contract change.

## Inputs
- Root phase plan: `docs/planning/phase-125/plan.md`
- Phase 125a output: updated `lib/availability-refresh-ai.ts`
- Current orchestration:
  - `actions/message-actions.ts:refreshDraftAvailability(...)`
  - `lib/draft-availability-refresh.ts:refreshDraftAvailabilityCore(...)`

## Work
1. **Add structured, non-PII failure logging** in `lib/draft-availability-refresh.ts`:
   - Log only identifiers and meta (example fields):
     - `clientId`, `leadId`, `draftId`
     - `requestedAvailabilitySource`, `resolvedAvailabilitySource`
     - `candidateCount`
     - `errorCode` (the internal error string, but never draft content)
   - Do NOT log: draft text, slot labels, email addresses, phone numbers.
   - Use format: `console.warn("[availability_refresh]", { clientId, leadId, draftId, errorCode, candidateCount })`.

2. **Confirm user-facing error mapping** (`mapRefreshError()` at line 27-38):
   - `validation_failed:*` continues to map to: "Could not safely refresh availability. Please regenerate the draft."
     - This includes the new codes: `old_text_empty`, `old_text_not_found`, `old_text_ambiguous` (RED TEAM GAP-4).
   - `no_time_offers` remains: "No time options found..."
   - `max_passes_exceeded` remains: "Refresh took too long. Please regenerate the draft."
   - Default fallback remains: "Failed to refresh availability. Please try again."
   - **No changes needed to `mapRefreshError()`** — the `startsWith("validation_failed:")` check catches all new codes.

3. **Confirm server action return shape** is unchanged for `components/dashboard/action-station.tsx`:
   - `RefreshDraftAvailabilityResult`: `{ success, content?, draftId?, oldSlots?, newSlots?, error? }` — no changes.
   - Action-station reads: `result.success`, `result.content`, `result.newSlots`, `result.oldSlots` (line 713-716).

4. **Acknowledge `refreshDraftAvailabilitySystem()` consumer** (RED TEAM GAP-7):
   - This system-level wrapper (line 162) delegates to `refreshDraftAvailabilityCore()` and returns the same `RefreshDraftAvailabilityResult` type.
   - Confirm it continues to work after Phase 125a changes (no return shape change).

## Validation
- `npx tsc --noEmit` passes.
- Trigger a refresh on a draft with no time offers → confirm log output includes `{ clientId, leadId, draftId, errorCode: "no_time_offers", candidateCount }` and does NOT include draft text or slot labels.
- `mapRefreshError("validation_failed:old_text_ambiguous")` → "Could not safely refresh availability. Please regenerate the draft."

## Output
- `lib/draft-availability-refresh.ts` includes safe debug logging for failures and stable error mapping behavior.

## Handoff
- Phase 125c will add tests for the new validation/apply logic and run `npm test`, `npm run lint`, and `npm run build`, plus manual Jam repro verification.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added non-PII logging for refresh failures in `lib/draft-availability-refresh.ts` including ids, availabilitySource, candidateCount, and the internal error code (no draft content, no slot labels).
- Commands run:
  - `npm test` — pass
  - `npm run lint` — pass (warnings only, pre-existing)
  - `npm run build` — pass
- Blockers:
  - None
- Next concrete steps:
  - Phase 125c verification is already complete in this Terminus run; see `docs/planning/phase-125/c/plan.md`.
