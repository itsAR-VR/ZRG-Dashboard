# Phase 26b — UI: citation chips, sources drawer, Master Inbox deep links

## Focus
Make citations visible and usable: inline chips in the assistant message body and a “Sources” drawer that lists all cited threads with previews + one-click open.

## Inputs
- Citation schema + backend payload from Phase 26a
- Current Insights UI: `components/dashboard/insights-chat-sheet.tsx`
- Existing route conventions for opening a lead in inbox: `/?view=inbox&leadId=<leadId>`

## Work
1. Render citations inline:
   - For each assistant message, show small citation “chips” (e.g., `Thread 3 · Booked`) either inline at the end of the bullet that uses it or appended under the paragraph.
2. Add per-message “Sources” affordance:
   - Button/label under assistant message (e.g., “Sources (7)”).
   - Drawer/modal lists deduped citations with:
     - Lead name/email (optional) + campaign + sentiment/outcome
     - preview snippet
     - “Open in Inbox” button (`/?view=inbox&leadId=...`)
3. Deep-link behavior:
   - Prefer opening in a new tab for safety (doesn’t destroy the Insights context), but allow same-tab option later.
4. Improve message formatting:
   - Tighten markdown typography and spacing.
   - Ensure long responses wrap and don’t overflow container (no right-side cut-off).
5. Track user interactions:
   - On “Open in Inbox” click, record a lightweight telemetry/audit event (optional for v1).

## Output
- Implemented citations UI in `components/dashboard/insights-chat-sheet.tsx`:
  - Assistant messages now render citation chips (ref + outcome) that open the lead thread in Master Inbox in a new tab.
  - Added a per-message “Sources” dialog listing all cited threads with lead label, outcome, campaign name, optional note, and “Open in Inbox”.
- Wired message loading to include citations:
  - `getInsightChatMessages()` now returns `citations`, and the client stores them per message.

## Handoff
Phase 26c improves the end-to-end send/think/respond UX and integrates citations cleanly into the chat flow.
