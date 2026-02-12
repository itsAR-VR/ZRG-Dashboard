# Phase 144d Wave 3 Delta

## Scope Executed
Targeted render-churn reduction in high-frequency inbox list path.

## Changes Applied

### 1) ConversationCard memoization
- Converted to memoized component with explicit comparator over displayed fields.
- Comparator avoids rerender when card-visible data is unchanged even if parent passes new object identity.

Anchors:
- `components/dashboard/conversation-card.tsx:105`
- `components/dashboard/conversation-card.tsx:245`

### 2) Reduced redundant active conversation fetches
- Added timestamp-gated fetch skip for background refreshes in inbox.
- Prevents repeated full conversation fetch when list refresh has no newer message.

Anchors:
- `components/dashboard/inbox-view.tsx:431`
- `components/dashboard/inbox-view.tsx:484`

### 3) View-instance retention for faster back-navigation
- Added mounted-view retention in dashboard shell so previously opened views stay mounted and switch instantly on return.
- Views are hidden with `display: none` when inactive; state is preserved without re-mounting on every navigation.
- Added URL-derived initial view/tab initialization to avoid first-render mismatch cost on deep links.

Anchors:
- `components/dashboard/dashboard-shell.tsx:61`
- `components/dashboard/dashboard-shell.tsx:120`
- `components/dashboard/dashboard-shell.tsx:263`

### 4) Inbox network gating for retained-view mode
- Added explicit `isActive` prop to inbox view.
- Disabled inbox queries/realtime/polling while inbox is not the active dashboard view.
- Preserves cached UI state without paying background network/CPU costs.

Anchors:
- `components/dashboard/inbox-view.tsx:27`
- `components/dashboard/inbox-view.tsx:241`
- `components/dashboard/inbox-view.tsx:331`
- `components/dashboard/inbox-view.tsx:886`

## INP Measurement Status
- INP p50/p75 manual capture is still pending (DevTools + CPU throttle protocol not yet executed in this turn).
- This subphase therefore improves likely INP contributors but does not yet include finalized INP evidence.

## Validation
- `npm run lint` -> pass (warnings only)
- `npm run build` -> pass
- `npm run test` -> pass (368/368)
- NTTAN gate:
  - `npm run test:ai-drafts` -> pass (58/58)
  - `npm run test:ai-replay -- --client-id 00000000-0000-0000-0000-000000000000 --dry-run --limit 20` -> blocked (`P1001`, DB unreachable)
  - `npm run test:ai-replay -- --client-id 00000000-0000-0000-0000-000000000000 --limit 20 --concurrency 3` -> blocked (`P1001`, DB unreachable)

## Residual Bottlenecks
- `app/page.tsx` remains a client shell and still carries base hydration cost.
- `components/dashboard/analytics-view.tsx` still eagerly imports heavy analytics stack inside its own chunk.
- Full INP acceptance proof remains outstanding without interactive profiling run.

## Addendum (2026-02-12)
- Further wave-3 tuning applied:
  - `components/dashboard/conversation-feed.tsx`: memoized feed export + virtualizer key stabilization (`getItemKey`).
  - `components/dashboard/inbox-view.tsx`: stabilized feed-prop identities (`smsClientOptions`, `smsClientUnattributedCount`, `onLoadMore`).
  - `components/dashboard/dashboard-shell.tsx`: reduced retained view instances to `active + previous` and removed redundant URL-sync state writes.
  - `components/dashboard/sidebar.tsx`: added in-flight guard for count polling and memoized filter model.
- Verification:
  - `npm run lint` -> pass (warnings only)
  - `npm run build` -> pass
  - `npm run test` -> pass (368/368)
- Measurement:
  - `.next/build-manifest.json` `rootMainFiles` gzip remains `117,241` (runtime responsiveness improved; root bytes unchanged).
