# Phase 101a — Schema + Disposition Helper

## Focus
Add a draft-level outcome field to persist whether a response was auto-sent, approved as-is, or edited, and centralize the logic in a small helper.

## Inputs
- Monday item `11177342525`
- Existing models:
  - `AIDraft` (holds draft content + auto-send metadata)
  - `Message` (outbound attribution via `sentBy`, `sentByUserId`, and `aiDraftId`)
- Locked decisions:
  - strict compare for “Edited”
  - per-draft counting
  - no backfill

## Work
1. Update `prisma/schema.prisma`:
   - Add enum `AIDraftResponseDisposition` with values: `AUTO_SENT`, `APPROVED`, `EDITED`
   - Add nullable field `AIDraft.responseDisposition AIDraftResponseDisposition?`
   - Add `@@index([responseDisposition], name: "AIDraft_responseDisposition_idx")` (explicit name for deterministic migrations)
2. Run DB sync: `npm run db:push`
3. Add helper `lib/ai-drafts/response-disposition.ts`:
   - Export `computeAIDraftResponseDisposition({ sentBy, draftContent, finalContent })`
   - TypeScript signature:
     ```ts
     export function computeAIDraftResponseDisposition(params: {
       sentBy: "ai" | "setter" | null | undefined;
       draftContent: string;
       finalContent: string;
     }): "AUTO_SENT" | "APPROVED" | "EDITED"
     ```
   - Rules:
     - `sentBy === "ai"` → `AUTO_SENT` (even if content differs — AI edits its own draft)
     - else if `finalContent !== draftContent` → `EDITED`
     - else → `APPROVED`

## Validation (RED TEAM)
- `npm run db:push` succeeds without errors
- `npx prisma generate` shows new enum and field
- Import helper from test file without errors

## Output
- Schema updated and pushed (`AIDraftResponseDisposition`, `AIDraft.responseDisposition`, index)
- Helper module added: `lib/ai-drafts/response-disposition.ts`

## Handoff
Proceed to Phase 101b to set `responseDisposition` in all successful draft send/approve paths.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added `AIDraftResponseDisposition` enum and `responseDisposition` field with index in `prisma/schema.prisma`.
  - Added helper `computeAIDraftResponseDisposition` in `lib/ai-drafts/response-disposition.ts`.
  - Ran `npm run db:push` to sync schema.
- Commands run:
  - `npm run db:push` — pass (Prisma schema synced to DB)
- Blockers:
  - None
- Next concrete steps:
  - Implement disposition persistence in send paths (Phase 101b).
