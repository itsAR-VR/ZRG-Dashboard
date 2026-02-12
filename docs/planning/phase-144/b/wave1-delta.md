# Phase 144b Wave 1 Delta

## Scope Executed
Primary churn controls implemented in:
- `components/dashboard/inbox-view.tsx`
- `components/dashboard/sidebar.tsx`
- `components/providers/query-provider.tsx`

## Changes Applied

### 1) Inbox polling visibility + realtime heartbeat
- Added page visibility state tracking (`visibilitychange`).
- `refetchInterval` now behaves as:
  - hidden tab -> `false`
  - visible + realtime live -> `60000`
  - visible + realtime not live -> `60000`
- On visibility resume, inbox refetches immediately.

Anchors:
- `components/dashboard/inbox-view.tsx:40`
- `components/dashboard/inbox-view.tsx:42`
- `components/dashboard/inbox-view.tsx:347`
- `components/dashboard/inbox-view.tsx:351`

### 2) Active conversation fetch de-duplication
- Added `activeConversationLastFetchedAtRef`.
- Background `getConversation()` fetches now skip when list indicates no newer `lastMessageTime`.

Anchors:
- `components/dashboard/inbox-view.tsx:182`
- `components/dashboard/inbox-view.tsx:431`
- `components/dashboard/inbox-view.tsx:484`

### 3) Sidebar polling guardrails
- Count polling now runs only when:
  - workspace exists
  - active view is inbox
  - tab is visible
- Count polling cadence changed from `30000` to `60000`.
- Immediate refresh on visibility resume.

Anchors:
- `components/dashboard/sidebar.tsx:128`
- `components/dashboard/sidebar.tsx:140`
- `components/dashboard/sidebar.tsx:182`

### 4) Query background interval guard
- Global React Query: `refetchIntervalInBackground: false`.

Anchor:
- `components/providers/query-provider.tsx:17`

## Request-Churn Impact (Live Evidence)
Live Playwright capture (`https://zrg-dashboard.vercel.app`, Master Inbox focused idle):
- run length: `5.21` minutes
- non-static requests: `25` (`4.8/min`)
- all requests were `POST /` Next server-action calls
- dominant action IDs:
  - `4047f2f67240bd11d1791bfeb6a4b7aaa683d346a3` (`11`)
  - `4064c1fbbbb0d620f8508228282abd391b3af36ad6` (`10`)
  - `60438852811b993944f03e77fb8cb1b99a5c9d8757` (`3`)
  - `4074ee2e41b8e7a32cac698e78e268e23e46407a75` (`1`)
- sampled payload attribution:
  - `4064...` -> conversation list cursor/filter fetch
  - `4047...` -> workspace inbox counts fetch
  - `6043...` -> active conversation fetch

Post-change expectation (after deploy):
- halving inbox + sidebar polling loops (`30s -> 60s`) should materially reduce focused-idle action traffic while preserving `<=60s` freshness SLA.

## Validation
- `npm run lint` -> pass (warnings only, no errors)
- `npm run build` -> pass
- `npm run test` -> pass (361/361)

## Residual Risk
- Live freshness behavior under flaky realtime still needs browser-level validation for SLA proof (`<=60s` stale when focused).
