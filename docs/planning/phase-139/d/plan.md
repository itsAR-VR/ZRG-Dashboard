# Phase 139d — Booking Confirmation + Meeting Overseer v2 Timezone Integration

## Focus

Finalize auto-booking timezone correctness by:

1. forcing booking confirmations to use lead timezone when known, and
2. adding `detected_timezone` extraction to a versioned meeting-overseer schema (`v2`) with compatibility safeguards.

## Inputs

- 139a: `ensureLeadTimezone(leadId, opts?)` with optional `conversationText`.
- 139c: lead-timezone label policy and business-hours filtering in slot selection.
- `lib/followup-engine.ts`:
  - `processMessageForAutoBooking()`
  - `sendAutoBookingConfirmation()`
  - additional `formatAvailabilitySlotLabel` usage sites in booking branches.
- `lib/meeting-overseer.ts`:
  - `MeetingOverseerExtractDecision`
  - extract schema + prompt configuration.

## Work

### 1. Pass conversation text in booking flow timezone resolution

In `processMessageForAutoBooking()`:

- Replace `ensureLeadTimezone(leadId)` with `ensureLeadTimezone(leadId, { conversationText: messageTrimmed })`.
- Keep fallback chain unchanged when no timezone is resolved.

### 2. Enforce lead-timezone-only confirmation labels

In `sendAutoBookingConfirmation()`:

- Add optional `leadTimeZone?: string | null` on opts.
- Determine formatter timezone as:
  - `leadTimeZone` when valid and present
  - otherwise existing `timeZone` fallback.
- Do not add dual label output.

Thread `leadTimeZone` from `processMessageForAutoBooking` into every `sendAutoBookingConfirmation` call site in this file.

### 3. Add meeting overseer extraction v2 schema

In `lib/meeting-overseer.ts`:

- Create versioned extract schema/prompt key:
  - `meeting.overseer.extract.v2`
- Extend decision type with:
  - `detected_timezone: string | null`
- Add extraction rule:
  - when message contains explicit timezone/location signal tied to scheduling text, return IANA timezone.
  - else return `null`.

### 4. Maintain compatibility during v1 -> v2 transition

- Keep reading existing cached/stored decisions safely.
- Treat missing `detected_timezone` as `null`.
- Do not break existing extraction consumers while v2 rolls out.

### 5. Persist overseer-detected timezone safely

After overseer extraction in `processMessageForAutoBooking()`:

- If `detected_timezone` exists and `isValidIanaTimezone(...)` is true:
  - persist only when changed from current lead timezone.
- Ignore invalid/non-IANA values.

### 6. Integrate with Phase 138 edits safely

Before writing in shared sections:

- re-read latest `lib/followup-engine.ts` and `lib/meeting-overseer.ts`.
- preserve Phase 138 return-type and booking-route changes.
- resolve merge semantics in-code, not line-based patch assumptions.

### 7. Verify

- Lead says "before noon PST" -> booking confirmation shows PST label.
- Lead says no timezone -> fallback remains workspace timezone.
- Overseer v2 returns valid IANA timezone -> persisted.
- Overseer returns invalid timezone token -> not persisted.
- `npm run lint` passes.
- `npm run build` succeeds.

## Output

- `lib/followup-engine.ts` updated with lead-timezone confirmation enforcement and conversation-aware timezone resolution.
- `lib/meeting-overseer.ts` updated with `meeting.overseer.extract.v2` and `detected_timezone`.
- Compatibility path documented and implemented for missing `detected_timezone`.

## Handoff

Phase 139e performs final cross-phase integration checks against active Phase 138 changes and runs full regression verification across the three reported bug scenarios.
