# Phase 8 — Always-on GHL Contact Resolution + Global Lead Backfill

## Purpose
Make GHL contact resolution/hydration **default behavior** for both single-lead sync and “Sync All”, and run a **global backfill across all clients/leads** (including non-responders) to populate missing lead fields (especially `phone`) from GHL.

## Context
- Multi-channel lead records can be created from EmailBison first (email exists) and later need to operate on the SMS side.
- If a lead exists in GHL but the dashboard row is missing `phone` (or even `ghlContactId`), the SMS channel can appear “broken” even though GHL has the data.
- The EmailBison webhook already ensures a GHL contact is created/linked for positive signals (e.g., `LEAD_INTERESTED`) via `ensureGhlContactIdForLead(..., { allowCreateWithoutPhone: true })`.
- Manual sync (`smartSyncConversation`) can resolve missing `ghlContactId` for email-first leads, but batch sync (`syncAllConversations`) currently disables that behavior.
- GHL API 2.0 rate limits (per location/company): **100 requests per 10 seconds (burst)** and **200,000 requests per day**. Handle `429` with `Retry-After` backoff.

## Objectives
* [x] Make **single-lead sync** and **Sync All** always attempt to resolve missing `ghlContactId` (by searching GHL via email) and hydrate missing lead fields from the resolved contact.
* [x] Increase batch throughput to the safe maximum under GHL limits (100/10s burst; 200k/day/location), with queueing + `Retry-After` backoff.
* [x] Run a **global backfill** across all clients/leads (including non-responders) to repair existing rows (missing phone/email/name/company, missing `ghlContactId` when discoverable).
* [x] Keep contact **creation** behavior explicit: backfill/sync defaults to **search/link/hydrate** (no accidental “create for everyone”); the existing EmailBison “Interested” workflow remains allowed to create/link as it does today.
* [x] Keep changes PII-safe and operationally safe (no serverless timeouts; resumable/cursor-based backfill).

## Constraints
- Avoid logging raw emails/phones/message bodies (PII) in webhook/sync logs.
- Preserve the existing EmailBison → GHL workflow for positive leads (do not regress automatic contact creation/linking).
- Batch/backfill behavior must be rate-limit aware (GHL API quotas/latency); implement explicit throttling per GHL location and handle 429s.
- Backfill across “the entire dashboard” must be resumable and not depend on a single UI-triggered serverless invocation.

## Success Criteria
* [x] “Sync All” always attempts to resolve/hydrate (no toggle), and reports hydrated outcomes even when no messages are imported.
* [x] Single-lead “Sync” performs the same GHL resolve/hydrate behavior as Sync All.
* [x] A global backfill runner exists to process all clients/leads (including non-responders) and populate `Lead.phone` when a matching GHL contact exists.
* [x] EmailBison `LEAD_INTERESTED` continues to ensure a GHL contact exists for the lead as it does today.
* [x] Throughput is maximized without breaching documented GHL limits; 429s are handled via `Retry-After` and queueing.

## Known Gaps / Weak Spots (What This Phase Closes)
- Batch sync currently disables resolving missing `ghlContactId`, so email-first leads can never be hydrated via “Sync All”.
- `lib/ghl-api.ts` does not yet centralize rate limiting or `429` retry handling, which blocks safe concurrency increases.
- There is no resumable “all-clients/all-leads” backfill runner today; only ad-hoc/manual syncs exist.
- Several call sites log raw error objects (`console.warn(..., err)`), which can accidentally include PII depending on upstream error payloads.

## Subphase Index
* a — Audit current GHL contact creation/linking flows
* b — Make resolve/hydrate always-on in sync flows (single + all) and tune rate limiting
* c — Build + run a global backfill across all clients/leads (resumable)
* d — Verification checklist + rollout/monitoring guidance

## Phase Summary
- Sync behavior:
  - Single-lead sync and “Sync All” now always attempt to resolve missing `Lead.ghlContactId` via GHL email search (search/link only) and hydrate missing lead fields from GHL.
  - `syncAllConversations` no longer disables GHL resolution and defaults to higher concurrency (configurable via `SYNC_ALL_CONCURRENCY`).
- GHL client hardening:
  - Added centralized throttling (default 90 requests / 10s) and `429` handling via `Retry-After` in `lib/ghl-api.ts`.
  - Reduced PII risk by avoiding raw error-body logging and redacting common patterns in error messages.
- Backfill tooling:
  - Added resumable backfill script `scripts/backfill-ghl-lead-hydration.ts` to repair existing leads across all clients/leads (including non-responders) without creating contacts.
- Docs:
  - Updated `README.md` with always-on hydration behavior, backfill run commands, and new env vars.
