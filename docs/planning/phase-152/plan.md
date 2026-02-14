# Phase 152 — Fix Workspace Switch React #301 Crash (InboxView Effect Cascade)

## Purpose
Eliminate the production React #301 ("Too many re-renders") crash that occurs when users switch workspaces via the sidebar dropdown. Phase 149 hardened several dashboard loop vectors but this specific workspace-switch crash persists — confirmed by Jam `21f10fce` recorded 2026-02-14.

## Context
**Symptom:** Clicking a different workspace in the sidebar dropdown instantly crashes the app with React minified error #301. The `DashboardErrorBoundary` catches the error and logs `componentStack` pointing at InboxView's `LoadableComponent` tree. All network requests return 200 — this is purely a client-side render cascade.

**Jam evidence (21f10fce-1423-42fa-a53d-17f74eebd22c):**
- Console error: `[DashboardShell] client crash` with `componentStack` showing crash inside InboxView
- Context at crash: `activeView: "inbox"`, `activeWorkspace: "d9d759be-dc92-4346-92bb-d6aaf086a269"`
- User events: click workspace name → select new workspace → crash → 3 clicks on error boundary fallback
- All 18 network requests returned HTTP 200

**Prior mitigation (from handoff `2026-02-13-225641-workspace-switch-react-301.md`):**
- Added `DashboardErrorBoundary` with `componentStack` logging (working)
- Added key-based remount: `key={inbox:${workspaceKey}}` forces unmount/mount on workspace switch (did NOT fix the crash)
- Cleared `selectedLeadId` on manual workspace switch

**Root cause analysis:** InboxView has 5+ separate `useEffect` blocks that all fire when `activeWorkspace` changes. On key-based remount, all effects fire during mount. The critical trigger is `setActiveSentiments([])` at line 845 which creates a new array reference on every mount (`[] !== []` in JavaScript), causing a re-render that cascades through `normalizedSentiments` → `baseQueryOptions` → query key change → React Query re-execution → data change → auto-select effect → ActionStation effects → exceeding React's ~50 render update limit.

**Contributing factors:**
1. **Fragmented workspace effects** — 4 separate `useEffect([activeWorkspace])` blocks at lines 190, 196, 845, plus line 850 for `[initialConversationId]`, each independently triggering state updates and re-renders
2. **Unstable array reference** — `setActiveSentiments([])` always creates a new `[]` reference; React sees it as changed state
3. **No transition guard** — old InboxView unmounts and new InboxView mounts in the same commit; no clean break for effect cleanup
4. **ActionStation callback instability** — `fetchLinkedInStatus` callback reference changes on `conversation?.id` change, and the effect at line 519 depends on the callback itself

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 149 | Mostly complete | Same files: `inbox-view.tsx`, `action-station.tsx`, `dashboard-shell.tsx` | Phase 152 continues Phase 149's React #301 closure; preserve 149's existing guards while adding workspace-switch-specific fixes. |
| Phase 151 | Planned (not started) | `action-station.tsx` (SMS banner) | Phase 151d plans to add SMS banner UI in ActionStation; 152's callback stabilization is orthogonal — no conflict. |
| Phase 140/146 | Active (uncommitted `lib/` files) | No overlap | Uncommitted changes are in `lib/ai-drafts.ts`, `lib/ai-replay/*`, `lib/meeting-overseer.ts` — no dashboard component overlap. |

## Objectives
* [x] Remove unstable workspace sentiment reset churn in InboxView (`setActiveSentiments([])` -> functional setter bail-out)
* [ ] Consolidate fragmented workspace-dependent effects in InboxView into 1-2 stable effects
* [ ] Add workspace transition guard in DashboardShell to provide clean unmount/mount separation
* [ ] Stabilize ActionStation's callback dependency chain to prevent cascading effect re-fires
* [ ] Verify fix with build + lint + test gates, then manual production-parity testing

## Constraints
- Preserve Phase 149's existing render-loop hardening (insights-chat-sheet, sidebar counts, inbox refetch guard)
- Do not touch AI drafting/prompt/message/reply behavior paths (no NTTAN required)
- Keep scope to dashboard client surfaces only (3 files)
- Use functional setter bail-outs (`prev => prev === x ? prev : x`) to prevent unnecessary re-renders
- Maintain the key-based remount as a defense-in-depth layer (do not remove it)

## Success Criteria
- Workspace switching does not crash in a production build (`npm run build && npm start`)
- Rapid workspace switching (5+ times in succession) remains stable
- Deep-link URLs (`?leadId=xxx&clientId=yyy`) still resolve to correct workspace and lead
- Sentiment/SMS/score filters reset correctly on workspace switch
- Required quality gates pass:
  - `npm run lint`
  - `npm run build`
  - `npm test`

## Subphase Index
* a — Consolidate InboxView Workspace Effects (Primary Fix)
* b — Add DashboardShell Workspace Transition Guard
* c — Stabilize ActionStation Callback Chain + End-to-End Verification

## Phase Summary (running)
- 2026-02-14 06:46:02Z — Applied minimal InboxView render-loop fix by bailing out the workspace sentiment reset when already empty. Quality-gate run results: `npm run lint` pass (warnings only), `npm run build` pass, `npm test` fail due pre-existing concurrent `lib/*` test failure (`repairShouldBookNowAgainstOfferedSlots` in `lib/__tests__/meeting-overseer-slot-selection.test.ts`, assertion `null !== 2`). (files: `components/dashboard/inbox-view.tsx`, `docs/planning/phase-152/plan.md`, `docs/planning/phase-152/a/plan.md`, `docs/planning/phase-152/b/plan.md`, `docs/planning/phase-152/c/plan.md`)
- 2026-02-14 06:46:02Z — Attempted production-runtime smoke check with `npm start`; blocked by sandbox bind permissions (`listen EPERM 0.0.0.0:3000`), so live workspace-switch verification must be done on deployed environment.

## Open Questions (Need Human Input)
- Can you run the deployed workspace-switch repro (rapid 5-10 switches in inbox) and share whether React #301 is gone after this patch? This is required to decide whether 152b/152c are still necessary.
