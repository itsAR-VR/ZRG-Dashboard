# Crawl4AI website ingestion (local + service)

This repo can ingest websites into **Knowledge Assets** using the open-source `unclecode/crawl4ai` crawler.

## Option A — Run as a local runner (dev)

1. Install + setup Crawl4AI:
   - `pip install -U crawl4ai`
   - `crawl4ai-setup`
2. Enable the local runner in `.env.local`:
   - `CRAWL4AI_LOCAL_RUNNER=true`
3. Add a website Knowledge Asset in Settings → it will call `scripts/crawl4ai/extract_markdown.py`.

## Option B — Run as an HTTP service (recommended for prod)

1. Install deps:
   - `pip install -r scripts/crawl4ai/requirements.txt`
   - `crawl4ai-setup`
2. Run the service:
   - `uvicorn scripts.crawl4ai.service:app --host 0.0.0.0 --port 4891`
3. Configure the Next.js app:
   - `CRAWL4AI_SERVICE_URL=http://localhost:4891`
   - Optional: `CRAWL4AI_SERVICE_SECRET=...` (and the service will require `Authorization: Bearer ...`)

