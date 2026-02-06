# Phase 114c — Admin Dashboard Panel (AI Ops: Last 3 Days)

## Focus
Add an "AI Ops (Last 3 Days)" panel component to the Admin Dashboard tab that lets workspace admins inspect recent AI/automation activity (booking gate, overseer extract, proposed-time parse, auto-send eval) without exposing raw message text.

## Inputs
- Backend: `actions/ai-ops-feed-actions.ts` → `listAiOpsEvents` (from 114b)
- Admin mount point: `components/dashboard/admin-dashboard-tab.tsx` — `ConfidenceControlPlane` is the last component at line 582
- Auth check: `requireClientAdminAccess` (workspace admin) for the feed; settings controls remain super-admin only
- Existing UI patterns: Shadcn `Table`, `Card`, `Badge`, `Button` from `components/ui/`

## Work
1. **Create `components/dashboard/ai-ops-panel.tsx`:**
   - Accept `clientId: string` prop
   - Call `listAiOpsEvents(clientId)` on mount with default 72h window, limit 50
   - Display results in a table:
     - Columns: Timestamp, Lead ID (truncated), Event Type (featureId or stage), Decision/Status, Confidence, Latency (ms), Tokens
     - Color-coded decision badges: green = approve, amber = needs_clarification, red = deny, gray = error/null
   - Filters (above table):
     - Event type dropdown (featureId values + overseer decision stages)
     - Decision filter (approve / deny / needs_clarification / all)
     - Lead ID text input
   - Pagination: "Load more" button that passes `cursor` from previous response
   - Empty state: "No AI events in the last 3 days"
   - Error state: graceful message on fetch failure

2. **Mount in `admin-dashboard-tab.tsx`:**
   - Import `AiOpsPanel` from `./ai-ops-panel`
   - Add `<AiOpsPanel clientId={clientId} />` after `<ConfidenceControlPlane clientId={clientId} />` (line 582)
   - This is a 2-line change (import + JSX)

3. **PII guard in UI:**
   - Never render raw message text (backend enforces this too, but UI should not attempt to display `metadata` or `payload` fields that could contain message text)
   - If showing "issues" from gate decisions, render as a count or brief list (not raw LLM output)

4. **Permission handling in UI:**
   - Component handles the case where `listAiOpsEvents` returns an error (non-workspace-admin sees nothing or a brief permission message)
   - Don't hide the section entirely — show a graceful "Requires workspace admin access" if unauthorized

## Key Files
- `components/dashboard/ai-ops-panel.tsx` — **new file**
- `components/dashboard/admin-dashboard-tab.tsx` — add import + mount (2 lines, after line 582)

## Validation (RED TEAM)
- Visual: panel renders with sample data, filters work, pagination works
- PII: no raw message text visible in DOM or network payloads
- Auth: non-workspace-admin sees appropriate empty/permission state
- Build: `npm run build` succeeds with new component
- Responsive: table is scrollable on smaller viewports

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented `components/dashboard/ai-ops-panel.tsx` (filters + table + cursor pagination) and wired it to `actions/ai-ops-feed-actions.ts`.
  - Mounted panel in `components/dashboard/admin-dashboard-tab.tsx` after `ConfidenceControlPlane`.
- Commands run:
  - N/A (code + plan updates only in this turn)
- Blockers:
  - None
- Next concrete steps:
  - 114d: add tests for the feed + day-only expansion and run `npm test`, `npm run lint`, `npm run build`.

## Output
- `components/dashboard/ai-ops-panel.tsx`: new "AI Ops (Last 3 Days)" panel.
- `components/dashboard/admin-dashboard-tab.tsx`: mount `AiOpsPanel`.

## Handoff
Proceed to 114d (tests + validation + phase review).
