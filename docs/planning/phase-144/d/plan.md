# Phase 144d — Wave 3: Render-Churn Elimination + INP Tuning

## Focus
Improve interaction responsiveness by removing avoidable rerender work in high-frequency dashboard paths.

## Inputs
- `docs/planning/phase-144/a/perf-baseline.md`
- `docs/planning/phase-144/b/wave1-delta.md`
- `docs/planning/phase-144/c/wave2-delta.md`
- Render hotspot files:
  - `components/dashboard/inbox-view.tsx`
  - `components/dashboard/conversation-feed.tsx`
  - `components/dashboard/conversation-card.tsx`
  - `components/dashboard/action-station.tsx`
  - `components/dashboard/settings-view.tsx`

## Work
1. **Memoize ConversationCard** (prime INP target):
   - Wrap `ConversationCard` export in `React.memo` with a custom comparator checking `conversation.id`, `conversation.lastMessageTime`, `isActive`, `isSyncing`.
   - Memoize `formatDistanceToNow` result (called on every render, 232 LOC component rendered N times in virtualizer).
   - Memoize `onClick` callback in the parent (`conversation-feed.tsx`) to prevent identity churn.
2. **Stabilize expensive useMemo paths**:
   - `inbox-view.tsx` line 349: `conversations` useMemo runs filtering + sorting on every data change. Profile — if >5ms with 100+ conversations, consider moving filter/sort to server action or narrowing dependency array.
   - `action-station.tsx` lines 271-315: `filteredMessages` and `messageCounts` useMemo depend on multiple state variables. Profile whether any dependencies change on every keystroke in compose mode; narrow dependency arrays if so.
3. **Evaluate `useTransition` for expensive state updates**:
   - Wrap `setActiveView` and `setActiveWorkspace` state updates in `app/page.tsx` with `useTransition` to keep UI responsive during view switches.
   - Currently used in `crm-drawer.tsx` and `reactivations-view.tsx` but NOT in the main view switch path.
4. **Audit prop stability**:
   - Verify `workspaces` prop passed from `app/page.tsx` to `Sidebar` has stable reference (not recreated on every render). If derived, wrap in `useMemo`.
   - Check if the `conversations` data from React Query `useInfiniteQuery` creates new array references on every poll even when data hasn't changed (React Query structural sharing should prevent this, but verify).
5. Reduce avoidable virtualizer/list recalculation triggers in `conversation-feed.tsx`.
6. **Measure INP p75** using the locked protocol from 144a (Chrome DevTools, 4x CPU throttle, N>=10 samples). Compare to baseline for each interaction.
7. **Accessibility verification**: Verify keyboard navigation (Tab/Enter/Escape) on all optimized components. Run axe-core via Chrome DevTools on inbox view and settings view. Confirm zero critical/serious violations.

## Validation (RED TEAM)

Functional smoke test after wave 3:
- [ ] Inbox conversation list scrolls smoothly with 100+ conversations
- [ ] Clicking a conversation switches immediately (no perceptible lag)
- [ ] Composing a message in action-station shows no input lag
- [ ] Settings tab switches are instant
- [ ] Tab/Enter/Escape keyboard navigation works on all touched components
- [ ] axe-core reports zero critical/serious violations on inbox and settings views
- [ ] INP p75 measurements documented for all 4 core interactions

## Output
- Targeted render-path optimizations with no business-logic drift.
- `docs/planning/phase-144/d/wave3-delta.md` with:
  - INP measurements vs target <=200ms
  - list of render-path hotspots eliminated
  - any residual bottlenecks requiring follow-on phase

## Handoff
Proceed to **144e** with finalized performance deltas and full verification evidence set.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Memoized `ConversationCard` with focused comparator.
  - Reduced repeated active conversation fetches when no new message timestamp exists.
  - Wrote delta artifact: `docs/planning/phase-144/d/wave3-delta.md`.
- Commands run:
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
  - `npm run test` — pass
- Blockers:
  - INP p50/p75 protocol run is still pending.
  - No formal axe run logged for touched views in this turn.
- Next concrete steps:
  - Execute DevTools INP sampling protocol.
  - Run axe + keyboard audit and append results.
