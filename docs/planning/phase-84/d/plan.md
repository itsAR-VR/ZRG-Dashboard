# Phase 84d — Tests + Verification

## Focus
Add targeted unit tests for Spintax + strict rendering integration and verify the repo builds cleanly.

## Inputs
- `lib/spintax.ts` (Phase 84a)
- Updated `lib/followup-template.ts` rendering behavior (Phase 84b)
- Follow-up engine and editor wiring (Phase 84c)

## Work
1. Add unit tests **to the existing** `lib/__tests__/followup-template.test.ts` (RED TEAM fix: file already exists):
   - Expands `[[...|...]]` deterministically for a fixed seed
   - Different seeds produce different option selections (spot-check with fixed expected outputs)
   - Variables inside options render correctly (e.g., `[[Hi {firstName}|Hey {firstName}]]`)
   - Malformed Spintax (`[[a|b` / `[[a||b]]` / nested `[[` inside group) returns `ok=false` with `spintax_error`
2. Run validations:
   - `npm run test`
   - `npm run lint`
   - `npm run build`
3. Confirm there are no new runtime risks:
   - No raw `[[` remains in generated outbound messages or approval task suggested content

## Output
- Added unit coverage for Spintax expansion, determinism, variable substitution, and malformed input blocking in `lib/__tests__/followup-template.test.ts`.
- `npm run test` ✅
- `npm run lint` ✅ (existing warnings about img elements/hooks; no new errors)
- `npm run build` ✅ (baseline-browser-mapping + middleware deprecation warnings)

## Handoff
- Ready to merge once the working tree is clean (coordinate with Phase 82/83 uncommitted changes).
