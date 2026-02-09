# Phase 125a — Indexless Availability Refresh Replacements

## Focus
Replace the brittle index-based AI replacement protocol for availability refresh with an indexless protocol (`oldText/newText`), then apply replacements deterministically and safely by locating unique `oldText` occurrences in the draft.

## Inputs
- Root phase plan: `docs/planning/phase-125/plan.md`
- Jam: `ff2470b8-f70d-49e5-ad96-e12b27f3f1ba` (refresh fails with "Could not safely refresh availability...")
- Current implementation:
  - `lib/availability-refresh-ai.ts` (structured JSON prompt + validator)
  - `lib/draft-availability-refresh.ts` (maps `validation_failed:*` to user-facing error)

## Work
1. **Define two-type design** (RED TEAM GAP-2 fix):
   - Keep `AvailabilityReplacement` type unchanged: `{ startIndex, endIndex, oldText, newText }` — this is the INTERNAL type used by `applyValidatedReplacements()`.
   - Add a NEW AI response type: `AiReplacementPair = { oldText: string, newText: string }` — what the model returns.
   - The validator bridges the two: takes `AiReplacementPair[]` in, produces `AvailabilityReplacement[]` out.

2. **Update ALL THREE contracts in lockstep** (RED TEAM GAP-3 fix):
   - `AvailabilityRefreshAiResponse` TypeScript type (line 26-30): change `replacements` from `AvailabilityReplacement[]` to `AiReplacementPair[]`.
   - JSON schema object (lines 179-201): remove `startIndex` and `endIndex` from `items.properties` and `items.required`. Keep `oldText` and `newText` only. Since `strict: true` is used, the model CANNOT return extra fields.
   - Validator function signature: change input from `AvailabilityReplacement[]` to `AiReplacementPair[]`.

3. **Update `systemFallback` prompt** (line 165-177):
   - Add rule: "Return replacements as `{ oldText, newText }` pairs only. Do NOT include startIndex or endIndex."
   - Require `oldText` be an exact substring from the draft (verbatim).
   - Require `newText` be selected verbatim from `AVAILABLE_SLOTS`.

4. **Implement locate-based validation** (new `validateAvailabilityReplacements` logic):
   - `replacements` must be an array and `replacements.length <= CHUNK_SIZE`.
   - `newText` must be in the candidate label set → error: `new_text_not_candidate`.
   - `newText` must not be duplicated (including via `usedNewTexts`) → error: `duplicate_new_text`.
   - `oldText` must be non-empty → error: `invalid_old_text`.
   - `newText` must be non-empty → error: `invalid_new_text`.
   - `oldText` must exist in the current draft → error: `old_text_not_found`.
   - Safety: `oldText` must occur EXACTLY ONCE in the current draft → error: `old_text_not_unique`.
   - Convert each pair into `{ startIndex, endIndex, oldText, newText }` by calling `draft.indexOf(oldText)`.
   - Ensure computed ranges do not overlap → error: `overlapping_ranges`.
   - Return `{ ok: true, replacements: AvailabilityReplacement[] }` on success.
   - **Removed error codes** (no longer applicable): `invalid_indices`, `out_of_bounds`, `old_text_mismatch`.

5. **Leave `applyValidatedReplacements()` unchanged** — it still receives `AvailabilityReplacement[]` with indices and applies back-to-front.

6. **Preserve error semantics**:
   - Return `validation_failed:<reason>` when unsafe (new reasons: `invalid_old_text`, `invalid_new_text`, `old_text_not_found`, `old_text_not_unique`).
   - Keep prompt key stable: `availability.refresh.inline.v1`.
   - Multi-pass flow inherently benefits: `oldText` is validated against the current draft state per-pass, eliminating cross-pass index drift (RED TEAM GAP-5).

## Validation
- Implemented and verified via Phase 125c quality gates (`npm test`, `npm run lint`, `npm run build`).
- The JSON schema no longer includes `startIndex` or `endIndex` in required fields.
- The prompt text explicitly forbids indices.

## Output
- Updated `lib/availability-refresh-ai.ts` implementing the new contract + validation + replacement logic.

## Handoff
- Phase 125b should confirm `validation_failed:*` still maps to the same user-facing error and add non-PII failure logging that includes the new validation failure reasons.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Updated `lib/availability-refresh-ai.ts` so the model returns `{ oldText, newText }` only (no indices) and validation computes ranges by locating unique `oldText` occurrences.
  - Updated JSON schema + prompt rules to forbid `startIndex/endIndex` and enforce strict pair output.
- Commands run:
  - `npm test` — pass
  - `npm run lint` — pass (warnings only, pre-existing)
  - `npm run build` — pass
- Blockers:
  - None
- Next concrete steps:
  - Complete Phase 125b (non-PII failure logging) and Phase 125c (tests + QA) are already executed in this same Terminus run; see corresponding subphase plans.
