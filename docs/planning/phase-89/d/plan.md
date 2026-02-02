# Phase 89d — Tests + Verification Runbook

## Focus
Add unit test coverage for weighted round-robin selection + gating, and provide a short manual verification runbook for Founders Club.

## Inputs
- Phase 89b logic changes in `lib/lead-assignment.ts`
- Phase 89c configuration UI/actions
- Existing test harness: `npm run test` (`scripts/test-orchestrator.ts`)

## Work
1. Unit tests
   - Add a new test file: `lib/__tests__/lead-assignment.test.ts`
   - Test cases to cover:
     - Sequence order with duplicates: `A,B,A,B,C` repeats correctly
     - Filtering out inactive setters from the stored sequence
     - Empty-after-filter sequence causes assignment to be skipped (pointer does not advance)
     - Email-only gating skips non-email leads (lead without `emailBisonLeadId`/`emailCampaignId`)
     - Email-only gating allows email leads (lead WITH email attribution)
     - Pointer behavior from `-1` (first assignment goes to index 0)
     - Pointer wrap-around (after last index, returns to 0)
     - Empty sequence falls back to active setters
     - Concurrency: verify FOR UPDATE lock prevents drift (mock or integration test)
   - **Test registration (RED TEAM — CRITICAL):** The `scripts/test-orchestrator.ts` uses **MANUAL file registration** via the `TEST_FILES` array (not auto-discovery). You MUST add the new test file to this array:
     ```typescript
     const TEST_FILES = [
       // ... existing entries ...
       "lib/__tests__/lead-assignment.test.ts",  // Phase 89
     ];
     ```
   - Without this step, `npm run test` will NOT run the new tests (they will be silently skipped).
2. Manual verification (Founders Club)
   - Pre-req: ensure Founders Club has `roundRobinEnabled=true`.
   - Configure:
     - Setters: Vee, JD, Jon, Emar
     - Sequence: `Vee, JD, Vee, JD, Emar` (Jon omitted)
     - Email-only: ON
   - Verify by observing 10 new positive email leads:
     - Expected assignments: `Vee, JD, Vee, JD, Emar, Vee, JD, Vee, JD, Emar`
   - Confirm Jon receives no new assigned leads; existing Jon leads remain assigned.
3. Repo validation
   - Run: `npm run test`, `npm run lint`, `npm run build`.

## Output
- Added unit tests for Phase 89 helpers (`lib/__tests__/lead-assignment.test.ts`) and registered them in `scripts/test-orchestrator.ts`.
- Automated tests validate core sequence + gating helpers.
- Clear runbook exists for configuring and confirming the change in Founders Club.

## Completed (2026-02-02)
- ✅ `npm run test` (pass)
- ✅ `npm run lint` (warnings only)
- ✅ `npx next build --webpack` (pass; Turbopack build is blocked in the Codex sandbox due to port binding restrictions)

## Validation (RED TEAM)

1. **Test registration verified:**
   ```bash
   grep -n "lead-assignment.test.ts" scripts/test-orchestrator.ts
   # Must show the file in TEST_FILES array
   ```

2. **Tests run and pass:**
   ```bash
   npm run test
   # Should include lead-assignment tests in output
   ```

3. **Founders Club manual verification:**
   - [ ] Configure setters: Vee, JD, Jon, Emar
   - [ ] Configure sequence: `Vee, JD, Vee, JD, Emar` (Jon omitted)
   - [ ] Enable round robin + email-only
   - [ ] Trigger 10 positive email leads (via webhook or manual sentiment update)
   - [ ] Verify assignments: Vee → JD → Vee → JD → Emar → repeat
   - [ ] Verify Jon receives 0 new assignments
   - [ ] Verify existing Jon leads unchanged

4. **Build validation:**
   ```bash
   npm run lint

   # NOTE: Next.js 16 defaults to Turbopack, which requires binding a localhost port for loader evaluation.
   # The Codex sandbox disallows port binding, so validate with webpack in this environment:
   npx next build --webpack
   ```

## Handoff
Phase 89 is ready for implementation and verification once the working tree is clean/merged with concurrent phases (notably Phase 83 schema changes).
