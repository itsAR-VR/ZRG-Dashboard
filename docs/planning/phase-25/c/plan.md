# Phase 25c — ChatGPT-like Visual Polish

## Focus
Improve the overall UX/aesthetics of the Insights Console so it feels closer to ChatGPT: cleaner spacing, consistent typography, readable message formatting, and a sidebar that scans well.

## Inputs
- Updated layout from Phase 25b.
- Current message rendering and markdown components in `components/dashboard/insights-chat-sheet.tsx`.

## Work
- Message readability + formatting:
  - Keep the existing assistant Markdown rendering (headings/lists/code/links) and ensure it remains the default for assistant messages.
  - Confirm user/system messages retain `whitespace-pre-wrap` for faithful display.
- Chat UX polish (ChatGPT-like behavior):
  - Add an auto-scroll-to-latest behavior so when a session loads or a new message arrives the view lands on the most recent content.
  - Keep the composer anchored and unchanged (send, enter-to-send, stop waiting).
- Ensure interactivity remains intact:
  - Seed send, follow-up send, recompute, regenerate, admin actions.

## Output
- Added “scroll to latest” behavior in `components/dashboard/insights-chat-sheet.tsx` using a bottom sentinel + effect, improving usability for long threads.
- Preserved and verified assistant response formatting (Markdown rendering) for cleaner, structured outputs.

## Handoff
Proceed to Phase 25d to verify across breakpoints, run lint/build, and validate the original repro is resolved.
