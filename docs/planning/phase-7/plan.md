# Phase 7 — SMS Sync + GHL-Based Lead Enrichment Hardening

## Purpose
Fix SMS “Sync” gaps where a lead can be linked to a GoHighLevel (GHL) contact (or has matching email) but still shows **no phone number** in the dashboard, causing the SMS channel to be hidden/disabled and follow-up automation to stall.

## Context
- ZRG Dashboard unifies Email (Inboxxia/EmailBison) + SMS (GHL) + LinkedIn into one lead record and conversation view.
- Some GHL workflow webhooks can omit standard contact fields (notably `phone`), especially when the lead was first created on the email side and later replied via SMS.
- The system can still sync SMS history using `ghlContactId`, but UI + automation often rely on `Lead.phone` to enable the SMS channel.
- Current enrichment tooling is EmailBison/Clay-first; it should also leverage GHL as a first-class enrichment source when an email can be matched to a GHL contact.

## Objectives
* [ ] Identify the exact failure mode(s) that leave `Lead.phone` empty while SMS is present in GHL.
* [ ] Add a safe GHL enrichment pass (search by email + fetch contact) to hydrate missing lead fields.
* [ ] Ensure manual sync / sync-all surfaces “contact updated” changes and refreshes the UI appropriately.
* [ ] Add a backfill + monitoring approach to prevent regressions and repair existing rows.

## Constraints
- Webhooks are untrusted input; validate/sanitize and avoid logging PII (full phone/email/message bodies).
- Avoid creating duplicate contacts in GHL; prefer lookup/search before any upsert/create behavior.
- Prefer existing utilities under `lib/` (lead matching, phone utils, GHL API client) over new patterns.
- Keep changes localized and compatible with current schema (`Lead.enrichmentStatus`, `Lead.ghlContactId`, `Lead.phone`).

## Success Criteria
- A lead with `email=lead@example.com` and an existing GHL contact with a phone number ends up with `Lead.phone` populated after SMS webhook ingestion or a manual “Sync”.
- The Action Station shows the SMS channel when `ghlContactId` exists (even if `Lead.phone` was initially missing).
- Follow-up engine no longer pauses SMS steps for leads where the phone is available in GHL.
- Sync All reports “contacts updated” when it only hydrated lead fields (no message imports) and the UI reflects the updates.

## Subphase Index
* a — Reproduce + isolate the SMS/phone mismatch
* b — Implement GHL email→contact match + lead hydration rules
* c — Wire hydration into sync + UI refresh + channel availability
* d — Backfill existing leads + observability + regression checks
