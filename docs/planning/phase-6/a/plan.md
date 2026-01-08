# Phase 6a — Trace + Reproduce Signature Extractor Parse Failures

## Focus
Identify why the signature extractor’s AI response is sometimes truncated/malformed and reproduce it safely.

## Inputs
- Recent webhook logs showing a parse error (truncated JSON) followed by “Email not from lead… skipping”.
- `lib/signature-extractor.ts` (or equivalent) and any AI wrapper used for extraction.
- Email webhook enrichment sequence in `app/api/webhooks/email/route.ts`.

## Work
1. Locate where signature extraction is invoked and how `isFromLead` is derived.
2. Find the exact parsing logic and failure mode (JSON parse, streaming cut-off, model returning non-JSON, etc.).
3. Add a minimal local repro harness:
   - Use a sanitized fixture email body (no real addresses/names).
   - Force the same parsing path and simulate a truncated response.
4. Categorize errors into a small set (e.g., `invalid_json`, `truncated_json`, `non_json_response`, `timeout`).

## Output
- **Code path:** `app/api/webhooks/email/route.ts` → `enrichLeadFromSignature()` calls `extractContactFromSignature()` and then does `if (!extraction.isFromLead) ... skipping`.
- **Failure mode:** `lib/signature-extractor.ts` parses AI output via `JSON.parse(extractJsonObjectFromText(content))`. When the model returns **truncated JSON** (missing a closing `}`), parsing throws and the extractor returns the `defaultResult` which sets `isFromLead: false` → downstream logs “Email not from lead” even though it may just be a parse failure.
- **Repro harness:** added `scripts/repro-signature-ai-parse.js` which deterministically reproduces the truncated-JSON parsing failure and categorizes it (`truncated_json`, `non_json_response`, etc.) without any OpenAI calls or PII.

## Handoff
Implement structured output + robust parsing (Phase 6b), and ensure parse failures produce `isFromLead=unknown` (not `false`) so the webhook doesn’t misclassify parse failures as “assistant replies”.
