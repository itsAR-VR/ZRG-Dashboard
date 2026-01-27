# Phase 63d — GHL: Phone Normalization + Error Classification + Appointment Normalization

## Focus
Make phone normalization global-safe (no bogus country calling codes), optionally AI-assisted when enabled, and reclassify expected GHL 4xx errors. Also normalize GHL appointment list responses so reconciliation always has an appointment ID.

## Inputs
- `lib/ghl-api.ts`
- `lib/system-sender.ts`
- `lib/ghl-contacts.ts`
- `lib/phone-utils.ts` (client-safe utilities; do not bloat client bundle)
- `lib/ghl-appointment-reconcile.ts`

## Work
- [ ] Add server-only phone normalization using `libphonenumber-js` for validation/formatting.
- [ ] Add optional AI-assisted region inference for ambiguous national-format numbers (behind env flag).
- [ ] Use new normalization in GHL contact upsert/update flows.
- [ ] Extend `lib/ghl-api.ts` error parsing to classify DND/missing-phone/invalid-country-code and downgrade log severity.
- [ ] Normalize `/contacts/{id}/appointments` response items so `id` is always present (fix appointment reconcile cron).

## Output
- Added server-only phone normalization in `lib/phone-normalization.ts`:
  - Validates/normalizes to E.164 using `libphonenumber-js`.
  - Supports explicit `+` / `00` prefixes, digits-that-already-include-country-code, and national parsing via deterministic region signals.
  - Optional AI-assisted region inference via `gpt-5-mini` (low reasoning) behind `PHONE_E164_AI_ENABLED=true`, with a confidence gate and libphonenumber validation.
- Updated phone storage normalization to be more conservative (`lib/phone-utils.ts:toStoredPhone`) so 11-digit national numbers don’t get incorrectly promoted to `+` E.164.
- Updated GHL phone sync call sites:
  - `lib/system-sender.ts` now uses `resolvePhoneE164ForGhl()` when patching missing-phone contacts.
  - `lib/ghl-contacts.ts` now uses `resolvePhoneE164ForGhl()` for contact upsert/update and phone sync.
- Updated `lib/ghl-api.ts`:
  - Classifies expected 4xx conditions (`sms_dnd`, `missing_phone`, `invalid_country_code`) and downgrades log severity accordingly.
  - Normalizes `/contacts/{contactId}/appointments` list items via `normalizeGhlAppointmentResponse()` to ensure IDs exist (fixes reconcile cron “missing ghlAppointmentId” failures).

## Handoff
Proceed to Phase 63e to centralize OpenAI text prompt retries and reduce noisy `[AI Drafts]` error logs for recoverable incomplete-output states.
