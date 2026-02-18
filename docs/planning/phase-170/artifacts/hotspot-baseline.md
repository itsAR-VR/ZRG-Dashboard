# Phase 170 Hotspot Baseline (Code-First)

Timestamp: `2026-02-18T07:50:11Z`
Scope: Analytics, Master Inbox, Settings

## 1) Ranked Hotspots (Impact x Frequency x Multi-user Risk)

1. Analytics overview/campaign endpoints:
- Duplicate fallback execution paths in client read helpers could trigger route call + server action call for the same tab load on transport failure.
- Campaigns route fan-out used a hard `Promise.all` that could fail or stall the entire payload on one slow branch.

2. Inbox conversations reply-state filtering:
- `getConversationsCursor` used high scan multipliers for reply-state filters (`limit * 4`, floor 200) and cached every cursor page with short TTL, producing high churn and lower effective reuse.

3. Settings hydration:
- `getUserSettings` always loaded full `knowledgeAssets` payloads (including raw/text bodies) even for views that only need core settings.
- Non-AI settings consumers (`crm-drawer`, `followup-sequence-manager`, baseline settings load) paid full asset hydration cost.

4. Cache layering and read-path duplication:
- Overview route and action both had caching layers active on route misses.
- Read-API fallback behavior was not consistently bounded.

## 2) Root-Cause Matrix

| Area | Root Cause | Why It Hurts Under Concurrency | Risk |
|---|---|---|---|
| Analytics | duplicate fallback paths + unbounded branch wait | duplicate compute, p95 tail latency spikes | medium |
| Inbox | large reply-state scan batches | heavy DB scans per request at high workspace cardinality | medium |
| Settings | oversized baseline hydration payload | slower tab load/hydration + more server/client memory pressure | low |
| Cross-cutting | redundant cache layers | unnecessary cache churn and stale/miss complexity | low |

## 3) Implemented in This Pass

### Analytics
- `app/api/analytics/overview/route.ts`
  - Route cache is now authoritative on misses: route invokes `getAnalytics(..., { forceRefresh: true })` to avoid redundant action-cache layer.
- `app/api/analytics/campaigns/route.ts`
  - Added per-branch guardrail wrapper (`runCampaignTask`) with `8s` timeout and exception isolation so one slow/failing branch does not fail the entire payload.
- `components/dashboard/analytics-view.tsx`
  - Removed duplicate fallback behavior for non-OK read-API responses.
  - Retained fallback-to-action on transport failures and explicit `READ_API_DISABLED` to preserve resilience.

### Inbox
- `actions/lead-actions.ts`
  - Reply-state scan batch bound reduced from `max(limit*4, 200)` to `min(max(limit*3, 150), 400)` to cap worst-case scan cost.
  - Conversation list cache shifted to first-page only (`!cursor`) with `45s` TTL to improve hit quality and reduce cursor-key churn.
  - Inbox counts cache TTL increased from `10s` to `30s`.

### Settings
- `actions/settings-actions.ts`
  - `getUserSettings` now supports selective asset inclusion:
    - `includeKnowledgeAssets` (default `true`)
    - `includeKnowledgeAssetBodies` (default `true`)
  - Core settings reads can now skip heavy knowledge-asset hydration.
- `components/dashboard/settings-view.tsx`
  - Baseline settings load now requests `includeKnowledgeAssets: false`.
  - Knowledge assets are hydrated lazily when `activeTab === "ai"`.
  - Backfill refresh path now re-reads lightweight settings only.
- `components/dashboard/crm-drawer.tsx`
  - Uses lightweight settings read (`includeKnowledgeAssets: false`).
- `components/dashboard/followup-sequence-manager.tsx`
  - Uses lightweight settings read (`includeKnowledgeAssets: false`).

## 4) Measurement Contract (Phase 170)

- Analytics:
  - warm p95 `< 1.5s`
  - cold p95 `< 3.0s`
- Inbox:
  - counts p95 `< 2.0s`
  - conversations p95 `< 3.0s`
- Settings:
  - baseline settings fetch p95 `< 2.5s`
  - no eager heavy knowledge-asset bodies outside AI tab

## 5) Remaining Gaps (Red-Team)

1. We still need production-like concurrent request sampling to validate p95 closure under realistic tenant cardinality.
2. CRM rows/summary and response-timing SQL paths remain likely heavy tails; they need subphase b/d query-level follow-up.
3. We should add per-endpoint latency histograms (request-level telemetry) to avoid “fast sometimes, slow sometimes” blind spots.
4. Inbox reply-state filter remains approximate when extreme filters combine with deep pagination; verify no UX regressions in large workspaces.
