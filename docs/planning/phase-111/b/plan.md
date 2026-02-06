# Phase 111b — Fix SMS Idempotent Disposition

## Focus
Fix the SMS multi-part idempotent send path in `actions/message-actions.ts` to derive disposition from the concatenated content of already-sent parts (ordered by `aiDraftPartIndex`) when all parts have been sent, instead of using the caller's current edit.

## Inputs
- `actions/message-actions.ts` — `approveAndSendDraftSystem()` function (lines 1135-1248)
  - Existing query at line 1190-1192: `select: { id: true, aiDraftPartIndex: true }` (does NOT include `body`)
  - Disposition computed at lines 1229-1233 using `finalContent` (caller's edit)
- Phase 111a output: email paths are now fixed
- Helper: `computeAIDraftResponseDisposition` from `lib/ai-drafts/response-disposition.ts`

## Work

### 1. Widen existing message query (line 1191)
```diff
  const existing = await prisma.message.findMany({
    where: { aiDraftId: draftId },
-   select: { id: true, aiDraftPartIndex: true },
+   select: { id: true, aiDraftPartIndex: true, body: true },
  });
```

### 2. Compute disposition content after pendingPartIndexes (after line 1203)
Insert after the `pendingPartIndexes` computation:
```ts
// Derive disposition content from sent bodies when all parts already sent.
let dispositionContent = finalContent;
if (pendingPartIndexes.length === 0 && existing.length > 0) {
  const sorted = [...existing].sort(
    (a, b) => (a.aiDraftPartIndex ?? 0) - (b.aiDraftPartIndex ?? 0)
  );
  const sentBodies = sorted.map((m) => m.body).filter(Boolean);
  if (sentBodies.length > 0) {
    dispositionContent = sentBodies.join("\n");
  }
}
```

### 3. Use dispositionContent for disposition (line 1232)
```diff
  const responseDisposition = computeAIDraftResponseDisposition({
    sentBy: opts.sentBy,
    draftContent: draft.content,
-   finalContent,
+   finalContent: dispositionContent,
  });
```

### Edge Cases
- **Partial sends** (some parts pending): `pendingPartIndexes.length > 0` → uses `finalContent` (caller's intent). This is correct because the remaining parts will be sent from `finalContent`.
- **Single-part SMS** (no multipart): `existing` has 0 or 1 entries; if all sent, `join("\n")` returns the single body. Disposition comparison works correctly.
- **Null body in existing messages**: `filter(Boolean)` skips nulls; if all null, falls back to `finalContent` via the `sentBodies.length > 0` guard.

### Validation
- Grep `actions/message-actions.ts` for `dispositionContent` — should appear in the new block and the disposition computation
- Existing test `"always persists responseDisposition for SMS draft approvals"` should still pass (it checks `status: "approved"` + `responseDisposition` presence, not the content)

## Output
- SMS idempotent path derives disposition from actual sent content when all parts are already sent
- Query widened to include `body` field
- Partial-send edge case handled correctly

## Handoff
Proceed to Phase 111c to harden stale-recovery concurrency.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Widened the existing-message lookup to include `body`.
  - Added `dispositionContent` derivation from already-sent message bodies (ordered by `aiDraftPartIndex`) when `pendingPartIndexes.length === 0`.
  - Used `dispositionContent` when computing `responseDisposition`.
- Commands run:
  - `rg -n "dispositionContent" actions/message-actions.ts` — pass (found new derivation + disposition usage)
- Blockers:
  - None
- Next concrete steps:
  - Execute Phase 111c (stale-sending recovery counter hardening).
