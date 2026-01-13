# Phase 17c — Eliminate 300s Timeouts (Bulk Sync Redesign)

## Focus
Prevent “Sync All” from doing unbounded work in a single server action (which can hit Vercel’s 300s runtime timeout).

## Inputs
- `actions/message-actions.ts` (`syncAllConversations`)
- `components/dashboard/inbox-view.tsx` (`handleSyncAll`)

## Work
1. Added cursor + time budget (`maxSeconds`) support to `syncAllConversations`.
2. Removed expensive side effects from bulk sync by default (draft regeneration + bounce cleanup).
3. Updated Inbox UI to run “Sync All” in 60-second chunks and show progress; state persists via `syncAllCursor`.

## Output
- Chunked bulk sync with progress fields: `actions/message-actions.ts`
- UI chunk runner + progress toast: `components/dashboard/inbox-view.tsx`
- Verified build: `npm run build`.

## Handoff
Proceed to Phase 17d to document Owen’s current DB state and outline confirmatory steps (webhook log coverage + key validation) post-deploy.

