# Phase 152c — Stabilize ActionStation Callback Chain + End-to-End Verification

## Status (2026-02-14)
Deferred pending live validation outcome from 152a minimal patch.

## RED TEAM Corrections (2026-02-14)
- The LinkedIn error-state Retry button calls `fetchLinkedInStatus()` directly in `components/dashboard/action-station.tsx`.
- If this subphase is executed, preserve a callable retry path (for example, keep a stable function for button-triggered retries) instead of removing callable status-fetch logic outright.

## Focus
Fix the ActionStation `fetchLinkedInStatus` callback dependency chain that causes unnecessary effect cascades on conversation changes, then run comprehensive end-to-end verification to confirm the React #301 crash is eliminated.

## Inputs
- Phase 152a: consolidated InboxView effects (primary fix)
- Phase 152b: workspace transition guard in DashboardShell (safety net)
- Current file: `components/dashboard/action-station.tsx`

## Work

### 1. Stabilize `fetchLinkedInStatus` effect chain

**Problem:** The `fetchLinkedInStatus` useCallback (lines 480-516) depends on `[conversation?.id, activeChannel, hasLinkedIn]`. The effect at line 519 depends on `[fetchLinkedInStatus]`. When `conversation?.id` changes, the callback reference changes, triggering the effect even when only the conversation ID is the meaningful change.

**Fix:** Keep a callable `fetchLinkedInStatus` for Retry-button UX, but remove callback-reference churn from the effect path:

Replace the current callback/effect pair with:
- a stable callable `fetchLinkedInStatus(conversationId, isCancelled?)` used by both effect and Retry button
- an effect keyed by meaningful primitives (`conversation?.id`, `activeChannel`, `hasLinkedIn`)

```typescript
const fetchLinkedInStatus = useCallback(
  async (conversationId: string | null, isCancelled?: () => boolean) => {
    const cancelled = () => Boolean(isCancelled?.())
    if (!conversationId || activeChannel !== "linkedin" || !hasLinkedIn) {
      if (cancelled()) return
      setLinkedInStatus(null)
      return
    }

    if (cancelled()) return
    setIsLoadingLinkedInStatus(true)
    try {
      const result = await checkLinkedInStatus(conversationId)
      if (cancelled()) return
      setLinkedInStatus(result)
    } catch (error) {
      if (cancelled()) return
      console.error("[ActionStation] Failed to fetch LinkedIn status:", error)
      setLinkedInStatus({
        success: false,
        error: "Network issue while checking LinkedIn status",
        connectionStatus: "NOT_CONNECTED",
        canSendDM: false,
        canSendInMail: false,
        hasOpenProfile: false,
        inMailBalance: null,
      })
    } finally {
      if (!cancelled()) setIsLoadingLinkedInStatus(false)
    }
  },
  [activeChannel, hasLinkedIn]
)

useEffect(() => {
  let cancelled = false
  void fetchLinkedInStatus(conversation?.id ?? null, () => cancelled)
  return () => {
    cancelled = true
  }
}, [conversation?.id, fetchLinkedInStatus])
```

### 2. Run full quality gates
```bash
npm run lint
npm run build
npm test
```

### 3. Production-parity manual verification

Build and run with production parity:
```bash
npm run build && npx next start
```

Manual test checklist:
- [ ] Switch between workspaces 5+ times rapidly — no crash
- [ ] Switch workspace while conversations are loading — no crash
- [ ] Switch to a workspace with no conversations — empty state renders correctly
- [ ] Deep-link URL `?leadId=xxx&clientId=yyy` resolves correctly
- [ ] Sentiment filter resets on workspace switch
- [ ] SMS client filter resets on workspace switch
- [ ] Score filter resets on workspace switch
- [ ] First conversation auto-selects after data loads in new workspace
- [ ] ActionStation shows correct channel tabs for selected conversation
- [ ] LinkedIn status loads correctly when switching to LinkedIn tab
- [ ] CRM drawer opens/closes without issues after workspace switch

### 4. Deploy to Vercel preview and retest
Since the bug is production-only, deploy to a Vercel preview environment and repeat the workspace-switch test.

## Output
- `components/dashboard/action-station.tsx` has a stabilized LinkedIn status effect (no callback indirection)
- All 3 files modified in Phase 152 (inbox-view, dashboard-shell, action-station) pass quality gates
- Manual verification confirms workspace switching is crash-free in production build

## Handoff
Phase 152 is complete. The fix addresses the React #301 crash through:
1. **152a** — Eliminated fragmented effects and unstable array references (root cause)
2. **152b** — Added transition guard for clean unmount/mount separation (safety net)
3. **152c** — Stabilized callback chain to reduce overall render churn (hardening)

Deploy to production. If the crash recurs, the `DashboardErrorBoundary` componentStack logging (from the prior handoff session) will provide immediate diagnostics.
