# Phase 144a Performance Baseline

Captured: 2026-02-11 22:23:34 EST

## Commands Run
- `npm run build`
- root payload script against `.next/server/app/page/build-manifest.json`
- `du -sk .next/static/chunks && find .next/static/chunks -type f | wc -l`
- `rg --files components/dashboard -g "*.tsx" | xargs wc -l | sort -nr`
- `rg -n "staleTime|refetchOnWindowFocus|refetchIntervalInBackground" components/providers/query-provider.tsx`
- `rg -n "POLLING_INTERVAL|REALTIME_HEARTBEAT_INTERVAL|refetchInterval|visibilityState|activeConversationLastFetchedAtRef" components/dashboard/inbox-view.tsx`
- `rg -n "activeView !== \"inbox\"|visibilitychange|setInterval\(|canFetch|getInboxCounts" components/dashboard/sidebar.tsx`

## Baseline Reference (from phase root)
- Prior baseline: 405 KB raw / 123 KB gzip (`rootMainFiles`)

## Current Root Payload (`rootMainFiles`)
- Total raw: **415,060 bytes**
- Total gzip: **122,932 bytes**

| Chunk | Raw (bytes) | Gzip (bytes) |
|---|---:|---:|
| `static/chunks/9c58b91b5e296cbe.js` | 3,889 | 1,414 |
| `static/chunks/4c33e481093e8daf.js` | 40,592 | 12,728 |
| `static/chunks/cf0aad1aef31db4e.js` | 21,191 | 5,906 |
| `static/chunks/cb6e64d730297f09.js` | 214,873 | 67,366 |
| `static/chunks/904f5809de03888a.js` | 38,886 | 8,713 |
| `static/chunks/08dcfc3b15383cd6.js` | 85,647 | 22,890 |
| `static/chunks/turbopack-58970cfc4bb0b48d.js` | 9,982 | 3,915 |

## Chunk Footprint
- `.next/static/chunks`: **3260 KB**
- Chunk files: **50**

## Polyfill Chunk
- No file matching `*polyfill*` or `*polyfills*` was found in `.next/static/chunks` in this build output.

## Dynamic Loadable Mapping (app/page)
`react-loadable-manifest.json` currently maps six dynamic entries (keys):
- `171202`, `339647`, `777080`, `780661`, `807617`, `809143`

## Dashboard LOC Hotspots (top)
- `components/dashboard/settings-view.tsx` — 9164
- `components/dashboard/crm-drawer.tsx` — 2000
- `components/dashboard/settings/integrations-manager.tsx` — 1953
- `components/dashboard/insights-chat-sheet.tsx` — 1945
- `components/dashboard/action-station.tsx` — 1430
- `components/dashboard/analytics-view.tsx` — 1355
- `components/dashboard/inbox-view.tsx` — 1122

## Query / Polling Reality
- Query defaults: `staleTime=30s`, `refetchOnWindowFocus=false`, `refetchIntervalInBackground=false`
- Inbox polling constants now present:
  - `POLLING_INTERVAL=30000`
  - `REALTIME_HEARTBEAT_INTERVAL=60000`
- Sidebar polling now gated by:
  - `activeWorkspace`
  - `activeView === "inbox"`
  - document visibility

## Multi-Agent Coordination Notes
- Working tree is highly concurrent/dirty across phases 139-143.
- To avoid collision, this turn touched only low-overlap performance surfaces:
  - `components/dashboard/inbox-view.tsx`
  - `components/dashboard/sidebar.tsx`
  - `components/providers/query-provider.tsx`
  - `components/dashboard/conversation-card.tsx`
  - `components/dashboard/insights-view.tsx`

## Gaps / Remaining Baseline Work
- `@next/bundle-analyzer` not yet configured, so treemap attribution is still missing.
- INP protocol execution is not captured yet (requires manual browser interaction sampling).
- 5-minute idle HTTP request count baseline is not yet captured in a controlled browser run.
