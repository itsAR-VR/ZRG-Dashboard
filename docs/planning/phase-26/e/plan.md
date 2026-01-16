# Phase 26e — Actionability: “Apply this” cards + copy/paste templates + navigation links

## Focus
Make insights immediately usable by turning conclusions into concrete recommended tests and operator actions, without enabling write-tools yet.

## Inputs
- Citation support (Phase 26a/26b) for evidence-backed recommendations
- Improved send UX (Phase 26c) and caching (Phase 26d)
- Existing analytics + campaign data already available in Insights context

## Work
1. Standard response structure:
   - Encourage assistant outputs to follow a consistent template:
     - Summary
     - What’s working (with citations)
     - What’s not working (with citations)
     - Recommended experiments/tests (step-by-step)
     - Copy/paste messaging examples (subject/body/SMS)
2. Render “Apply this” cards:
   - Each card includes: action description, expected KPI change, where to apply, and a “Copy” button.
   - Include deep links to relevant areas (campaign settings, analytics, lead thread examples).
3. Save/share:
   - Allow marking an assistant message as “Saved takeaway” for the workspace (read-only persistence).
4. Guardrails for future write-tools:
   - Visually show disabled “Create experiment / Change mode” buttons with an explanation and an admin-only enable path (future phase).

## Output
- Improved actionability without enabling write-tools:
  - Prompt: `insights.chat_answer.v2` now nudges a consistent structure (Summary → What’s working → What’s not → Tests → Copy/paste templates).
  - UI: added “Copy” for fenced code blocks in `components/dashboard/insights-chat-sheet.tsx` so templates can be applied quickly.
- Deferred (future follow-up phase) for v2:
  - Dedicated “Apply this” cards (structured actions array) and saved takeaways.
  - Deep links beyond lead threads (campaign settings/analytics) once routing targets are standardized.

## Handoff
Phase 26 is ready for validation + polish:
- Run `npm run lint` / `npm run build`.
- Smoke test citations + regenerate + cache behavior in the Insights UI.
