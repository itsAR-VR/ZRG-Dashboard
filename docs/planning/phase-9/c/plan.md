# Phase 9c — Add File Uploads to Knowledge Assets + OCR/Text Extraction

## Focus
Allow Knowledge Assets to accept **files** (PDF, Word, etc.), store them safely, and extract canonical text for downstream AI usage. Use **gpt-5-mini (low reasoning)** for OCR-related tasks when native text extraction is insufficient.

## Inputs
- Existing Knowledge Assets DB models and UI (search in `prisma/`, `app/`, `actions/`, `lib/`)
- Storage provider (likely Supabase Storage or existing file store patterns in repo)
- OpenAI client integration used by AI modules (for OCR/extraction)

## Work
1. Confirm current Knowledge Asset model + UI flow (create/edit/list).
2. Add a new asset type for “File” (if not already present):
   - Metadata: filename, mime, size, storage path, upload status, extractedText, extractedAt, source.
3. Implement secure upload:
   - Server-side validation (allowed types, size limits).
   - Store file in the chosen storage backend and persist metadata.
4. Extract text:
   - Prefer deterministic extraction first (e.g., PDF text, DOCX text).
   - Fallback to OCR for image-only/scanned docs using **gpt-5-mini (low reasoning)**.
   - Chunk extracted text and store canonical text + summary fields for retrieval/drafting.
5. Observability + UX:
   - “Processing” state, retry on failure, and clear error messages.
6. Validate:
   - Upload PDF and DOCX; confirm extracted text is stored and visible/usable.

## Output
### Implemented
- Added Knowledge Asset **File Upload** option in Settings UI: `components/dashboard/settings-view.tsx`
- Added server action to upload + process file knowledge assets: `actions/settings-actions.ts`
  - Validates workspace/name/file + size cap (`KNOWLEDGE_ASSET_MAX_BYTES`, default 12MB)
  - Best-effort upload to Supabase Storage (`SUPABASE_KNOWLEDGE_ASSETS_BUCKET`, default `knowledge-assets`)
  - Extracts concise AI-ready notes using `gpt-5-mini` with low reasoning for OCR/extraction
- Added extraction pipeline (PDF + images via Responses API, DOCX via `mammoth` + summarize): `lib/knowledge-asset-extraction.ts`

### Docs/References Used
- OpenAI Responses API: `input_file` (PDF) and `input_image` (base64) patterns via Context7.

## Handoff
Proceed to Phase 9d to add website ingestion via `crawl4ai`, producing the same kind of AI-ready company notes for drafting.
 
