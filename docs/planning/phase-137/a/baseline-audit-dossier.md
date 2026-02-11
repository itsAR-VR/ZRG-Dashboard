# Phase 137a — Baseline Audit Dossier

Date: 2026-02-11
Scope: Dashboard core surfaces (`app/page.tsx`, `components/dashboard/*`, `components/dashboard/settings/*`)

## Anti-Patterns Verdict
Result: **Mixed (Fail for performance/complexity, Pass for baseline accessibility intent)**

Observed “AI slop” signals are low (custom domain-heavy UI, non-generic workflows), but complexity-driven UX debt is high in large multi-purpose screens. The product feels functional but overloaded in key areas (especially Settings + Inbox action flows), with measurable performance risk from bundle size and component weight.

## Executive Summary
- Total issues identified: 14
  - High: 5
  - Medium: 6
  - Low: 3
- Top critical concerns:
  - Oversized client payload on dashboard route (`app/page` chunk ~718KB + shared chunk ~754KB)
  - Monolithic dashboard settings surface (`components/dashboard/settings-view.tsx` ~7,962 LOC)
  - 23 lint warnings concentrated in hooks dependency hygiene and perf-sensitive surfaces
  - Dashboard sidebar still uses raw `<img>` instead of optimized image handling
  - Repeated polling/timer patterns likely causing avoidable render/network churn

## Measurement Snapshot (Baseline)
- Lint: `npm run lint` -> pass with **23 warnings, 0 errors**
- Build: `npm run build -- --webpack` -> pass
- Largest emitted JS chunks:
  - `.next/static/chunks/3338-1258c70b8418d774.js` -> ~754KB
  - `.next/static/chunks/app/page-aa10192bc325ade2.js` -> ~718KB
  - `.next/static/chunks/2543-e041daf7cc6baafc.js` -> ~206KB
- Dashboard component concentration by size:
  - `components/dashboard/settings-view.tsx` -> 7,962 LOC
  - `components/dashboard/crm-drawer.tsx` -> 1,958 LOC
  - `components/dashboard/settings/integrations-manager.tsx` -> 1,949 LOC
  - `components/dashboard/insights-chat-sheet.tsx` -> 1,930 LOC
  - `components/dashboard/action-station.tsx` -> 1,320 LOC

## Detailed Findings

### High Severity

1) Oversized dashboard client payload
- Location: build output chunks for dashboard route
- Category: Performance
- Impact: Slower initial render and interaction readiness for dashboard users, especially on weaker devices/networks
- Evidence: `.next/static/chunks/app/page-*.js` ~718KB and shared chunk ~754KB
- Recommendation: Break monolithic client view into lazy-loaded feature boundaries; defer non-critical panels
- Suggested command: `impeccable-optimize`

2) Settings monolith increases render and maintenance risk
- Location: `components/dashboard/settings-view.tsx`
- Category: Performance / UX Architecture
- Impact: High coupling across tabs/dialogs increases regressions, harder targeted optimization, slower hydration
- Evidence: file size ~7,962 LOC and many async/state handlers
- Recommendation: Split by tab domain + isolate heavy dialogs into on-demand modules
- Suggested command: `impeccable-optimize` + `impeccable-simplify`

3) Hook dependency hygiene warnings across critical interaction paths
- Location:
  - `app/page.tsx:101`
  - `components/dashboard/action-station.tsx:245`, `:439`, `:492`
  - `components/dashboard/inbox-view.tsx:513`, `:542`
  - `components/dashboard/settings-view.tsx:979`, `:1747`, `:1752`, `:1759`
  - `components/dashboard/sidebar.tsx:155`
- Category: Resilience / Performance
- Impact: Potential stale state bugs and unnecessary rerenders in core workflows
- Recommendation: Resolve exhaustive-deps warnings with stable callbacks/memos or explicit effect redesign
- Suggested command: `impeccable-harden` + `impeccable-optimize`

4) Dashboard branding image uses raw `<img>` in sidebar
- Location: `components/dashboard/sidebar.tsx:206`
- Category: Performance
- Impact: Lower image optimization and potentially worse LCP on main dashboard route
- Recommendation: Use optimized image handling or explicit lazy/fetch-priority strategy
- Suggested command: `impeccable-optimize`

5) Dense action surfaces need IA simplification before deeper optimization
- Location:
  - `components/dashboard/action-station.tsx`
  - `components/dashboard/settings-view.tsx`
  - `components/dashboard/crm-drawer.tsx`
- Category: UX Architecture
- Impact: Discoverability friction and cognitive load for daily operators
- Recommendation: Clarify primary/secondary actions; reduce simultaneous control density
- Suggested command: `impeccable-critique` + `impeccable-clarify` + `impeccable-simplify`

### Medium Severity

