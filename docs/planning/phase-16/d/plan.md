# Phase 16d — QA + Polish

## Focus
Validate correctness, usability, and ensure defaults behave as expected.

## Inputs
- Implemented backend + UI from Phase 16b/c

## Work
- Run `npm run lint` and `npm run build`.
- Verify:
  - default download uses saved defaults
  - modal “Download now” produces filtered zip
  - “Save defaults” persists and is reloaded on revisit
  - “All time + all leads” still works and matches prior behavior

## Output
- Validation:
  - `npm run lint` (warnings only) and `npm run build` succeeded.
  - DB schema synced: ran `npm run db:push` after adding `WorkspaceSettings.chatgptExportDefaults`.
- Behavior checks (code-level):
  - Main download button hits `/api/export/chatgpt?clientId=...` with no `opts`; backend falls back to saved defaults.
  - Modal “Download now” passes `opts` (JSON) to override defaults for that one download.

## Handoff
Optional follow-up: add “Export preview” counts (how many leads/messages will be included) before download.
