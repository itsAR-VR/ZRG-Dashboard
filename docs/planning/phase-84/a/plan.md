# Phase 84a — Spintax Utility + Stable Selection Hashing

## Focus
Create a small, dependency-free Spintax parser/expander that supports `[[a|b|c]]`, plus a stable hashing strategy to “distribute across leads” deterministically.

## Inputs
- Phase 84 root plan (syntax + selection decisions)
- Existing template variable syntax in `lib/followup-template.ts` (`{...}` / `{{...}}`)

## Work
1. Add `lib/spintax.ts` exporting:
   - `expandSpintax(input, opts)` returning `{ ok: true, output }` or `{ ok: false, error }`
   - `validateSpintax(input)` returning `{ ok: true }` or `{ ok: false, error }` (syntax-only)
   - A stable hash helper (e.g., `fnv1a32`) used for deterministic option selection
2. Implement parsing rules:
   - Recognize `[[`…`]]` groups
   - Split on unescaped `|` into options
   - Disallow empty options (after trimming) and return a clear error
   - Support escapes for literal characters: `\\|`, `\\[`, `\\]`
   - Detect nested `[[` within a group and return a clear “nesting not supported” error (v1 constraint)
3. Define the option chooser contract:
   - Inputs: `seed` (string), `groupIndex` (0-based), `optionCount`
   - Output: chosen `optionIndex` within `[0, optionCount)`
4. Document exact error strings to reuse in UI/server validation (keep them stable for UX).

## Output
- `lib/spintax.ts` with a clear, minimal API suitable for server use (follow-up execution) and save-time validation.
- Implemented functions and stable error strings:
  - `expandSpintax(input, { seed, chooser? })` → `{ ok, output|error }`
  - `validateSpintax(input)` → `{ ok|error }`
  - `fnv1a32(input)` for deterministic hashing
  - Errors: `Spintax group is not closed (missing ]])`, `Spintax nesting is not supported`, `Spintax option cannot be empty`

## Validation (RED TEAM)

- `npm run lint` — no errors in new file
- `npm run build` — TypeScript compiles without errors
- Smoke test: `expandSpintax("[[a|b|c]]", { seed: "test", groupIndex: 0 })` returns one of a/b/c deterministically

## Handoff
- Phase 84b integrates `expandSpintax()` into `renderFollowUpTemplateStrict()` and threads a `seed` from call sites.
- Use `SPINTAX_ERRORS` from `lib/spintax.ts` for consistent UX messaging.
