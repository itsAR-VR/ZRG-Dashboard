# Phase 111a — Fix Email Idempotent Disposition (4 Code Sites)

## Focus
Change all 4 email idempotent send paths to compute `responseDisposition` from the stored message body instead of the caller's current edit, aligning with the pattern already used by `stale-sending-recovery.ts` and Phase 110b.

## Inputs
- `actions/email-actions.ts` — Server Action email send with 2 idempotent paths:
  - `existingMessage` path (lines 88-91)
  - `afterClaimMessage` path (lines 156-159)
- `lib/email-send.ts` — System-level email send with identical 2 idempotent paths:
  - `existingMessage` path (lines 687-690)
  - `afterClaimMessage` path (lines 755-758)
- Both files already select `{ id: true, body: true, sentBy: true }` — no query changes needed
- Helper: `computeAIDraftResponseDisposition` from `lib/ai-drafts/response-disposition.ts`

## Work

### 1. `actions/email-actions.ts` — existingMessage path (line 91)
```diff
  const responseDisposition = computeAIDraftResponseDisposition({
    sentBy,
    draftContent: draft.content,
-   finalContent: messageContent,
+   finalContent: existingMessage.body,
  });
```

### 2. `actions/email-actions.ts` — afterClaimMessage path (line 159)
```diff
  const responseDisposition = computeAIDraftResponseDisposition({
    sentBy,
    draftContent: draft.content,
-   finalContent: messageContent,
+   finalContent: afterClaimMessage.body,
  });
```

### 3. `lib/email-send.ts` — existingMessage path (line 690)
```diff
  const responseDisposition = computeAIDraftResponseDisposition({
    sentBy,
    draftContent: draft.content,
-   finalContent: messageContent,
+   finalContent: existingMessage.body,
  });
```

### 4. `lib/email-send.ts` — afterClaimMessage path (line 758)
```diff
  const responseDisposition = computeAIDraftResponseDisposition({
    sentBy,
    draftContent: draft.content,
-   finalContent: messageContent,
+   finalContent: afterClaimMessage.body,
  });
```

### Validation
- Grep `actions/email-actions.ts` for `finalContent:` — should see `existingMessage.body` and `afterClaimMessage.body`
- Grep `lib/email-send.ts` for `finalContent:` — same
- No occurrence of `finalContent: messageContent` should remain in idempotent paths (the happy-path send still uses `messageContent`, which is correct)

## Output
- 4 email idempotent disposition sites now use stored message body (no fallback needed; `Message.body` is non-null)
- Updated code sites:
  - `actions/email-actions.ts` — `existingMessage.body`, `afterClaimMessage.body`
  - `lib/email-send.ts` — `existingMessage.body`, `afterClaimMessage.body`
- No query changes (body already selected)

## Handoff
Proceed to Phase 111b to fix the SMS idempotent disposition path.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Updated email idempotent send paths to compute `responseDisposition` from stored `Message.body`.
- Commands run:
  - `rg -n "finalContent:\\s*(existingMessage\\.body|afterClaimMessage\\.body)" actions/email-actions.ts lib/email-send.ts` — pass (4 matches)
- Blockers:
  - None
- Next concrete steps:
  - Execute Phase 111b (SMS idempotent disposition content).
