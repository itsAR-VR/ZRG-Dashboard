# Phase 27d — Concurrent Sessions + Per-Session State

## Focus
Remove global “sending” / polling locks so users can run multiple inquiries at once (multiple sessions in-flight), without state collisions.

## Inputs
- Phase 27a–c outputs
- Current global state in `components/dashboard/insights-chat-sheet.tsx`:
  - `sending`, `pendingAssistant`, `activePackBuildRef`, `pollCancelRef`

## Work
- Make in-flight state session-scoped:
  - Track pending/sending states keyed by `sessionId` (and optionally `contextPackId`).
  - Allow “New session” and sidebar navigation while another session is building/answering.
- Ensure background pack building doesn’t collide:
  - Convert single `activePackBuildRef` to a map (or queue) keyed per session/pack.
  - Add a lightweight throttle so we don’t DDOS our own API if a user starts many sessions.
- UI affordances:
  - Show per-session status in the sidebar (e.g., “Building…” / “Answering…”).
  - Keep send box enabled for the active session unless that specific session is in a state that requires waiting.

## Output
- Replaced global chat state with per-session maps so concurrent sessions don’t overwrite each other:
  - `messagesBySession`, `packBySession`, `sendingBySession`, `pendingAssistantBySession`
  - Pack build loops are tracked per `contextPackId` via `activePackBuildsRef` (no more single global cancel token).
- Sidebar now shows lightweight per-session status (“Building…” / “Answering…”) to make concurrency understandable.
- “Stop waiting” now cancels only the active session’s pack polling (without restarting automatically).
- Code: `components/dashboard/insights-chat-sheet.tsx`

## Handoff
Run a quick UI QA pass:
- Start a seed question in Session A (pack building) → switch to Session B → start another seed question; verify no cross-session message/pack clobbering.
- Verify you can still open Campaign scope + set CUSTOM window while another session is in-flight.
