# Phase 95d — Tests + Verification

## Focus
Add targeted unit tests for the new fast regen + Slack button wiring, then validate with lint/build and a manual sanity checklist.

## Inputs
- Phase 95a core module (✅ complete): `lib/ai-drafts/fast-regenerate.ts`
- Phase 95b Slack integration (✅ complete): `lib/auto-send/orchestrator.ts`, `app/api/webhooks/slack/interactions/route.ts`
- Phase 95c server action + UI updates (pending)
- Existing tests:
  - `lib/auto-send/__tests__/orchestrator.test.ts`
  - `lib/ai-drafts/__tests__/step3-verifier.test.ts`

## Work

### 1) Unit tests: Slack DM blocks include `Regenerate`
File: `lib/auto-send/__tests__/orchestrator.test.ts`
- Add/extend assertions that the review-needed Slack blocks include:
  - Button with `action_id === "regenerate_draft_fast"`
  - The JSON `value` parses and includes:
    - `draftId`, `leadId`, `clientId`, `cycleSeed`, `regenCount`

### 2) Unit tests: archetype cycling
Add file: `lib/ai-drafts/__tests__/fast-regenerate.test.ts`
- Test `pickCycledEmailArchetype({ cycleSeed, regenCount })`:
  - `regenCount=0` yields a valid archetype id
  - `regenCount=1` yields a different id than `regenCount=0` (with the +1 offset rule)
  - Wrap-around after 10

### 3) Unit tests: channel clamps
In `lib/ai-drafts/__tests__/fast-regenerate.test.ts`, add deterministic tests for:
- SMS clamp (<= 320 chars)
- LinkedIn clamp (<= 800 chars)

(These tests should not call OpenAI. Mock `runTextPrompt` or structure the module so clamp utilities are testable without model calls.)

### 4) Edge case tests (RED TEAM)
In `lib/ai-drafts/__tests__/fast-regenerate.test.ts`, add:

```ts
// Empty previousDraft returns error without calling AI
test("fastRegenerateDraftContent rejects empty previousDraft", async () => {
  const result = await fastRegenerateDraftContent({
    clientId: "test",
    leadId: "test",
    channel: "email",
    sentimentTag: "Neutral",
    previousDraft: "", // empty
  });
  assert.equal(result.success, false);
  assert.ok(result.error?.includes("empty"));
});

// Archetype cycling wrap-around at index 10
test("pickCycledEmailArchetype wraps around after 10", () => {
  const seed = "test-seed";
  const archetype9 = pickCycledEmailArchetype({ cycleSeed: seed, regenCount: 9 });
  const archetype10 = pickCycledEmailArchetype({ cycleSeed: seed, regenCount: 10 });
  // Should wrap around and be different from archetype9
  assert.notEqual(archetype9.id, archetype10.id);
});

// Malformed Slack button value is handled gracefully
// (This test goes in orchestrator.test.ts or interactions route test)
test("handleRegenerateFast handles malformed JSON gracefully", async () => {
  // Mock action.value = "invalid json"
  // Assert no crash, returns error response
});
```

### 5) Local verification
Run:
- `npm run lint`
- `npm run build`

### 6) Manual QA checklist (minimum)
Dashboard:
- [ ] Open a lead with an AI draft → verify `Fast Regen` + `Full Regen` render.
- [ ] Click `Fast Regen` repeatedly → verify content changes quickly and doesn't error; email structure changes across clicks.
- [ ] Click `Full Regen` → verify existing behavior still works.
- [ ] Verify `Fast Regen` produces draft < 10s.
- [ ] Verify `Compose with AI` still works when no AI draft exists.

Slack (if configured locally):
- [ ] Trigger an auto-send review DM.
- [ ] Verify `Regenerate` button appears alongside `Edit in dashboard` and `Approve & Send`.
- [ ] Click `Regenerate` → Slack message preview updates and buttons still function.
- [ ] Click `Approve & Send` afterward → email sends and Slack message moves to the completed state.

## Validation (RED TEAM)

Before marking this phase complete, verify:
- [ ] All unit tests pass: `npm test`
- [ ] `npm run lint` passes (may have warnings, 0 errors)
- [ ] `npm run build` passes
- [ ] No Prisma schema changes required
- [ ] `AIInteraction` telemetry shows `draft.fast_regen.*` feature IDs after testing

## Output
- Added unit tests:
  - `lib/ai-drafts/__tests__/fast-regenerate.test.ts` (archetype cycling + channel clamp helper)
  - Updated `lib/auto-send/__tests__/orchestrator.test.ts` to assert Slack blocks include `regenerate_draft_fast` and value JSON is well-formed.
- Verification runs:
  - `npm test` ✅
  - `npm run lint` ✅ (warnings only; 0 errors)
  - `npm run build` ✅

## Handoff
If all checks pass, the phase is ready to implement/merge. If Slack manual QA isn't possible locally, capture screenshots/log output and rely on unit tests + a staging verification.
