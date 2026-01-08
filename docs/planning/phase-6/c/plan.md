# Phase 6c — Fix “isFromLead” Defaulting + Add Fallbacks

## Focus
Prevent parse failures from causing incorrect “not from lead” decisions and ensure enrichment still proceeds safely when appropriate.

## Inputs
- Phase 6b updated extractor outputs (including “unknown” / error categories).
- Email webhook flow that consumes signature extraction results.

## Work
1. Change decision logic so:
   - Parse failure → `isFromLead: "unknown"` (not `false`).
   - Only skip signature extraction when confident it’s not from lead (explicit `false` from a valid parse).
2. Add deterministic fallbacks:
   - If AI is unknown/fails, run regex-based contact extraction on the cleaned body/signature section.
3. Ensure we don’t incorrectly overwrite lead contact fields when confidence is low.
4. Add safe logs/metrics:
   - Error category + leadId/clientId (no email/name/body).

## Output
- **Tri-state sender decision:** `SignatureExtractionResult.isFromLead` is now `"yes" | "no" | "unknown"` so AI/parse failures no longer default to `"no"`:
  - Implemented in `lib/signature-extractor.ts` and propagated to callers.
- **Webhook behavior fix:** `enrichLeadFromSignature()` now:
  - skips only on `isFromLead === "no"` (explicit assistant/not-lead)
  - treats `isFromLead === "unknown"` as inconclusive and avoids misleading logs
  - attempts a cautious regex fallback on the signature tail (only when it appears to match the sender) via `extractPhoneFromText()` / `extractLinkedInFromText()` with no PII logging
  - changes in `app/api/webhooks/email/route.ts`
- **PII-safe logging:** signature extraction logs no longer print phone/LinkedIn values in webhook logs.

## Handoff
Run end-to-end verification + monitoring checks (Phase 6d), including `node scripts/repro-signature-ai-parse.js`, and a webhook simulation case where the model output is truncated (ensuring we do not log raw content and do not incorrectly claim “not from lead”).
