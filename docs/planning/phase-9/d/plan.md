# Phase 9d — Add Website Ingestion via crawl4ai + Company Summary Extraction

## Focus
Add Knowledge Assets that ingest **websites** by crawling/scraping via `crawl4ai`, then extracting a structured company summary + key info that improves AI draft creation.

## Inputs
- crawl4ai repo: `https://github.com/unclecode/crawl4ai`
- Knowledge Assets DB + UI flow (from Phase 9c)
- AI prompt patterns used in drafting (`lib/ai-drafts.ts`) and other AI utilities
- Deployment/runtime constraints (Next.js on Vercel; Node vs Python execution)

## Work
1. Validate architecture for crawl4ai execution in production:
   - Option A: separate Python worker service (recommended if Vercel constraints block Python deps).
   - Option B: Vercel Python function(s) co-located in repo (confirm compatibility).
   - Option C: internal job runner (if repo already has a worker pattern).
2. Implement website asset flow:
   - User enters URL → create asset record → crawl → store raw extracted text + structured summary.
3. Define extraction output schema (stored in DB):
   - Company overview (1–3 sentences)
   - Offer / product(s)
   - ICP / buyer personas
   - Proof (case studies, logos, metrics)
   - Objections / positioning cues
   - Links (pricing, docs, careers, blog)
4. Build prompts for summarization/key-info extraction:
   - Input: crawl text + page titles/URLs.
   - Output: structured JSON matching schema + a short narrative summary.
5. Safety + compliance:
   - Respect robots.txt/terms where required; cap crawl depth; timeouts; prevent SSRF (block private IPs).
6. Validate:
   - Test with 2–3 known websites; confirm stored summaries are high-signal and stable.

## Output
### Implemented
- Website → Knowledge Asset ingestion pipeline:
  - Server action: `actions/settings-actions.ts` (`addWebsiteKnowledgeAsset`)
  - Crawl runner wrapper: `lib/crawl4ai.ts` (supports HTTP service or local python runner)
  - Summarization to AI-ready notes (gpt-5-mini, low reasoning): `lib/knowledge-asset-extraction.ts`
- Settings UI now treats URL assets as “Website (Scrape)”: `components/dashboard/settings-view.tsx`
- Added Crawl4AI runner artifacts:
  - Local script: `scripts/crawl4ai/extract_markdown.py`
  - Optional service: `scripts/crawl4ai/service.py`, `scripts/crawl4ai/requirements.txt`, `scripts/crawl4ai/README.md`

### Safety
- Basic SSRF protection for website ingestion (blocks localhost/.local/private IPs): `actions/settings-actions.ts`

## Handoff
Proceed to Phase 9e to switch AI draft generation to `gpt-5-mini` (high reasoning) and ensure new Knowledge Assets are included in draft context.
 
