# Phase 149 — React #301 Closure (Dashboard Render-Loop Hardening)

## Purpose
Close the persistent production `Minified React error #301` by removing remaining render/update feedback loops and state-sync weak spots in dashboard client surfaces.

## Context
Production reports still show `Minified React error #301` from chunk `4bd1b696-43ba64781d20dbb7.js` after prior fixes. Build-blocking TypeScript issues were already resolved, and earlier loop guards landed in `action-station` and `sidebar`, but a risk sweep found additional churn vectors in dashboard effects and URL/state synchronization.

Highest-risk residuals from this conversation:
- `components/dashboard/insights-chat-sheet.tsx` session/sessions effect coupling can retrigger fetch cycles.
- `components/dashboard/inbox-view.tsx` manual `refetch()` effect can amplify query churn on readiness/visibility transitions.
- `components/dashboard/action-station.tsx` draft refresh now avoids sentiment-driven loops, but can drift stale after sentiment reclassification.
- `components/dashboard/sidebar.tsx` can retain stale counts when workspace/view exits inbox mode.
- `hooks/use-url-state.ts` merges updates from captured state snapshots (race risk for rapid sequential setters), but appears unused in the current repo.

`sw.js: NetworkMonitor: Timeout` appears external to this repo (no in-repo `sw.js` or `NetworkMonitor` implementation found), so this phase keeps focus on React update-depth risk inside dashboard code.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 148 | Active (uncommitted) | `actions/message-actions.ts`, webhook/runtime message flow, Prisma schema | Keep Phase 149 scoped to dashboard client loop/state surfaces unless a dependency is proven. Re-read file state immediately before edits in any overlapping file. |
| Phase 147 | Active/recent | Follow-up/message reliability domain | No direct file overlap expected; avoid broad message runtime edits. |
| Phase 144 | Complete/recent | `inbox-view.tsx`, `sidebar.tsx`, `action-station.tsx`, `dashboard-shell.tsx` | Preserve Phase 144 performance wins (polling cadence, rerender guards) while hardening loop safety. |

## Objectives
* [x] Build a deterministic repro/evidence matrix for React #301 on dashboard flows.
* [x] Remove remaining high-risk effect feedback loops in `insights-chat-sheet` and `inbox-view`.
* [x] Fix state consistency weak spots (`sidebar`) without reintroducing loop risk.
* [ ] Add regression tests that fail on loop-prone/state-race regressions (blocked: no UI test harness; see Phase 149d).
* [x] Run full quality gates and deployment-readiness checks.

## Constraints
- Do not revert or overwrite unrelated in-flight changes from concurrent phases.
- Use symbol-anchored edits in high-churn dashboard files.
- Keep scope limited to loop/churn/state-sync reliability; no speculative service-worker fixes in this repo.
- NTTAN is explicitly out of scope for Phase 149 (user request). Keep changes UI-only; do not touch AI drafting/prompt/message/reply behavior paths.
- Preserve existing behavior and Phase 144 performance characteristics while hardening.
- Maintain build + lint + test health throughout.

## Success Criteria
- No reproducible React #301 when executing the Phase 149a repro matrix in a real browser (local or Vercel).
- `insights-chat-sheet` and `inbox-view` effects are transition-guarded/idempotent to prevent update-depth thrash.
- `action-station` draft refresh and `sidebar` counts behavior are consistent under workspace/view/sentiment transitions.
- URL-state update path: explicitly out of scope for Phase 149 (hook appears unused); verified no call sites beyond `hooks/use-url-state.ts`.
- Required local gates pass:
  - `npm run lint`
  - `npm run build`
  - `npm test`

## Subphase Index
* a — Reproduction Matrix + Instrumentation Boundaries
* b — High-Risk Loop Guard Hardening (`insights-chat-sheet`, `inbox-view`)
* c — State-Sync Integrity Hardening (`action-station`, `sidebar`, `use-url-state`)
* d — Regression Tests + Negative Cases (loop/race protection)
* e — End-to-End Validation and Release Readiness

## Phase Summary (running)
- 2026-02-13 09:34 UTC — Hardened dashboard effect/state guards to reduce refetch/session reload churn; ran lint/build/test (files: `components/dashboard/inbox-view.tsx`, `components/dashboard/insights-chat-sheet.tsx`, `components/dashboard/sidebar.tsx`, `docs/planning/phase-149/*`).

## Repo Reality Check (RED TEAM)

- What exists today:
  - Dashboard client loop candidates live primarily in `components/dashboard/inbox-view.tsx` and `components/dashboard/insights-chat-sheet.tsx`.
  - Repo test orchestration (`npm test`) runs a fixed list of `lib/**` unit tests via `scripts/test-orchestrator.ts` (no client-component test harness).
  - `hooks/use-url-state.ts` exists but appears unused (no call sites found).
- Verified touch points:
  - `components/dashboard/inbox-view.tsx` — manual `refetch()` effect replaced with a transition guard.
  - `components/dashboard/insights-chat-sheet.tsx` — session existence checks now flow through a boolean memo to avoid redundant `loadSession()` runs.
  - `components/dashboard/sidebar.tsx` — counts reset when leaving inbox context to avoid stale count display.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Browser-only symptom: React #301 is a client/runtime error; this phase can’t fully “prove” closure without a real browser run.
- Multi-agent dirty worktree: other uncommitted changes (Phase 148/146) can confound verification if deployed together.

### Testing / validation
- No UI regression harness: component-level tests for render loops are blocked without adding jsdom/RTL or Playwright; Phase 149 relies on manual repro + lint/build/test gates.

## Open Questions (Need Human Input)

- [ ] If React #301 still happens: which view/action triggers it now (inbox switch, insights console open, settings navigation)?
  - Why it matters: narrows the remaining loop candidate surface to a single component path instead of broad hardening.
  - Current assumption in this phase: primary remaining loop risk was effect coupling in inbox + insights surfaces.

## Review Notes

- Verified (combined working tree):
  - `npm run lint` — pass (warnings only).
  - `npm run build` — pass.
  - `npm test` — pass.
- Remaining:
  - Manual browser verification of the Phase 149a repro matrix to conclusively confirm React #301 is gone.
