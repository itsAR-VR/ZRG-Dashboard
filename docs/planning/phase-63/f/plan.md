# Phase 63f — Validation: Tests + Runbook + Phase Wrap-up

## Focus
Add targeted tests for phone normalization, provide a deploy/runbook, and mark Phase 63 success criteria complete.

## Inputs
- `scripts/test-orchestrator.ts`
- `lib/__tests__/*`

## Work
- [x] Add unit tests for phone normalization (global edge cases).
- [x] Add `docs/planning/phase-63/runbook.md` with post-deploy verification steps.
- [x] Run `npm test`, `npm run lint`, `npm run build`.
- [x] Update Phase 63 root plan with completion checkmarks and a short summary.

## Output
- Added targeted unit coverage for global/E.164 resolution + storage behavior:
  - `lib/__tests__/phone-normalization.test.ts`
- Build + test validation:
  - `npm test` ✅
  - `npm run lint` ✅ (warnings only)
  - `npm run build` ✅
- Fixed issues found during validation:
  - `libphonenumber-js` + `tsx` CommonJS metadata interop (switch to core + explicit metadata + types)
  - Avoid BigInt literals under TS target < ES2020
  - Prisma `groupBy` `orderBy` type mismatch (`_count._all` → `_count.id`)
  - Removed leftover `resolveClientScope()` references (replace with `requireAuthUser()` + `accessibleClientWhere()`)
  - Narrowed Calendly access token into a stable local string for type safety
  - Added missing `clientId` selection for GHL contact hydration path

## Handoff
- Deploy and follow `docs/planning/phase-63/runbook.md`.
- After deploy, export Vercel logs and run `npm run logs:check -- <exported.json>` to confirm the known error signatures are gone.
