# Phase 170a — Code Hotspot Baseline + Budget Contract (Analytics/Inbox/Settings)

## Focus
Create a code-first hotspot map and measurable latency budget contract before implementation so every later change is tied to a known bottleneck.

## Inputs
- `docs/planning/phase-170/plan.md`
- Existing performance evidence from `docs/planning/phase-168/` and `docs/planning/phase-169/`
- Current read-path code in Analytics, Inbox, and Settings modules

## Work
1. Map request paths and call graphs for:
   - Analytics routes + server actions
   - Inbox routes + server actions
   - Settings initial hydration and deferred slices
2. Identify duplicate work classes:
   - repeated auth checks
   - duplicated cache layers
   - repeated DB passes for equivalent filters
   - oversized hydration payloads
3. Define section-level p95 budgets and measurement protocol.
4. Produce a ranked bottleneck matrix (impact x effort x risk) with top implementation targets.

## Output
- Baseline hotspot report + budget contract artifact at `docs/planning/phase-170/artifacts/hotspot-baseline.md`
- Ranked implementation backlog for subphases b/c/d

## Handoff
Subphase b implements the highest-impact Analytics bottlenecks first, then hands off shared patterns to Inbox and Settings phases.

## Progress This Turn (Terminus Maximus)

- Completed full hotspot baseline artifact:
  - `docs/planning/phase-170/artifacts/hotspot-baseline.md`
- Completed explicit iteration log with 20+ entries:
  - `docs/planning/phase-170/artifacts/iteration-log.md`
- Implemented top low-risk backlog items immediately (ahead of subphase b handoff):
  - Analytics: route-cache de-duplication and campaigns branch isolation/timeouts.
  - Inbox: bounded reply-state scan workload and improved cache strategy.
  - Settings: lazy knowledge-asset hydration + lightweight settings fetch mode.

### Commands Run

- `npx eslint app/api/analytics/overview/route.ts app/api/analytics/campaigns/route.ts components/dashboard/analytics-view.tsx actions/lead-actions.ts actions/settings-actions.ts components/dashboard/settings-view.tsx components/dashboard/crm-drawer.tsx components/dashboard/followup-sequence-manager.tsx`
- `npm run build`

### Validation Outcome

- Lint: pass with existing warnings in `components/dashboard/settings-view.tsx` (hook dependency warnings, no new errors).
- Build: pass.
- Explorer red-team follow-up identified and resolved one analytics resilience regression; lint/build re-run passed.

## RED TEAM Pass (Phase-Gaps Style)

### Confirmed Gaps

1. Concurrency evidence is still code-proxied; we still need explicit p95 closure under staged multi-user load.
2. CRM/response-timing heavy SQL still need subphase-level tuning and measurement.
3. Endpoint-level latency telemetry needs stronger visibility to reduce future “fast vs slow” ambiguity.

### Mitigation for Next Subphases

- Subphase b: continue analytics read-path hardening and instrument per-endpoint latency evidence.
- Subphase c: validate reply-state filter correctness under larger workspaces after scan-bound change.
- Subphase d/e: execute load and accessibility/perf verification loop against analytics/inbox/settings paths.

## Status

- Subphase 170a: `Completed`
- Next: Subphase 170b
