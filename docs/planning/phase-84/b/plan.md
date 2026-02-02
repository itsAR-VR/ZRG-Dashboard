# Phase 84b — Integrate Spintax into Strict Template Rendering

## Focus
Extend strict follow-up template rendering so it can safely expand Spintax and then apply existing variable validation/substitution.

## Inputs
- `lib/followup-template.ts` current strict renderer + error types
- `lib/spintax.ts` from Phase 84a
- Selection rule: “distribute across leads” (stable per lead+step)

## Work
1. Update `lib/followup-template.ts` types:
   - Add `FollowUpTemplateError` variant for Spintax failures (e.g., `{ type: "spintax_error"; message: string }`)
2. Update `renderFollowUpTemplateStrict()` signature to accept an optional Spintax seed:
   - `renderFollowUpTemplateStrict({ template, values, spintaxSeed?: string })` (or equivalent)
3. Rendering algorithm (decision complete):
   1. Start with `template` string.
   2. If `spintaxSeed` is provided and the template contains `[[`, run `expandSpintax(...)` to get a concrete template.
      - Use chooser: `optionIndex = hash(`${seed}:${groupIndex}`) % optionCount`
   3. Extract tokens from the expanded template only (so missing-value checks apply only to the chosen variant).
   4. Validate:
      - Unknown tokens → error
      - Missing referenced values → error
      - Spintax parse/expand error → error
   5. Substitute tokens and return output.
4. Ensure errors are formatted consistently with existing behavior (`formatTemplateErrors()` in `lib/followup-engine.ts`).
5. **Update `formatTemplateErrors()` in `lib/followup-engine.ts:389`** to handle the new `spintax_error` type gracefully (RED TEAM fix).
6. Keep backward compatibility for templates without Spintax (no behavior changes).

## Output
- Updated `lib/followup-template.ts` strict renderer and exported types to support Spintax expansion.
- Added new error variant `spintax_error` and optional `spintaxSeed` parameter.
- `lib/followup-engine.ts` now treats `spintax_error` as a workspace-blocking reason (`invalid_spintax`).

## Validation (RED TEAM)

- `npm run lint` — no errors
- `npm run build` — TypeScript compiles without errors
- Verify: `renderFollowUpTemplateStrict({ template: "[[Hi|Hey]] {firstName}", values: { firstName: "Ava" }, spintaxSeed: "test" })` returns `{ ok: true, output: "Hi Ava" }` or `"Hey Ava"` deterministically

## Handoff
- Phase 84c updates `lib/followup-engine.ts` to pass `spintaxSeed` and adds save-time validation + UI feedback.
- Ensure follow-up subject rendering passes the same `spintaxSeed` as message rendering.
