# Phase 132c — Per-Lead UI Surfacing

## Focus
Expose response timing in the product on a per-lead basis so operators can quickly see:
- setter response time after inbound(s)
- AI response time after inbound(s)
- AI chosen delay seconds and any scheduled-vs-actual drift

## Inputs
- Phase 132b outputs: populated `ResponseTimingEvent` rows
- Existing UI entry points:
  - `components/dashboard/crm-drawer.tsx` — Lead detail drawer (NOT `crm-view.tsx`, which is the list view)
  - Optional: `components/dashboard/action-station.tsx` — Active lead panel in inbox

## Work
1. Add server action at `actions/response-timing-actions.ts`:
   - `getLeadResponseTiming(leadId: string, opts?: { limit?: number })` → returns recent timing events
   - Query `ResponseTimingEvent` where `leadId` matches, ordered by `inboundSentAt desc`, limit N (default 10)
   - Enforce workspace access: use `resolveClientScope()` or verify `clientId` membership before querying
   - Resolve `setterSentByUserId` → email using existing Supabase admin lookup helpers (check `lib/supabase.ts` for `getSupabaseAdmin().auth.admin.getUserById()`)
   - Return shape: `{ success: boolean; data?: ResponseTimingRow[]; error?: string }`
   - Compute derived fields in the action (not in UI): `driftMs = aiResponseSentAt - aiScheduledRunAt`, `formatDuration()` helper for human-readable times

2. Add "Response Timing" section in `components/dashboard/crm-drawer.tsx`:
   - Display latest N anchors grouped by channel
   - For each anchor show:
     - Inbound message timestamp
     - Setter response time (formatted duration) + responder email, or "No setter response" if null
     - AI response time (formatted duration) + chosen delay + actual delay, or "No AI send" if null
     - Drift indicator if AI response: `aiResponseSentAt - aiScheduledRunAt` (positive = late, negative = early)
   - Use collapsible/accordion pattern to avoid overwhelming the lead detail view

3. Null-safety:
   - All setter fields can be null (no setter responded yet)
   - All AI fields can be null (no AI auto-send for this inbound)
   - Both can be filled (both setter and AI responded to the same inbound)
   - Handle gracefully with conditional rendering, not error boundaries

## Validation (RED TEAM)
- Verify workspace isolation: user A cannot see timing data for user B's leads
- Verify UI renders correctly when: (a) no timing events exist, (b) only setter responded, (c) only AI responded, (d) both responded
- Verify `setterSentByUserId` resolution doesn't N+1 query (batch resolve or cache user emails)

## Output
- Added server action `actions/response-timing-actions.ts:getLeadResponseTiming()` with workspace access enforcement (lead-scoped via `accessibleLeadWhere`).
- Added "Response Timing" section to `components/dashboard/crm-drawer.tsx` showing recent inbound anchors with:
  - Setter response time + setter email (when available)
  - AI response time + chosen/actual delay + drift (when available)
- Batched Supabase user email resolution via `getSupabaseUserEmailsByIds()` to avoid N+1.

## Handoff
Subphase 132d can add windowed analytics to bucket response timing and correlate with booking outcomes.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented per-lead response timing fetch + UI rendering in the CRM drawer.
- Commands run:
  - `rg` / `sed` — verified UI entrypoint and action wiring
- Blockers:
  - None
- Next concrete steps:
  - Add response timing analytics buckets + UI tab (Phase 132d).

## Assumptions / Open Questions (RED TEAM)
- User email resolution via Supabase admin API may be slow for many timing events. Consider caching user emails in-memory for the duration of the request if N > 5 unique `setterSentByUserId` values. (confidence: 90%)
