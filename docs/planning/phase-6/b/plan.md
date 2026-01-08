# Phase 6b — Enforce Structured Output + Resilient Parsing

## Focus
Ensure the AI returns valid structured data and parsing is tolerant to minor drift without introducing unsafe heuristics.

## Inputs
- Findings + repro harness from Phase 6a.
- Existing AI call/prompt used by signature extraction.

## Work
1. Update the signature extraction AI call to enforce strict JSON output:
   - Use a schema/structured-output mechanism if available in the AI wrapper.
   - Otherwise, tighten the prompt to “JSON only” and validate.
2. Implement resilient parsing:
   - First attempt strict JSON parse.
   - If it fails, attempt a safe recovery (e.g., extract the first top-level JSON object substring) with size limits.
   - If recovery fails, return a typed “unknown” result instead of false defaults.
3. Add unit tests (or a lightweight test harness) for:
   - Valid JSON
   - Truncated JSON
   - Non-JSON response
   - Empty response/timeouts

## Output
- Parsing is now resilient to common “JSON + extra text/fences” drift by using brace-balanced extraction before `JSON.parse`:
  - Added `extractFirstCompleteJsonObjectFromText()` in `lib/ai/response-utils.ts`.
  - Updated `lib/signature-extractor.ts` to use it (and to treat “incomplete_json_object” explicitly).
- Structured-output fallback is hardened to reduce drift:
  - Appended a strict “JSON only” backstop to instructions.
  - Set `text: { verbosity: "low" }` on the fallback request.
- Removed PII-risk logging on parse failures:
  - `lib/signature-extractor.ts` no longer prints the raw model output; it logs only error category + safe response summary fields.
- Harness updated to demonstrate naive vs brace-balanced extraction behavior:
  - `scripts/repro-signature-ai-parse.js` now prints both “naive” and “balanced” results.

## Handoff
Adjust downstream “isFromLead” behavior so parse failures do not default to “not from lead”, and add safe deterministic fallbacks in the email webhook (Phase 6c).
