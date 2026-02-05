# Phase 107e — Token Budgeting Hardening (Bytes-Based)

## Focus
Make token estimation and truncation more robust by basing estimates on UTF-8 byte length (“file size”) and ensuring truncation does not introduce invalid UTF-8. This supports reliable Knowledge Assets budgeting and the Prompt Dashboard “Runtime Context Preview”.

## Inputs
- User request: “ensure token budget is higher … do a token count function based on all the knowledge assets and file sizes, make this super robust”.
- Existing utilities added in Phase 107b:
  - `lib/ai/token-estimate.ts`
  - `lib/knowledge-asset-context.ts`
  - `lib/auto-send-evaluator-input.ts`
- Prompt modal preview added in Phase 107c:
  - `components/dashboard/settings-view.tsx`

## Work
1. Update token estimation to derive from UTF-8 bytes (not JS string length), so “file size” drives the estimate.
2. Make truncation byte-budgeted and UTF-8-safe (avoid inserting replacement characters when slicing).
3. Update Knowledge Assets context builder to:
   - compute per-asset token estimates from bytes
   - track included bytes/tokens for the *actual snippet* included
4. Update Prompt Dashboard runtime preview to compute token totals from bytes in a single pass.
5. Re-run quality gates:
   - `npm test`
   - `npm run lint`
   - `npm run build`

## Output
- Byte-based token estimation and UTF-8-safe truncation:
  - `lib/ai/token-estimate.ts`
- Knowledge Assets context stats now derive token counts from bytes (and includedBytes reflects trimmed snippet content):
  - `lib/knowledge-asset-context.ts`
- Prompt modal runtime preview token totals now derive from bytes:
  - `components/dashboard/settings-view.tsx`

## Handoff
- If token counting needs to be *exact* (model-tokenizer accurate), prefer using the existing OpenAI input-token counting path in `lib/ai/token-budget.ts` (API-based), and keep the bytes-based estimator as the offline fallback/preview.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Switched token estimation to be UTF-8 byte-based and made truncation byte-budgeted + UTF-8-safe.
  - Updated Knowledge Assets context stats and UI preview to match the byte-based estimator.
- Commands run:
  - `npm test` — pass (144 tests)
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Blockers:
  - None (offline-only hardening).
- Next concrete steps:
  - Perform the live verification steps from Phase 107d (EmailBison thread body/threading + evaluator pricing case + prompt override runtime).
