# Phase 101b — Persist Disposition on Send Paths

## Focus
Write the disposition value onto `AIDraft` at the moment a pending draft is successfully sent, across all channels, without accidentally backfilling older drafts.

## Inputs
- `AIDraft.responseDisposition` from Phase 101a
- `computeAIDraftResponseDisposition` helper
- Working-tree note: email draft send paths may use an intermediate `status="sending"` claim/lock to prevent duplicate sends
- Existing send paths:
  - SMS: `actions/message-actions.ts` → `approveAndSendDraftSystem()`
  - Email (server action): `actions/email-actions.ts` → `sendEmailReply()`
  - Email (system/CLI-safe): `lib/email-send.ts` → `sendEmailReplyForDraftSystem()`
  - LinkedIn: `actions/message-actions.ts` → `approveAndSendDraft()` LinkedIn branch

## Work

**Pre-flight:** Read current content of `actions/email-actions.ts` and `lib/email-send.ts` to check for Phase 100 changes. Integrate disposition tracking with existing logic.

1. SMS (`approveAndSendDraftSystem` in `actions/message-actions.ts:1134`):
   - **Before** `coerceSmsDraftPartsOrThrow`: compute `finalContent = opts.editedContent ?? draft.content`
   - **After** all parts sent successfully and before marking draft approved:
     ```ts
     const responseDisposition = computeAIDraftResponseDisposition({
       sentBy: opts.sentBy,
       draftContent: draft.content,
       finalContent,
     });
     await prisma.aIDraft.update({
       where: { id: draftId },
       data: { status: "approved", responseDisposition },
     });
     ```

2. Email draft send (server action `sendEmailReply` in `actions/email-actions.ts:41`):
   - **Idempotency branch (lines 72-80):** Do NOT set disposition — draft was already processed in a prior call
   - **Success path (line 161):** Change to:
     ```ts
     const responseDisposition = computeAIDraftResponseDisposition({
       sentBy: opts.sentBy,
       draftContent: draft.content,
       finalContent: messageContent, // = editedContent || draft.content
     });
     await prisma.aIDraft.update({ where: { id: draftId }, data: { status: "approved", responseDisposition } });
     ```

3. Email draft send (system `sendEmailReplyForDraftSystem` in `lib/email-send.ts:598`):
   - Mirror server action behavior:
     - Line 710: Change to include `responseDisposition` in the update

4. LinkedIn manual send (`approveAndSendDraft` in `actions/message-actions.ts:1244`):
   - After `sendLinkedInMessage` succeeds (line 1305):
     ```ts
     const responseDisposition = computeAIDraftResponseDisposition({
       sentBy: "setter",
       draftContent: draft.content,
       finalContent: editedContent || draft.content,
     });
     await prisma.aIDraft.update({
       where: { id: draftId },
       data: { status: "approved", responseDisposition },
     });
     ```

5. Guardrails (critical):
   - **Never** set disposition in idempotency/early-return branches
   - **Only** set disposition after the underlying provider send succeeded
   - Import helper at top of each file: `import { computeAIDraftResponseDisposition } from "@/lib/ai-drafts/response-disposition"`

## Validation (RED TEAM)
- `npm run lint` passes (no import errors)
- `npm run build` passes
- Manual test: send SMS draft unchanged → check DB for `APPROVED`
- Manual test: edit and send email draft → check DB for `EDITED`

## Output
- All new successful sends from AI drafts write `AIDraft.responseDisposition`
- Historical drafts remain `null` (no backfill)
- Files updated: `actions/message-actions.ts`, `actions/email-actions.ts`, `lib/email-send.ts`

## Handoff
Proceed to Phase 101c to query disposition counts for Analytics (scoped + windowed).

## Progress This Turn (Terminus Maximus)
- Work done:
  - Pulled Monday.com item `11177342525` (AI Bugs + Feature Requests); no additional columns or updates were populated beyond the title.
  - Verified send-path function anchors exist (`approveAndSendDraftSystem`, `approveAndSendDraft`, `sendEmailReply`, `sendEmailReplyForDraftSystem`).
  - Implemented `responseDisposition` updates in SMS, email (server + system), and LinkedIn send paths.
- Commands run:
  - `monday.get_board_items_page` / `monday.get_board_info` / `monday.all_monday_api` — returned item details; no updates found
  - `rg -n "approveAndSendDraftSystem|approveAndSendDraft\\(|sendEmailReply\\(|sendEmailReplyForDraftSystem"` — confirmed function locations
- Blockers:
  - None.
- Next concrete steps:
  - Move to Phase 101c (analytics action).
