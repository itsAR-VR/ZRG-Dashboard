# Phase 16c — Frontend: Modal UI + Settings Icon + Download Wiring

## Focus
Add a polished configuration modal next to the download button and persist defaults.

## Inputs
- Analytics header: `components/dashboard/analytics-view.tsx`
- Phase 16b actions for saved defaults

## Work
- Design direction (power-user, compact, “export builder”):
  - Treat the modal like a lightweight “dataset builder”: dense but readable, crisp labels, no fluff.
  - Use strong hierarchy: preset chips at top, filters in the middle, “Save defaults” + “Download now” as the only primary actions.
  - Make “what will happen” obvious: show a one-line summary string (e.g. “Positive only · Last 30d · Email+SMS · Inbound+Outbound · leads.csv+messages.jsonl”).
- Keep the existing “Download dataset for ChatGPT” button as the primary CTA:
  - clicking it downloads using the saved defaults (or sensible defaults if none saved).
- Add a settings icon button next to it:
  - opens a modal (Dialog) with “ChatGPT Export Settings”
  - shows:
    - lead selection (toggle positive-only)
    - time range (preset select + custom from/to inputs)
    - file inclusion (checkboxes)
    - message filters (channels + directions; multi-select via toggles)
  - footer actions:
    - “Save defaults”
    - “Download now” (uses current modal state; may or may not save)
- Use clear copy describing what the export includes and how filters affect it.

## Output
- Added a configurable ChatGPT export modal UI and kept the primary download as one-click:
  - New controls component: `components/dashboard/chatgpt-export-controls.tsx`
    - Primary “Download dataset for ChatGPT” button downloads using saved defaults (backend fallback, no `opts` param).
    - Settings icon opens modal to edit filters, “Save defaults”, and “Download now” (passes `opts`).
  - Wired into Analytics header: `components/dashboard/analytics-view.tsx` now uses `ChatgptExportControls`.

## Handoff
Phase 16d:
- Run `npm run lint` and `npm run build`.
- Sanity-check that:
  - main download uses saved defaults (set defaults, then click download without opening modal)
  - modal “Download now” uses the current selections
  - filters reduce dataset size (positive-only + last 7d should shrink output).
