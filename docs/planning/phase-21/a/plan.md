# Phase 21a — Storage Bucket Auto-Provision + Upload Hardening

## Focus
Prevent “Bucket not found” Storage errors during Knowledge Asset file uploads by ensuring the bucket exists (best-effort) and by keeping uploads non-blocking.

## Inputs
- Production error: Supabase Storage upload failing with “Bucket not found”
- Current implementation: `actions/settings-actions.ts` best-effort upload before extraction

## Work
- Add a best-effort `ensureKnowledgeAssetsBucket()` using the Supabase admin client (service role) and retry upload after bucket creation.
- Avoid logging noisy stack traces for expected misconfiguration; downgrade to warn-level logs where appropriate.
- Keep extraction pipeline functional even if Storage is unavailable.

## Output
- File uploads no longer emit “Bucket not found” errors in normal operation.

## Handoff
Proceed to Phase 21b to harden website ingestion and Crawl4AI behavior.

