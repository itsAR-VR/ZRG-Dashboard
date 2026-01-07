# Phase 3 — Clay Enrichment Reliability (LinkedIn + Phone)

## Purpose
Restore and harden the Clay enrichment loop (send → enrich → callback) so **every relevant lead** reliably gets enriched and our DB is updated correctly (LinkedIn URL + phone), without silent failures.

## Context
- The system triggers Clay enrichment via two Clay table webhooks:
  - LinkedIn enrichment table (find/confirm `linkedinUrl`)
  - Phone enrichment table (find/confirm `phone`)
- Clay then calls back to `POST /api/webhooks/clay` (configured via Clay “HTTP API” action).
- Current issues observed:
  - Clay “HTTP API” action error: `Header name must be a valid HTTP token ["Content-Type:"]` (likely caused by configuring the header key as `Content-Type:` instead of `Content-Type`).
  - The callback handler expects `status: "success" | "not_found" | "error"`, but Clay payloads appear to be sending `success: true` with no `status`, which results in silent no-op updates.
  - LinkedIn table “Webhook received” activity appears stale (last seen 2025-12-17), while Phone table is more recent (last seen 2026-01-02), suggesting trigger coverage and/or gating may be preventing LinkedIn sends for some leads.

## Objectives
* [ ] Confirm Clay request + callback payload schemas and required header/signature config
* [ ] Fix `/api/webhooks/clay` to robustly parse Clay callbacks (handle `success` boolean + field aliases) and update Lead records deterministically
* [ ] Audit trigger paths so eligible leads reliably get sent to Clay (and provide a safe backfill mechanism for missed leads)
* [ ] Add clear verification/runbook steps for operators (Clay config + test payloads + expected DB/log outcomes)

## Constraints
- Webhooks are untrusted input: validate/sanitize fields and never trust client-provided IDs without DB lookups.
- Verify Clay callback authenticity via `x-clay-signature` (or approved fallback header) before processing.
- Avoid logging sensitive PII (emails/phones) beyond what’s necessary for debugging.
- Clay enrichment has real cost; any retries/backfills must be rate-limited and capped.
- Never commit secrets/tokens; if Prisma schema changes, run `npm run db:push` against the correct database.

## Success Criteria
- Clay “HTTP API” callbacks succeed (no invalid header config) and `POST /api/webhooks/clay` updates:
  - `Lead.linkedinUrl` (normalized) when LinkedIn enrichment succeeds
  - `Lead.phone` (normalized) when phone enrichment succeeds
  - `Lead.enrichmentStatus` transitions correctly (`pending` → `enriched` / `not_found` / `failed`)
- A test callback payload (curl) produces an expected DB update and a clear log line.
- Eligible positive leads missing LinkedIn/phone are being queued/sent to the correct Clay tables (no multi-week gaps without explanation).

## Subphase Index
* a — Confirm Clay schemas + operator config (headers/body/signature)
* b — Harden `/api/webhooks/clay` callback parsing + updates
* c — Audit trigger coverage + add safe backfill/monitoring
* d — Verification + runbook (end-to-end test + operational checks)

