# Phase 77a — Fix Signature Extraction Schema

## Focus

Fix the OpenAI structured output schema validation error in `lib/signature-extractor.ts`. The schema defines `reasoning` as a property but excludes it from the `required` array, causing 178 API errors.

## Inputs

- Error logs showing: `400 Invalid schema for response_format 'signature_extraction': In context=(), 'required' is required to be supplied and to be an array including every key in properties. Missing 'reasoning'.`
- OpenAI documentation confirming: when `strict: true`, ALL properties must be in `required` array
- Current schema at `lib/signature-extractor.ts:76-87`

## Work

1. Read current state of `lib/signature-extractor.ts`
2. Locate the schema definition (lines 76-87)
3. Add `"reasoning"` to the `required` array:
   ```typescript
   required: ["isFromLead", "phone", "linkedinUrl", "confidence", "reasoning"],
   ```
4. Run `npm run lint` to verify no TypeScript errors
5. Verify build passes

## Output

- `lib/signature-extractor.ts` updated with corrected schema
- Schema validation errors should be eliminated

## Handoff

Subphase 77b will address the follow-up parsing token budget issues in `lib/followup-engine.ts`.

## Review Notes

- **Evidence:** `lib/signature-extractor.ts:86` now reads `required: ["isFromLead", "phone", "linkedinUrl", "confidence", "reasoning"]`
- **Deviations:** None
- **Status:** Complete
