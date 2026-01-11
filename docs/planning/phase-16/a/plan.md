# Phase 16a — Export Filter Spec + Persistence Model

## Focus
Define what is filterable for ChatGPT export and where defaults are stored.

## Inputs
- Current export: `app/api/export/chatgpt/route.ts` (always exports all leads + all messages)
- Current analytics download button: `components/dashboard/analytics-view.tsx`
- Workspace settings storage: `WorkspaceSettings` (Prisma)

## Work
- Define an `ExportChatgptOptions` shape for:
  - `leadSelection`: `all` | `positive_only`
  - `timeRangePreset`: `all_time` | `7d` | `30d` | `90d` | `custom`
  - `from`/`to` (ISO) when preset is `custom`
  - `includeLeadsCsv` (default true)
  - `includeMessagesJsonl` (default true)
  - `messageDirections`: `inbound`/`outbound` (multi)
  - `channels`: `sms`/`email`/`linkedin` (multi)
  - `messagesWithinRangeOnly` (if a time window is set; default true)
- Decide persistence:
  - Store defaults per workspace in DB (recommended: `WorkspaceSettings.chatgptExportDefaults` as JSON text).
  - Server actions: `getChatgptExportDefaults(clientId)`, `setChatgptExportDefaults(clientId, opts)`.

## Output
- Defined the shared export options contract (client-safe) in `lib/chatgpt-export.ts`:
  - `ChatgptExportOptions` (versioned, filters + file toggles)
  - `DEFAULT_CHATGPT_EXPORT_OPTIONS`
  - helpers: `normalizeChatgptExportOptions`, `parseChatgptExportOptionsJson`, `computeChatgptExportDateRange`, `buildChatgptExportUrl`, `getChatgptExportOptionsSummary`
- Persistence decision:
  - Store per-workspace defaults on `WorkspaceSettings.chatgptExportDefaults` as a JSON string representing `ChatgptExportOptions` (validated via `normalizeChatgptExportOptions` on read/write).

## Handoff
Phase 16b:
- Add `WorkspaceSettings.chatgptExportDefaults` (text) to Prisma schema and sync DB.
- Add server actions to get/set defaults.
- Update `app/api/export/chatgpt/route.ts` to:
  - accept `opts` query param (JSON)
  - fall back to saved defaults when `opts` is omitted
  - apply filters to leads/messages for smaller zips.
