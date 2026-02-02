# Phase 87d — Hardening (Preserve User Edits + Slot De-Dupe + Tests)

## Focus
Harden “Refresh Availability” so it (1) does not clobber unsaved compose edits, (2) avoids re-offering the same slots / double-counting ledger, and (3) is covered by unit tests for parsing/replacement.

## Inputs
- Phase 87a outputs:
  - `lib/availability-slot-parser.ts` functions: `hasAvailabilitySection`, `extractAvailabilitySection`, `replaceAvailabilitySlotsInContent`
- Phase 87b output:
  - `refreshDraftAvailability` in `actions/message-actions.ts`
- Phase 87c output:
  - UI button + handler in `components/dashboard/action-station.tsx`
- Repo reference behavior to mirror:
  - `lib/ai-drafts.ts`: excludes already-offered slots (`excludeUtcIso`) and respects `lead.snoozedUntil` (`startAfterUtc`)
  - `lib/availability-distribution.ts`: `selectDistributedAvailabilitySlots({ excludeUtcIso, startAfterUtc, ... })`

## Work

### 1) Preserve compose edits (critical)
- Update `refreshDraftAvailability` to accept the UI’s current content:
  - Signature: `refreshDraftAvailability(draftId: string, currentContent: string)`
  - Behavior:
    - Parse/replace on the provided `currentContent` (do not refresh from stale DB content).
    - Always persist the updated content back to `AIDraft.content` on success (so refresh is durable across reloads).
- Update the UI handler to pass `composeMessage` into the action (so unsaved edits are preserved).

### 2) Slot selection must exclude existing offers + respect snooze
- Mirror the selection logic from `lib/ai-drafts.ts`:
  - Build `excludeUtcIso` from `lead.offeredSlots` (parse JSON; normalize datetimes to ISO).
  - Compute `startAfterUtc` from `lead.snoozedUntil` (only when snoozedUntil > now).
  - Compute `anchor = max(startAfterUtc, offeredAt)` and `rangeEnd = anchor + 30 days` for `getWorkspaceSlotOfferCountsForRange`.
  - Call `selectDistributedAvailabilitySlots({ excludeUtcIso, startAfterUtc, preferWithinDays: 5, now: offeredAt, ... })`.
- If selection returns no slots, return a “No new slots available” error and do not update draft/lead/ledger.

### 3) Parser hardening + clear behavior when ambiguous
- Ensure parser/replacement handles:
  - `\r\n` line endings (CRLF) as well as `\n`
  - Bullet indentation (leading whitespace before `-`)
  - Multiple availability sections:
    - Replace the first matched section only (default)
    - If multiple sections are detected, log a debug note (do not fail)
- Keep `lib/availability-slot-parser.ts` runtime-safe (no `server-only` import) so it can be used from UI if desired later.

### 4) Unit tests for slot parsing/replacement (RED TEAM)
- Add `lib/__tests__/availability-slot-parser.test.ts` covering:
  - SMS/LinkedIn header + bullets replacement with `Available times (use verbatim if proposing times):`
  - Email header + bullets replacement with `AVAILABLE TIMES (use verbatim if scheduling):`
  - CRLF content variants
  - No availability section → `extractAvailabilitySection()` returns `null`
  - Multiple sections → first section replaced only

## Output
- Updated behavior in:
  - `actions/message-actions.ts`: refresh action preserves compose edits and avoids re-offers
  - `components/dashboard/action-station.tsx`: handler passes `composeMessage` into refresh action
- Added tests:
  - `lib/__tests__/availability-slot-parser.test.ts`

## Validation (RED TEAM)
- Run `npm run test` (new parser tests pass)
- Run `npm run lint`
- Run `npm run build`
- Manual QA:
  - Edit draft prose (not availability), click Refresh Availability, confirm edits remain and only bullets change
  - Click Refresh twice; confirm it does not re-offer identical slots or inflate “refreshed” messaging when unchanged

## Handoff
Phase 87 complete after Validation passes.

## Output (Completed)
- Added `lib/__tests__/availability-slot-parser.test.ts` with SMS/Email, CRLF, no-section, and multi-section coverage.

## Validation Results
- `npm run test` ✅
- `npm run lint` ⚠️ warnings only (pre-existing; no new errors)
- `npm run build` ❌ fails due to unrelated type error in `lib/calendar-health-runner.ts` (`CalendarHealthWorkspaceResult.__links`)

## Handoff (Ready)
Phase 87 implementation is complete; resolve the unrelated build error before release.
