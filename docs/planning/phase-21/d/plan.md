# Phase 21d — Validation + Configuration Docs Updates

## Focus
Verify the changes and make setup requirements clear to avoid repeated misconfiguration in production.

## Inputs
- Updated storage + website ingestion code
- Crawl4AI helper scripts under `scripts/crawl4ai/`

## Work
- Run `npm run lint` and `npm run build`.
- Update `scripts/crawl4ai/README.md` (and/or main README) with the minimum env vars required and recommended production deployment options.
- Add troubleshooting notes for common errors (bucket missing, Crawl4AI missing).

## Output
- Verified build; clearer setup guidance.

## Handoff
If everything passes, push changes to GitHub.

