# Phase 21 — Knowledge Assets Reliability (Storage + Website Ingestion)

## Purpose
Eliminate runtime errors when adding Knowledge Assets (file uploads + website scraping) and ensure previously-entered assets are visible and recoverable.

## Context
Production logs (2026-01-14) show two recurring failures:
1) Supabase Storage upload attempts fail because the configured bucket does not exist (“Bucket not found”), even though the upload is intended to be best-effort.
2) Website Knowledge Asset creation fails because Crawl4AI is not configured (“Crawl4AI not configured…”), preventing successful adds and ingestion.

We need robust defaults that avoid hard failures, provide clear remediation guidance, and allow “retry/refresh” ingestion so previously-entered URLs can be processed once configuration is available.

## Objectives
* [ ] Make Knowledge Asset file uploads resilient: auto-provision/verify Storage bucket when possible, avoid noisy errors, and keep extraction working even if Storage is unavailable
* [ ] Make website ingestion resilient: avoid hard failure when Crawl4AI is not configured, ensure URL assets are created and can be re-processed later, and add a retry mechanism
* [ ] Preserve and recover existing Knowledge Assets already created (especially URL assets with missing extracted text)
* [ ] Validate build/lint and update configuration docs where needed

## Constraints
- Never commit secrets or tokens.
- Treat web ingestion as untrusted input; keep SSRF protections.
- Prefer minimal, focused changes; no Prisma schema changes unless unavoidable.
- Keep using Crawl4AI when configured, but do not hard-fail when it isn’t.

## Success Criteria
- [x] Adding a file Knowledge Asset does not error if the Storage bucket is missing; the system auto-creates it (when possible) or proceeds silently without Storage.
- [x] Adding a website Knowledge Asset succeeds even when Crawl4AI is not configured; the asset is created and either ingested via fallback or marked pending.
- [x] Previously-created website assets remain visible and can be re-ingested via a “Retry/Refresh” action.
- [x] `npm run lint` and `npm run build` succeed.

## Subphase Index
* a — Storage bucket auto-provision + upload hardening
* b — Website ingestion resiliency + Crawl4AI fallback
* c — UI recovery: retry ingestion + better status messaging
* d — Validation + configuration docs updates

## Phase Summary
- Storage uploads: best-effort bucket auto-provision + retry on “bucket not found”; stores an internal `supabase-storage://<bucket>/<path>` reference (`actions/settings-actions.ts`).
- Website ingestion: Crawl4AI is preferred when configured, but the app no longer hard-fails if it isn’t; falls back to `fetch()` + best-effort HTML-to-text extraction (`lib/crawl4ai.ts`).
- Recovery: URL assets that failed extraction show as “Pending extraction” and can be retried from Settings (`retryWebsiteKnowledgeAssetIngestion` + Settings UI button).
- Docs: added env var documentation and Crawl4AI troubleshooting (`README.md`, `scripts/crawl4ai/README.md`).
