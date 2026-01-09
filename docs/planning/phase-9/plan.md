# Phase 9 — CRM Status, Hyperlinks, Knowledge Ingestion, and AI Draft Model Updates

## Purpose
Add an **Unqualified** CRM status, enable **hyperlinks** in saved responses/sequences, expand **Knowledge Assets** to ingest files + websites, and upgrade AI draft creation to use **gpt-5-mini (high reasoning)** for better outbound drafts.

## Context
ZRG Dashboard already unifies SMS (GHL), Email (Inboxxia/EmailBison), and LinkedIn (Unipile) with AI sentiment + draft generation. These changes improve lead lifecycle accuracy (Unqualified), increase conversion (easy calendar links), and increase draft quality by adding richer company context via Knowledge Assets (file ingestion + website crawling/extraction).

## Objectives
* [x] Add “Unqualified” everywhere lead status is used (DB, UI, filters, automations)
* [x] Support hyperlink insertion/rendering for responses and sequences across channels
* [x] Add Knowledge Asset file uploads with text extraction/OCR
* [x] Add Knowledge Asset website ingestion with crawl4ai-based scraping + summarization
* [x] Switch AI draft creation model to gpt-5-mini (high reasoning) and incorporate new knowledge context

## Constraints
- Never commit secrets/tokens; keep OCR/crawl content sanitized and stored safely.
- If `prisma/schema.prisma` changes: run `npm run db:push` against the correct DB before closing.
- OCR + extraction tasks should use **gpt-5-mini (low reasoning)** as requested.
- AI draft creation should use **gpt-5-mini (high reasoning)** as requested.
- Use Context7 for any library/API documentation lookups during implementation (Next.js, Supabase, storage/OCR libs).
- Website ingestion must use `https://github.com/unclecode/crawl4ai`; validate production/runtime feasibility (Vercel/Node vs Python worker) before locking architecture.

## Success Criteria
- [x] “Unqualified” appears in CRM status UI, can be saved, and is respected in filters, counts, and automations.
- [x] Responses/sequences can include a link (e.g., calendar URL) via UI affordance and render safely as clickable links (channel-appropriate formatting).
- [x] Knowledge Assets accept files (PDF/Word/etc), extract text (OCR if needed), store canonical text + metadata, and make it usable by AI drafting.
- [x] Knowledge Assets accept website URLs and store an extracted summary + key facts (company, offering, ICP, proof points, links).
- [x] AI drafts are generated with gpt-5-mini (high reasoning) and correctly incorporate extracted knowledge context.

## Subphase Index
* a — Add “Unqualified” CRM status everywhere
* b — Add hyperlink support for responses and sequences
* c — Add file uploads to Knowledge Assets + OCR/text extraction
* d — Add website ingestion via crawl4ai + company-summary extraction prompts
* e — Switch AI draft creation to gpt-5-mini (high reasoning) + wire in knowledge context

## Phase Summary
- CRM status: added `unqualified` end-to-end across CRM UI + status-dependent automation gates.
- Hyperlinks: added calendar-link insertion in composer and sequences; hardened message rendering + linkified email output.
- Knowledge Assets: added file uploads (PDF/DOCX/TXT/MD/images) and website ingestion (crawl4ai → AI-ready notes).
- AI drafts: switched draft generation to `gpt-5-mini` with high reasoning; drafts consume new knowledge notes automatically.
- Validation: `npm run lint` (warnings only) and `npm run build` succeeded.

