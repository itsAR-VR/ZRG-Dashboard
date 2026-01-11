# Phase 16b — Backend: Defaults + Filtered Export Endpoint

## Focus
Implement saved defaults and apply filters server-side when building the zip.

## Inputs
- Phase 16a `ExportChatgptOptions`
- Current endpoint: `app/api/export/chatgpt/route.ts`

## Work
- Add DB storage for defaults (if needed): `WorkspaceSettings.chatgptExportDefaults` (Text / JSON string).
- Add actions:
  - `getChatgptExportDefaults(clientId)` (auth + scope)
  - `setChatgptExportDefaults(clientId, opts)` (admin-scoped; validates/clamps)
- Update export endpoint to support:
  - query params that represent `ExportChatgptOptions` (plus `clientId`)
  - time-window filtering for messages via `Message.sentAt`
  - optional filtering by channel/direction
  - “positive only” lead selection:
    - include leads whose `sentimentTag` is in POSITIVE sentiments OR leads with at least one positive inbound message in the range (pick one, document it)
  - include/exclude files (leads.csv/messages.jsonl) in the zip
- Keep existing behavior as default when no extra params are provided.

## Output
- Persisted ChatGPT export defaults per workspace:
  - Prisma: added `WorkspaceSettings.chatgptExportDefaults` (JSON string) in `prisma/schema.prisma`.
  - Synced schema to DB via `npm run db:push`.
  - Server actions:
    - `actions/chatgpt-export-actions.ts` (`getChatgptExportDefaults`, `setChatgptExportDefaults`) using `requireClientAccess`.
- Updated export endpoint to honor filters + defaults:
  - `app/api/export/chatgpt/route.ts` now:
    - uses `opts` query param when present
    - otherwise falls back to `WorkspaceSettings.chatgptExportDefaults`
    - applies filters (positiveOnly, date range, channels, directions, include files) to produce smaller zips
    - keeps auth + workspace scoping via `resolveClientScope(clientId)`.

## Handoff
Phase 16c:
- Add the settings-icon modal UI next to the existing download button.
- Modal should load defaults via `getChatgptExportDefaults`, allow editing, support “Save defaults” via `setChatgptExportDefaults`, and “Download now” by navigating to `/api/export/chatgpt?clientId=...&opts=...`.
- Keep the main download button as one-click; backend will apply saved defaults when `opts` is omitted.
