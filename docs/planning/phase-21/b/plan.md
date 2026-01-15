# Phase 21b — Website Ingestion Resiliency + Crawl4AI Fallback

## Focus
Ensure website Knowledge Assets can be added and ingested even when Crawl4AI is not configured, while still preferring Crawl4AI when available.

## Inputs
- Production error: “Crawl4AI not configured…”
- Current implementation: `crawl4aiExtractMarkdown()` throws when not configured

## Work
- Update `lib/crawl4ai.ts` to provide a safe fallback when Crawl4AI is not configured (or when the local runner cannot execute).
- Update `addWebsiteKnowledgeAsset()` to avoid failing the whole action if crawling or summarization fails after the DB record is created; return success with a “pending/not ingested” asset state and a warning message.
- Add a server action to re-run ingestion for existing URL assets (retry/refresh).

## Output
- Website assets are always created and can be ingested later; no hard failure on missing Crawl4AI config.

## Handoff
Proceed to Phase 21c to expose retry/status improvements in the Settings UI.

