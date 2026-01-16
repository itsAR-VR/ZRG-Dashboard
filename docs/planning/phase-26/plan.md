# Phase 26 — Insights Chat UX v2 (Citations, Speed, Actionability)

## Purpose
Improve the Insights chatbot experience so answers are *trustworthy, fast, and actionable* by adding thread-level citations (deep-linking into Master Inbox), a ChatGPT-like “thinking” UX, and local caching for near-instant loads.

## Context
We already have an Insights Console with:
- Workspace-scoped sessions + shared history
- Context packs built from representative threads (booked/requested/negative)
- Read-only answers (no write tools enabled yet)

Pain points / requested upgrades:
- When the assistant references evidence from specific threads, users can’t see *which* threads those were or open them quickly.
- Users want a ChatGPT-like send flow: message posts instantly → “thinking” with model/effort shown → response.
- Sessions + messages should feel instant (local cache + background refresh).
- Insights should be easier to apply (clear “what to do next” cards + copyable templates), while staying read-only for now.

## Objectives
* [x] Add thread citations to assistant messages with one-click open in Master Inbox (`/?view=inbox&leadId=...`)
* [x] Add a “Sources” drawer per assistant message (deduped citations + previews)
* [x] Improve chat send UX (optimistic send + visible “thinking” stages + regenerate)
* [x] Add local cache for sessions/messages/packs with safe invalidation
* [ ] Add an actionability layer (recommendation cards + copy/paste messaging + links to relevant UI)

## Constraints
- Insights remains **read-only** (no lead/campaign/follow-up writes) unless explicitly toggled on later.
- Citations must only reference leads/threads the user has access to in the selected workspace (server-side enforced).
- Deep links must open the exact lead thread in the Master Inbox using existing routing conventions.
- Do not leak secrets/tokens in logs or persisted client storage.
- Keep changes focused to Insights Chat; avoid unrelated refactors.

## Success Criteria
- Assistant messages that reference “example threads” include citations; clicking opens the correct lead thread in Master Inbox.
- Each assistant message exposes a “Sources” view listing cited threads with quick-open and minimal previews.
- Sending a chat shows a staged state (Sent → Thinking → Answer) and feels responsive even while packs build.
- Sessions/messages load quickly on repeat visits via local cache, with background revalidation.
- Responses include a clear “Apply this” section with copyable text + links, improving operator workflow.
  - Note: copyable code blocks + a structured response nudge are shipped; dedicated “Apply this” cards are deferred.

## Subphase Index
* a — Citation schema + backend plumbing
* b — UI: citation chips, sources drawer, Master Inbox deep links
* c — UX: send pipeline, thinking state, regenerate, fast-seed + final answers
* d — Performance: local cache + revalidation strategy
* e — Actionability: “Apply this” cards + copy/paste templates + navigation links

## Phase Summary
- Added persisted, validated thread citations end-to-end (`prisma/schema.prisma`, `lib/insights-chat/chat-answer.ts`, `actions/insights-chat-actions.ts`).
- Rendered citation chips + per-message Sources dialog that opens the lead thread in Master Inbox (`components/dashboard/insights-chat-sheet.tsx`).
- Implemented ChatGPT-like UX for follow-ups (optimistic user send + “Thinking” bubble + regenerate without duplicating user messages) (`components/dashboard/insights-chat-sheet.tsx`, `actions/insights-chat-actions.ts`).
- Added localStorage SWR cache for sessions/messages/packs to speed repeat loads (`components/dashboard/insights-chat-sheet.tsx`).
- Improved “apply” workflow via copyable code blocks and a structured response prompt nudge (`components/dashboard/insights-chat-sheet.tsx`, `lib/ai/prompt-registry.ts`).
