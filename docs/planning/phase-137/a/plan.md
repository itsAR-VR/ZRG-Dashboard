# Phase 137a — Baseline Audit + Recursive Evidence Pack

## Focus
Establish a trustworthy baseline for UX, accessibility, responsiveness, and performance across the full dashboard before any refactor or polish work begins.

## Inputs
- `docs/planning/phase-137/plan.md`
- `docs/planning/phase-137/skill-assignment-matrix.md`
- Core surfaces:
  - `app/page.tsx`
  - `components/dashboard/sidebar.tsx`
  - `components/dashboard/inbox-view.tsx`
  - `components/dashboard/action-station.tsx`
  - `components/dashboard/crm-view.tsx`
  - `components/dashboard/analytics-view.tsx`
  - `components/dashboard/insights-view.tsx`
  - `components/dashboard/settings-view.tsx`
  - `components/dashboard/settings/*.tsx`

## Work
1. Run recursive reasoning loop for baseline:
   - PLAN: define audit questions per view (clarity, speed, accessibility, resilience).
   - LOCATE: find key UI flows and bottleneck files/components.
   - EXTRACT: capture objective evidence (code patterns, metrics, UX state coverage).
   - SOLVE: classify issues by severity and user impact.
   - VERIFY: check contradictions/false positives.
   - SYNTHESIZE: final baseline report.
2. Execute design-quality passes:
   - `impeccable-audit` for comprehensive issue inventory.
   - `impeccable-rams` for WCAG + visual review.
   - `impeccable-critique` for IA/hierarchy/discoverability evaluation.
3. Run parallel subagent checks to confirm skill routing accuracy by surface and update the matrix if gaps are found.
4. Run performance baseline collection on representative screens:
   - Build stats and heavy component map.
   - Lighthouse/Web Vitals snapshot for main dashboard paths.
5. Produce a consolidated issue map tagged by:
   - Severity (Critical/High/Medium/Low)
   - Category (A11y, IA, Performance, Hardening, Visual)
   - Target area (Inbox, CRM, Analytics, Insights, Settings, Shared UI)

## Output
- Completed baseline audit dossier:
  - `docs/planning/phase-137/a/baseline-audit-dossier.md`
  - includes anti-pattern verdict, severity triage, baseline lint/build/chunk metrics, and skill-routed recommendations

## Validation (RED TEAM)
- `git status --porcelain` -> only `docs/planning/phase-137/*` changes in working tree
- `ls -dt docs/planning/phase-* | head -10` -> checked overlap with recent phases
- `npm run lint` -> pass (0 errors, 23 warnings captured in dossier)
- `npm run build -- --webpack` -> pass (build warnings captured in dossier)
- Static evidence scans run:
  - `<img>` usage in dashboard
  - hook/effect hotspots
  - interactive semantic patterns
  - chunk-size and LOC concentration baselines

## Handoff
Phase 137b should consume `baseline-audit-dossier.md` and generate an IA/microcopy simplification spec prioritized by:
1) Settings shell + dense dialogs
2) Inbox action flows
3) CRM drawer interaction density

## Progress This Turn (Terminus Maximus)
- Work done:
  - Ran Terminus preflight checks (git status, recent phase scan, plan loading).
  - Resolved subphase completion-state ambiguity by clearing scaffold Output/Handoff content in `137b`-`137f` (so execution can proceed sequentially).
  - Produced baseline quality dossier with high/medium/low findings and measurable performance baseline.
  - Captured concrete lint/build warnings and large chunk evidence for optimization targeting.
- Commands run:
  - `git status --porcelain` — pass; only phase-137 docs changed.
  - `ls -dt docs/planning/phase-* | head -10` — pass; overlap check completed.
  - `npm run lint` — pass with 23 warnings, 0 errors.
  - `npm run build -- --webpack` — pass with CSS parser warnings + middleware deprecation warning.
  - `du -sh .next .next/static .next/static/chunks` — baseline artifact sizing captured.
  - `find .next/static/chunks -type f -name '*.js' ...` — top chunk sizes captured.
  - `rg ...` scans across dashboard files — a11y/perf hotspots captured.
  - `node (path existence audit over phase-137 docs)` — all referenced concrete repo paths exist.
- Blockers:
  - None for subphase 137a.
- Next concrete steps:
  - Execute 137b from dossier findings: IA simplification map + clear action hierarchy spec.
  - Prioritize first user-facing simplifications before deep performance refactors.

## Coordination Notes
**Files modified:** phase-137 planning docs only.  
**Potential conflicts with:** none detected in application code this turn.  
**Integration notes:** recent phases 136/132/127 were reviewed for domain overlap; no conflicting code edits were made.
