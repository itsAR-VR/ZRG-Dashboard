# Phase 101e — Tests + Validation Checklist

## Focus
Add targeted unit tests for the disposition logic and verify the feature through repo gates + a small manual smoke checklist.

## Inputs
- `computeAIDraftResponseDisposition` helper (Phase 101a)
- Existing test harness: `scripts/test-orchestrator.ts` (manual file registration)
- Concurrent phase note: `scripts/test-orchestrator.ts` already modified in Phase 100; merge carefully.

## Work
1. Add unit test: `lib/ai-drafts/__tests__/response-disposition.test.ts`
   - Test cases:
     ```ts
     // Core cases
     test("sentBy=ai returns AUTO_SENT", () => { ... })
     test("sentBy=ai with edited content still returns AUTO_SENT", () => { ... })
     test("sentBy=setter with identical content returns APPROVED", () => { ... })
     test("sentBy=setter with different content returns EDITED", () => { ... })

     // Edge cases
     test("sentBy=null or undefined defaults to setter logic", () => { ... })
     test("whitespace-only difference counts as EDITED", () => { ... })
     ```

2. Register test file in `scripts/test-orchestrator.ts`:
   - File is **modified** in working tree; read current content and merge carefully.
   - Append new entry to `TEST_FILES` array:
     ```ts
     const TEST_FILES = [
       // ... existing 19 entries ...
       "lib/ai-drafts/__tests__/response-disposition.test.ts",
     ];
     ```

3. Run gates:
   - `npm run test` — all tests pass
   - `npm run lint` — no errors
   - `npm run build` — succeeds

4. Manual smoke checklist:
   - [ ] Send SMS draft unchanged (setter) → DB shows `APPROVED`
   - [ ] Send SMS draft with edits (setter) → DB shows `EDITED`
   - [ ] Trigger email auto-send (AI) → DB shows `AUTO_SENT`
   - [ ] Check Analytics → "AI Draft Response Outcomes" card shows counts
   - [ ] Change date window → counts update
   - [ ] Email counts are 0 for SETTER_MANAGED campaigns

## Validation (RED TEAM)
- Test file uses `import { describe, test, assert } from "node:test"`
- Test file doesn't import Prisma (pure function test)
- Test orchestrator has exactly one new entry appended

## Output
- Passing test suite and build/lint
- Confirmed end-to-end tracking in UI + analytics (manual)

## Handoff
Phase complete when all Success Criteria in `docs/planning/phase-101/plan.md` are met.
