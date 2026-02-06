# Phase 111d — Test Updates + Validation

## Focus
Update the regression test file to enforce body-based disposition (flipping the Phase 106 assertions), add SMS disposition coverage, and run the full validation checklist.

## Inputs
- `lib/__tests__/response-disposition-idempotent.test.ts` — existing test (44 lines)
  - Lines 14-16: asserts `existingMessage.body` is NOT used (must flip)
  - Lines 18-20: asserts `afterClaimMessage.body` is NOT used (must flip)
  - Lines 22: asserts `finalContent: messageContent` is used (must remove/change)
  - Lines 28-36: same for `lib/email-send.ts` (must flip)
  - Lines 39-43: SMS test (may need update for `dispositionContent`)
- `lib/__tests__/stale-sending-recovery.test.ts` — existing test (should still pass)
- Phase 111a/b/c code changes

## Work

### 1. Flip email-actions.ts test (lines 11-23)
Replace the test body:
```ts
it("persists responseDisposition when email draft already has a message", () => {
  const source = read("actions/email-actions.ts");
  assert.match(source, /existingMessage[\s\S]*responseDisposition/, "expected responseDisposition update in existingMessage path");
  assert.ok(
    source.includes("existingMessage.body"),
    "existingMessage idempotent path should compute disposition from stored sent body"
  );
  assert.ok(
    source.includes("afterClaimMessage.body"),
    "after-claim idempotent path should compute disposition from stored sent body"
  );
});
```

### 2. Flip email-send.ts test (lines 25-37)
Replace the test body:
```ts
it("persists responseDisposition for system email idempotent path", () => {
  const source = read("lib/email-send.ts");
  assert.match(source, /existingMessage[\s\S]*responseDisposition/, "expected responseDisposition update in existingMessage path");
  assert.ok(
    source.includes("existingMessage.body"),
    "existingMessage idempotent path should compute disposition from stored sent body"
  );
  assert.ok(
    source.includes("afterClaimMessage.body"),
    "after-claim idempotent path should compute disposition from stored sent body"
  );
});
```

### 3. Update SMS test (lines 39-43)
Add assertion for `dispositionContent` and `body` in select:
```ts
it("always persists responseDisposition for SMS draft approvals", () => {
  const source = read("actions/message-actions.ts");
  assert.ok(!source.includes("pendingPartIndexes.length > 0 ? { responseDisposition } : {}"));
  assert.match(source, /status:\s*"approved"[\s\S]*responseDisposition/);
  assert.ok(
    source.includes("dispositionContent"),
    "SMS idempotent path should derive disposition from sent bodies"
  );
});
```

### 4. Validation Checklist
Run all in sequence:
1. `npm run lint` — no errors
2. `npm run build` — succeeds
3. `node --import tsx --test lib/__tests__/response-disposition-idempotent.test.ts` — passes with new assertions
4. `node --import tsx --test lib/__tests__/stale-sending-recovery.test.ts` — passes
5. Grep verification:
   - `grep -n "finalContent:" actions/email-actions.ts` — idempotent paths use `.body`
   - `grep -n "finalContent:" lib/email-send.ts` — same
   - `grep -n "dispositionContent" actions/message-actions.ts` — present

## Output
- Regression tests enforce body-based disposition for email and sent-body-based disposition for SMS
- All lint/build/test checks pass
- Phase 111 is complete

## Handoff
Phase 111 complete. All idempotent disposition paths are now consistent with `stale-sending-recovery.ts` and Phase 110b's approach.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Updated `lib/__tests__/response-disposition-idempotent.test.ts` to enforce body-based disposition for email + sent-body-based disposition for SMS.
  - Ran lint/build and targeted tests.
- Commands run:
  - `node --import tsx --test lib/__tests__/response-disposition-idempotent.test.ts` — pass
  - `node --import tsx --test lib/__tests__/stale-sending-recovery.test.ts` — pass
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Blockers:
  - None
- Next concrete steps:
  - Run Phase 111 review (`phase-review`) and write `docs/planning/phase-111/review.md`.
