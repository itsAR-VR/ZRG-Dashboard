# Phase 151d — SMS AI Phone Normalization + Lead Audit Fields + SMS Banner UI

## Focus
Make SMS “sendable or skippable” every time by normalizing phones via AI before every SMS send (manual + automation), persisting lead-level audit fields, and surfacing a banner in the SMS UI until the next successful SMS send.

## Inputs
- `docs/planning/phase-151/a/plan.md` (SMS audit columns exist)
- Existing SMS send paths:
  - `lib/system-sender.ts` (`sendSmsSystem`)
  - `actions/message-actions.ts` (manual send calls `sendSmsSystem`)
  - `lib/followup-engine.ts` (automation calls `sendSmsSystem`)
- Existing deterministic helpers for validation:
  - `libphonenumber-js` (already used)
  - `lib/phone-utils.ts` (storage formatting)
- Locked SMS decisions:
  - AI-only normalization, called every time, model `gpt-5-nano`, 2 retries.
  - On missing phone for automation: skip-and-advance immediately (no enrichment attempt).
  - On AI normalization failure: do not auto-trigger phone enrichment; record audit + banner.
  - Banner triggers on any send-blocker and persists until the next successful SMS send.
  - Attempt count = consecutive blocked sends since last success.

## Work
1. **Implement AI phone normalizer (server-only)**
   - Create a structured JSON prompt that returns:
     - `e164: string | null`
     - `reason: string` (controlled vocabulary; no PII)
   - Use `gpt-5-nano` and retry up to 2 times.
   - Deterministic validation:
     - Accept only if `e164` parses as valid E.164 via libphonenumber.
     - Otherwise treat as failure.

2. **Integrate normalization into every SMS send**
   - In `sendSmsSystem`:
     - Load lead + workspace context.
     - Run AI normalizer even if the phone is already present.
     - On success:
       - Persist normalized phone into `Lead.phone` (E.164 storage).
       - Attempt to sync/patch GHL contact phone (best-effort) before sending.
       - On successful send: set `smsLastSuccessAt`, reset `smsConsecutiveBlockedCount=0`, clear `smsLastBlockedReason`.
     - On failure:
       - Set `smsLastBlockedAt`, set `smsLastBlockedReason`, increment `smsConsecutiveBlockedCount`.
       - Return a typed error so UI and follow-up engine can branch deterministically.

3. **Follow-up engine behavior (automation)**
   - If `lead.phone` is missing:
     - Skip-and-advance immediately (do not call enrichment pipeline).
   - If `sendSmsSystem` returns a phone normalization failure:
     - Skip-and-advance with an audit trail (task record + reason).
   - Preserve existing retry semantics for SMS DND where applicable.

4. **SMS banner UI**
   - In the lead SMS panel (Action Station), render a banner when:
     - `smsLastBlockedAt` exists and is more recent than `smsLastSuccessAt`.
   - Copy requirements:
     - Actionable + neutral.
     - Mentions it clears after the next successful SMS send.
   - Include the latest reason and consecutive blocked count.

5. **Tests**
   - Unit tests for the normalizer wrapper (mock prompt runner).
   - Unit tests for audit counter:
     - increments on blocked sends
     - resets on success
   - Minimal UI logic test if a harness exists; otherwise test the banner predicate in isolation.

## Output
- Manual and automated SMS send paths are deterministic:
  - Send succeeds with normalized E.164, or
  - Send fails with persisted audit fields and clear UI.
- Automation never stalls on missing/invalid phone; it skips-and-advances with audit.

## Handoff
Proceed to 151e to run the full NTTAN validation gates and complete Tim canary + rollout monitoring.
