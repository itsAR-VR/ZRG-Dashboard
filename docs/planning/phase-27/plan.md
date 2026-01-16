# Phase 27 — Insights Console Reliability + Concurrency

## Purpose
Fix the remaining reliability and UX issues in the Insights Console (sessions cache-first load, campaign scope with custom windows, concurrent inquiries) and resolve the OpenAI `json_schema` error breaking chat answers.

## Context
Phase 26 shipped citations + improved chat UX, but the current implementation still has:

- **OpenAI 400s**: `Invalid schema for response_format 'insights_chat_answer' … Missing 'note'` (citations item schema has `note` in `properties` but not in `required`).
- **Cache-first load feels slow**: sessions sidebar hides cached sessions behind a “Loading…” state; overall cache hydration is not instantaneous.
- **Campaign scope + custom window**: selecting a custom window appears to break campaign scoping in the UI and/or the request payload.
- **No parallel inquiries**: global `sending` / polling state prevents creating/sending in another session while one pack/answer is in progress.

Jams to reproduce:
- `https://jam.dev/c/34f0fc9d-178d-4b6e-a1c0-0133b8483ada`
- `https://jam.dev/c/27a746f7-587f-4911-9ef6-85fc936e91f3`

## Objectives
* [x] Eliminate the OpenAI schema error and restore stable chat answering
* [x] Make sessions + messages render immediately from local cache (no “empty state” flicker)
* [x] Ensure campaign scope works for all window presets, including CUSTOM
* [x] Allow multiple sessions to run concurrently without UI state collisions

## Constraints
- Keep Insights **read-only** (no automated writes like sentiment changes, follow-up edits, campaign mode edits).
- Avoid broad refactors; keep changes scoped to Insights chat + pack build flow.
- Preserve citations contract: only server-validated refs become clickable sources.
- Don’t bundle unrelated changes in the eventual push.

## Success Criteria
- [x] No `400 Invalid schema for response_format` errors when sending seed/follow-up messages.
- [x] Sessions sidebar shows cached sessions instantly and does not hide the list while refreshing.
- [x] Selecting CUSTOM window still allows campaign scope selection (and avoids silent custom-range fallbacks).
- [x] User can create a new session and send a seed question while another session is building a pack / answering, with no cross-session UI corruption.

## Subphase Index
* a — Fix OpenAI `json_schema` contract (citations)
* b — Cache-first load UX (sessions/messages/packs)
* c — Campaign scope with CUSTOM window
* d — Concurrent sessions + per-session send/build state

## Phase Summary
- Fixed OpenAI `json_schema` strict output validation for citations (`note` is now required + nullable).
- Improved cache-first UX by keeping cached sessions visible while refreshing, and persisting last-selected session in localStorage.
- Unblocked campaign scope for CUSTOM windows (campaign dialog no longer disables; CUSTOM now requires valid start/end).
- Made Insights Console concurrency-safe via per-session state maps + per-pack build loops; added per-session “Building/Answering” indicators.

Key files:
- `lib/insights-chat/chat-answer.ts`
- `components/dashboard/insights-chat-sheet.tsx`
- `docs/planning/phase-27/*`
