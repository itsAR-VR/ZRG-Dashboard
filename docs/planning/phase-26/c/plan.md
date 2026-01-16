# Phase 26c — UX: send pipeline, thinking state, regenerate, fast-seed + final answers

## Focus
Deliver a ChatGPT-like chat loop: instant user message, visible “thinking” (model + effort + stage), and a clear path to regenerate. Preserve the “fast seed answer → full answer” flow.

## Inputs
- Current Insights session/message model and send flow
- Existing fast-seed + context-pack building primitives in `actions/insights-chat-actions.ts`
- UI entry point: `components/dashboard/insights-chat-sheet.tsx`

## Work
1. Three-stage UX for every send:
   - Stage 1: user message posts immediately (optimistic UI).
   - Stage 2: assistant placeholder bubble shows:
     - selected model + reasoning effort
     - stage label (e.g., “Extracting threads…”, “Synthesizing pack…”, “Answering…”)
   - Stage 3: stream/append the answer when ready.
2. Fast seed → full answer:
   - Show a seed answer quickly with an “Updating…” badge.
   - When the full answer completes, append or replace with a clearly marked “Updated” message (keep the seed visible for audit, but de-emphasize).
3. Regenerate behavior:
   - Add “Regenerate” for the last assistant response.
   - Regenerate should reuse the existing context pack when present; if pack is stale, allow “Recompute pack” separately.
4. Model/effort selection in-chat:
   - Move/duplicate model + reasoning selectors into the chat header (per-session default).
   - Ensure each message stores which model/effort produced it (for audit).
5. Cancel / retry:
   - If a request is taking too long, allow cancel and surface retries.

## Output
- Implemented ChatGPT-like send loop in `components/dashboard/insights-chat-sheet.tsx`:
  - Follow-up sends are now optimistic: user message appears instantly.
  - Added an assistant “Thinking” bubble that shows `model · effort` while the server is answering.
  - When building a pack (seed question), the UI shows a live stage label (Selecting → Extracting → Synthesizing) as a thinking bubble until the first answer lands.
- Added follow-up regeneration (keeps old answers):
  - New server action `regenerateInsightsChatFollowupAnswer()` creates a new assistant message (no duplicate user message).
  - UI exposes a “Regenerate” button (only when follow-up messages exist) and appends the regenerated assistant reply.
- Updated server response shape for faster UI updates:
  - `sendInsightsChatMessage()` now returns created message IDs + timestamps + citations so the UI can append without a full reload.

## Handoff
Phase 26d adds local caching and revalidation so repeated usage feels instant and resilient across reloads.
