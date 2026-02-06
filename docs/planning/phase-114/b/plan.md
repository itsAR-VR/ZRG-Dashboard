# Phase 114b — AI Ops Feed Backend (Last 3 Days)

## Focus
Add a unified "AI Ops" event feed backend that merges `AIInteraction` + `MeetingOverseerDecision` activity for the last 72 hours.

Auth: workspace admins (via `requireClientAdminAccess`) and true super-admins. (The Admin Dashboard tab is workspace-admin scoped.)

## Inputs
- New action: `actions/ai-ops-feed-actions.ts` → `listAiOpsEvents`
- Prisma models:
  - `AIInteraction` (`prisma/schema.prisma:1288-1319`) — featureId, promptKey, status, latencyMs, tokens
  - `MeetingOverseerDecision` (`prisma/schema.prisma:1062-1083`) — stage (`"extract"` | `"gate"` | `"booking_gate"`), confidence, payload (JSON)
- Auth helper: `requireClientAdminAccess` from `lib/workspace-access.ts`
- Verified featureId values:
  - `"followup.booking.gate"` — booking gate decisions
  - `"meeting.overseer.extract"` — overseer intent extraction
  - `"followup.parse_proposed_times"` — proposed-time parsing
  - `"auto_send.evaluate"` — auto-send confidence evaluation
- Also included: `"meeting.overseer.gate"` (overseer draft gate)

## Work
1. Implement `actions/ai-ops-feed-actions.ts`:
   - Auth: `requireClientAdminAccess(clientId)`
   - Window: `createdAt >= now - 72h` and `createdAt < cursor` (when provided)
   - Query `AIInteraction` for featureIds:
     - `followup.booking.gate`
     - `meeting.overseer.extract`
     - `meeting.overseer.gate`
     - `followup.parse_proposed_times`
     - `auto_send.evaluate`
   - Query `MeetingOverseerDecision` for stages:
     - `extract`
     - `gate`
     - `booking_gate`
   - Map to a non-PII DTO (`AiOpsEvent`) and merge-sort by `createdAt desc`
   - Filters supported: `leadId`, `featureId`, `stage`, `decision`, `status`
   - Pagination: `nextCursor = last.createdAt` when page is full

2. PII guard:
   - Do not return `AIInteraction.metadata` wholesale (only derived, safe summaries)
   - Do not return `MeetingOverseerDecision.payload` wholesale
   - For overseer `extract`: omit `evidence` and any free-form text fields
   - For gate/booking_gate: surface only `decision` and `issuesCount` (no issues text)

## Key Files
- `actions/ai-ops-feed-actions.ts` — `listAiOpsEvents` + `AiOpsEvent` type
- `prisma/schema.prisma` — read-only (no changes; indexes sufficient)

## Validation (RED TEAM)
- Test: `listAiOpsEvents` returns merged results from both tables, sorted by `createdAt` desc
- Test: PII guard — no raw message text in response payloads
- Test: unauthorized user gets error (not workspace-admin)
- Test: empty result set for workspace with no AI activity in last 72h
- Test: pagination cursor advances correctly
- Test: featureId / stage / decision filters work independently and combined

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented `listAiOpsEvents` in `actions/ai-ops-feed-actions.ts` (AIInteraction + MeetingOverseerDecision, last 72h, cursor pagination).
  - Enforced a strict allowlist: no raw `metadata` or raw `payload` returned (derived safe fields only).
- Commands run:
  - N/A (code + plan updates only in this turn)
- Blockers:
  - None
- Next concrete steps:
  - 114c: build the Admin Dashboard UI panel and wire it to `listAiOpsEvents`.
  - 114d: add feed tests + run `npm test`, `npm run lint`, `npm run build`.

## Output
- `actions/ai-ops-feed-actions.ts`: backend feed for Admin Dashboard (last 3 days).

## Handoff
Proceed to 114c (Admin Dashboard UI panel). Ensure UI does not attempt to render raw payload/metadata fields.
