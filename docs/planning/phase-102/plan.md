# Phase 102 — Revert Booking Tab Campaign Assignment UI (Table Layout)

## Purpose
Restore the Settings → Booking “Campaign Assignment (AI Auto‑Send vs Setter)” UI back to the **pre–Phase 92 table layout**, while keeping Phase 97 functional/insight additions and leaving all other Booking-tab UI unchanged.

## Context
The user dislikes the current Settings → Booking experience specifically around the campaign assignment UI (which was modernized/polished in Phase 92). They want **everything else to stay the same** and only revert this one piece.

Locked decisions from conversation:
- **Revert scope:** Campaign assignment UI only (keep the current “Booking configuration notes” alert in `settings-view.tsx` as-is).
- **Keep newer extras:** Yes — keep Phase 97 additions (e.g., “Last 30d” auto-send stats line and the “AI Responses (setter)” mismatch badge) as long as they fit cleanly in the table layout.

Target file:
- `components/dashboard/settings/ai-campaign-assignment.tsx`

## Concurrent Phases
Uncommitted work exists in the working tree; treat these as integration constraints.

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 101 | Uncommitted (working tree) | None (analytics domain) | No coordination needed; avoid touching files already modified in `git status` unless required. |
| Phase 100 | Uncommitted (working tree) | None (prompt runner + tests) | No coordination needed; avoid touching `scripts/test-orchestrator.ts`. |
| Phase 99 | Uncommitted (planning files) | None (admin auth hardening) | No coordination needed. |
| Phase 97 | Complete (repo history) | `components/dashboard/settings/ai-campaign-assignment.tsx` | Preserve Phase 97 header insights/badges while reverting layout. |
| Phase 92 | Complete (repo history) | `components/dashboard/settings/ai-campaign-assignment.tsx` | Revert only the campaign assignment layout change; keep the Booking-tab container UI unchanged. |

## Objectives
* [x] Identify the minimal revert needed to restore the table layout (no behavior regressions)
* [x] Update `ai-campaign-assignment.tsx` to use the pre–Phase 92 table structure
* [x] Preserve Phase 97 functional/insight UI in the header
* [x] Validate with lint/build and a small manual smoke test

## Constraints
- **Scope constraint:** only revert the campaign assignment UI; do not change other Settings → Booking sections or other tabs.
- **Minimal surface area:** only modify `components/dashboard/settings/ai-campaign-assignment.tsx` (plus these planning docs).
- **No behavior changes:** keep save/revert logic, schedule editor behavior, and disabled states intact.
- **No schema/backend changes:** UI-only revert.

## Repo Reality Check (RED TEAM)

- What exists today:
  - `components/dashboard/settings/ai-campaign-assignment.tsx` renders the Campaign Assignment panel and contains the layout we reverted.
  - Phase 97 added header insights/badges in the same component.
- What the plan assumes:
  - Table layout can be restored without touching Booking tab container UI.
  - Phase 97 header extras remain compatible with the table layout.
- Verified touch points:
  - `components/dashboard/settings/ai-campaign-assignment.tsx` (render branch under `rows.length > 0`)

## Success Criteria
- [x] Campaigns render in a **table** again (no collapsible row cards, no slider-based threshold control).
- [x] Editing Mode/Threshold/Delay/Schedule/Booking Process/Persona still works; dirty rows highlight and Save/Revert behave correctly. *(Manual smoke confirmed.)*
- [x] Phase 97 header insights remain present (auto-send stats line and mismatch badge).
- [x] `npm run lint` and `npm run build` pass. *(Warnings noted.)*

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Manual UI regression (table layout not rendering or save/revert broken) → mitigated by user-confirmed smoke test.

### Missing or ambiguous requirements
- Manual confirmation step completed (user verified Booking tab UI) → release gate cleared.

### Performance / timeouts
- Build can fail if `.next/lock` exists → mitigation: remove `.next/lock` and rerun build.

### Testing / validation
- Lint/build executed with warnings that are pre-existing → record but do not expand scope.

## Open Questions (Need Human Input)

- [x] Can you run the Settings → Booking → Campaign Assignment smoke test and confirm table layout + save/revert behavior? (Resolved 2026-02-04)
  - Why it matters: Final sign-off depends on UI behaving correctly in the browser.
  - Resolution: User confirmed the UI is good.

## Phase Summary (running)
- 2026-02-04 — Restored table layout in campaign assignment panel; lint/build passed with warnings; manual UI smoke pending. (files: `components/dashboard/settings/ai-campaign-assignment.tsx`, `docs/planning/phase-102/*`)
- 2026-02-04 — Re-ran lint/build after final layout swap; warnings unchanged; manual UI smoke still pending. (files: `components/dashboard/settings/ai-campaign-assignment.tsx`)
- 2026-02-04 — Prepared Phase 102 changes for commit/push per request; other working-tree changes left untouched. (files: `components/dashboard/settings/ai-campaign-assignment.tsx`, `docs/planning/phase-102/*`)
- 2026-02-04 — Manual smoke confirmed by user; all success criteria satisfied. (files: `docs/planning/phase-102/*`)
- 2026-02-04 — Wrote Phase 102 review doc with lint/build evidence. (files: `docs/planning/phase-102/review.md`)

## Subphase Index
* a — Audit current UI vs pre–Phase 92 table baseline
* b — Implement table layout revert (preserve Phase 97 header extras)
* c — Validate (lint/build + manual smoke)

## Phase Summary

- Shipped:
  - Table-based Campaign Assignment UI restored with Phase 97 header insights preserved.
- Verified:
  - `npm run lint`: pass (warnings only)
  - `npm run build`: pass (warnings only)
  - `npm run db:push`: skipped (no schema changes)
- Notes:
  - Manual smoke confirmed by user on 2026-02-04.
