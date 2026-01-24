# Phase 55a — Process (2) Flow Spec + Edge Cases

## Focus
Define the exact end-to-end behavior for "initial outbound includes times via EmailBison custom variable" with clear triggers, idempotency rules, and edge cases.

## Inputs
- Phase 52 Process (2) requirements (campaign-provider first touch).
- Provided n8n workflow + prompt text (what must happen, not necessarily how).
- Existing system primitives:
  - Workspace availability cache (UTC slot pool)
  - Slot distribution ledger (minimize collisions)
  - `Lead.offeredSlots` persistence + inbound acceptance auto-booking

## Work
- Define triggers and filters:
  - "First touch" detection (e.g., EmailBison campaign lead `emails_sent == 0`).
  - Scheduling window: scheduled send within next 24 hours; JIT generation within ~15 minutes of send.
- Define `availability_slot` content contract:
  - Human-readable sentence containing 1–2 offered times in the client timezone.
  - Offered slots must be strictly after the scheduled send time.
  - Prefer next ~5 business days; avoid weekends if possible.
- Define data contract for downstream auto-booking:
  - Persist the exact offered UTC slots to `Lead.offeredSlots` for later "pick one of the offered times" detection.
  - Increment offered-slot counts in the workspace ledger.
- Define idempotency rules:
  - If `availability_slot` is already set and the DB shows recently persisted offered slots for the same lead, skip.
  - Do not overwrite if the lead has already booked an appointment.
  - Preserve other EmailBison lead custom variables when patching.
- Enumerate edge cases and expected behavior:
  - No scheduled email found / multiple scheduled emails
  - Missing or stale availability cache
  - Invalid timezone on workspace
  - Lead missing email / mismatch between provider lead and DB lead
  - Campaigns not yet synced into our DB

## Output
- A short checklist of conditions that must be true for us to PATCH `availability_slot`.
- Concrete idempotency rules that can be implemented deterministically.

## Handoff
Proceed to Phase 55b with a locked spec so implementation can be time-bounded and safe.

---

## RED TEAM Status: COMPLETE ✅

### Spec Verification (implemented in `lib/emailbison-first-touch-availability.ts`)

**Triggers and filters (lines 304-327):**
- ✅ First touch: `getEmailsSent(leadItem) === 0` (line 312)
- ✅ Scheduled within 24h: `scheduledSendAt <= in24h && scheduledSendAt >= now` (line 323)
- ✅ Due within 15m: `scheduledSendAt <= in15m` (line 326)

**Content contract (lines 374-397):**
- ✅ Weekday preference with fallback (lines 374-381)
- ✅ 1–2 slots via `selectDistributedAvailabilitySlots()` (lines 383-391)
- ✅ `startAfterUtc` = scheduled send time (line 388)
- ✅ `preferWithinDays: 5` (line 389)
- ✅ Human-readable format via `formatAvailabilityOptionLabel()` + `buildAvailabilitySentence()` (lines 395-397)

**Data contract (lines 404-424):**
- ✅ Persist to `Lead.offeredSlots` as JSON with `datetime`, `label`, `offeredAt` (lines 406-418)
- ✅ Increment ledger via `incrementWorkspaceSlotOffersBatch()` (lines 420-424)

**Idempotency rules (lines 335-354):**
- ✅ Skip if `appointmentBookedAt` set (line 345)
- ✅ Skip if `availability_slot` already set AND `offeredSlots` recent (<6h) (lines 347-354)
- ✅ Preserve existing custom vars via `upsertCustomVariable()` (lines 426-429)

**Edge cases:**
- ✅ No scheduled emails: `continue` (line 318)
- ✅ Multiple scheduled: picks earliest via `getEarliestScheduledSendAt()` (line 320)
- ✅ Missing/stale cache: `getWorkspaceAvailabilitySlotsUtc({ refreshIfStale: true })` (line 244), skip if empty (line 252)
- ✅ Invalid timezone: caught by `Intl.DateTimeFormat` with fallback (lines 55-61, 78-98)
- ✅ Lead missing email: `continue` (line 358)
- ✅ Campaigns not synced: only processes campaigns in DB (line 234-239)

### Conditions Checklist for PATCH (all implemented)

1. ✅ Workspace has `emailProvider: "EMAILBISON"` + valid `emailBisonApiKey`
2. ✅ Campaign exists in DB with `bisonCampaignId`
3. ✅ Lead has `emails_sent === 0` (first touch)
4. ✅ Scheduled email exists with `scheduled_date` within next 24h
5. ✅ Scheduled send is due within ~15 minutes
6. ✅ Lead has no `appointmentBookedAt`
7. ✅ Either `availability_slot` not set OR `offeredSlots` older than 6h
8. ✅ Lead has valid email address
9. ✅ Workspace availability cache has slots
10. ✅ At least 1 slot available after scheduled send time