6) CSS optimizer warnings show invalid class token patterns
- Location: build output warnings for `var(--...)`, `var(--score-*)`, `var(--sentiment-*)`
- Category: Theming / Build Quality
- Impact: Potential silently broken utility classes and inconsistent styling behavior
- Recommendation: Replace wildcard-style variable utilities with explicit valid token classes
- Suggested command: `impeccable-normalize`

7) Deprecated middleware convention on Next.js 16
- Location: `middleware.ts` (build warns “use proxy instead”)
- Category: Platform Stability
- Impact: Future compatibility risk and migration overhead
- Recommendation: Plan migration to `proxy` convention in a dedicated subphase
- Suggested command: `impeccable-harden`

8) Polling/timer-heavy patterns in inbox and sidebar
- Location:
  - `components/dashboard/sidebar.tsx` (30s interval counts refresh)
  - `components/dashboard/inbox-view.tsx` (multiple timers/effects)
- Category: Performance
- Impact: Background churn can degrade responsiveness in long sessions
- Recommendation: Gate polling by visibility/activity; consolidate refresh triggers
- Suggested command: `impeccable-optimize`

9) Nested interactive zones in virtualized CRM rows are fragile
- Location: `components/dashboard/crm-view.tsx:838`, `:860`
- Category: Accessibility / Interaction Resilience
- Impact: Reliance on stopPropagation patterns can create keyboard/focus inconsistencies
- Recommendation: Promote explicit interactive subregions and tighten keyboard semantics
- Suggested command: `impeccable-rams` + `impeccable-harden`

10) Incompatible-library lint warning for virtualizer integration
- Location: `components/dashboard/crm-view.tsx:474`
- Category: Performance / Stability
- Impact: Reduced compiler optimization and potential stale memo behavior downstream
- Recommendation: Isolate virtualizer usage boundaries and avoid leaking unstable references
- Suggested command: `impeccable-optimize`

11) Prompt/editor-heavy settings areas likely over-rendering
- Location: `components/dashboard/settings-view.tsx:6168-7724`
- Category: Performance / UX
- Impact: Scroll+jank risk in long dialogs and history tables
- Recommendation: Split heavy editor/history panes and lazy-load inactive tabs
- Suggested command: `impeccable-optimize` + `impeccable-adapt`

### Low Severity

12) Outdated baseline-browser mapping package warning
- Location: lint/build command output
- Category: Tooling
- Impact: Lower confidence in modern browser baseline assumptions
- Recommendation: update dev dependency in a controlled maintenance pass
- Suggested command: `impeccable-polish`

13) Unused eslint-disable directive
- Location: `lib/ai/retention.ts:8`
- Category: Code Quality
- Impact: Noise in lint output
- Recommendation: remove stale directive
- Suggested command: `impeccable-polish`

14) Additional `<img>` warnings in auth pages (outside dashboard core)
- Location:
  - `app/auth/login/page.tsx`
  - `app/auth/signup/page.tsx`
  - `app/auth/forgot-password/page.tsx`
  - `app/auth/reset-password/page.tsx`
- Category: Performance
- Impact: Slower auth route LCP
- Recommendation: align image strategy with dashboard optimization pass
- Suggested command: `impeccable-optimize`

## Patterns & Systemic Issues
- Large single-file surfaces are strongly correlated with dependency warnings and state complexity.
- Async-heavy UI regions (Settings dialogs, Action Station, Insights chat) need explicit render budget controls.
- Accessibility intent is generally present, but interactive complexity introduces risk around nested controls and focus/keyboard consistency.

## Positive Findings
- Skip link exists for main content navigation (`app/page.tsx`).
- Broad use of `aria-label` on icon-only actions across dashboard surfaces.
- `prefers-reduced-motion` support exists in global styles.
- Virtualization is already used in long-list contexts (`crm-view`, `conversation-feed`).
- Meaningful use of `useMemo`/`useCallback` in high-throughput views.

## Recommended Priority Order
1. Immediate
- Resolve high-impact hook dependency warnings in Inbox/Action Station/Settings/Page.
- Reduce dashboard entry chunk cost (route splitting + lazy loading).

2. Short-term
- Refactor Settings shell and heavy dialogs into modular boundaries.
- Improve polling and background refresh strategy.

3. Medium-term
- Normalize token/class usage causing CSS parser warnings.
- Harden CRM row interaction semantics for nested controls.

4. Long-term
- Migrate middleware convention to proxy.
- Tooling cleanups (`baseline-browser-mapping`, stale lint directives).

## Skill Routing Confirmation
This dossier validates use of the phase matrix in:
- `docs/planning/phase-137/skill-assignment-matrix.md`

Primary emphasis confirmed:
- `impeccable-harden`: state/effect resilience + interaction safety
- `impeccable-optimize`: payload/render/timer reduction
- `impeccable-critique`/`impeccable-clarify`: IA and operator clarity
- `impeccable-rams`: focused accessibility integrity checks before polish
