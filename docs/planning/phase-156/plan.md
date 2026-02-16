# Phase 156 — Settings IA Consolidation (Admin-Centric AI Controls)

## Purpose
Reorganize the Settings experience so configuration is no longer scattered, while making AI operational controls easier to find and maintain.  
Consolidate model selection and runtime controls into `Admin`, keep `AI Personality` focused on persona/content setup, and remove redundant Admin/AI surfaces.

## Context
The current `components/dashboard/settings-view.tsx` mixes setup, AI persona content, model selectors, runtime toggles, observability, and admin panels across multiple tabs, creating duplicated and confusing ownership boundaries.  
User decisions are locked for this phase:
- Keep top-level tab structure as `General`, `Integrations`, `AI Personality`, `Booking`, `Team`, `Admin` (no new top-level `Model Selector` tab).
- Place both **Model Selector** and **Controls** inside `Admin`.
- Remove `AI Dashboard` from `AI Personality`; keep it in `Admin` only.
- Deduplicate aggressively and remove redundant/useless admin surfaces.
- Ensure workspace admins and super admins can use admin configuration paths.
- Multi-agent preflight complete: last 10 phases scanned (`phase-155` to `phase-146`) and `git status --porcelain` is clean at plan creation time.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 155 | Active | Dashboard client surfaces (`components/dashboard/*`) and active release hardening | Keep scope strictly in settings IA; do not modify inbox/analytics runtime behavior from Phase 155. |
| Phase 153 | Complete | `components/dashboard/dashboard-shell.tsx` URL/state behavior for settings navigation | Preserve existing `settingsTab` query-param semantics and workspace selection URL behavior when updating tab routing. |
| Phase 146 | Active/Recent | AI prompt governance and model behavior domain | Preserve prompt-governance entrypoints and avoid changing prompt/model backend contracts while moving UI placement. |
| Phase 159 | Active | `components/dashboard/settings-view.tsx` knowledge asset upload UX/hotfix | Keep Phase 156 edits outside upload transport logic; preserve 12MB preflight/413 UX changes from 159. |
| Phase 160 | Planned/Active docs | `components/dashboard/settings-view.tsx` future large-upload flow | Avoid deleting/renaming knowledge asset upload surfaces that Phase 160 references. |
| Phase 157/158/161 | Active | Adjacent dashboard domains (analytics/inbox incidents) with dirty worktree overlap | Keep edits isolated to settings IA only; do not touch analytics/inbox incident codepaths. |

## Objectives
* [x] Define a decision-complete settings information architecture with clear ownership boundaries.
* [x] Refactor `AI Personality` to persona/content-only surfaces.
* [x] Centralize model selectors and operational toggles under `Admin` sections (`Model Selector`, `Controls`).
* [x] Remove duplicate AI/Admin cards and keep one observability surface (`AI Dashboard`) in `Admin`.
* [x] Preserve role access, persistence behavior, and deep-link compatibility.
* [x] Validate behavior with required quality and NTTAN gates (replay explicitly waived by user on 2026-02-16).

## Constraints
- Keep current top-level settings tab contract (`general|integrations|ai|booking|team|admin`) unless explicitly re-approved.
- Do not introduce Prisma/schema changes or backend API contract changes for this phase.
- Preserve existing settings persistence payload shape from `handleSaveSettings`.
- Keep Admin hidden for client-portal users; admin edits remain gated by workspace-admin capabilities.
- Keep edits surgical and limited to settings organization/deduplication.
- Do not remove prompt management capability; relocate if needed but keep available in admin paths.

## Success Criteria
- `AI Personality` contains only persona/content setup surfaces (persona manager, qualification questions, knowledge assets).
- `Admin` contains:
  - `Model Selector` section (campaign strategist + draft generation + draft verification selectors).
  - `Controls` section (runtime switches and operational toggles).
  - Single `AI Dashboard` observability surface.
- `AI Dashboard` no longer appears in `AI Personality`.
- Redundant cards are removed (no duplicated dashboard/activity/controls across AI and Admin tabs).
- Existing save/load behavior for moved settings remains unchanged.
- Deep links using `?view=settings&settingsTab=<tab>` remain valid.
- Validation gates pass:
  - `npm run lint`
  - `npm run build`
  - `npm run test:ai-drafts`
  - Replay gates are waived for this phase by user directive: “replay not needed here” (2026-02-16)

## Subphase Index
* a — Settings Surface Inventory and Destination Matrix
* b — Admin IA Contract (`Model Selector`, `Controls`, `Observability`)
* c — `AI Personality` Reduction and Model/Control Migration
* d — Admin Deduplication and Access Harmonization
* e — Navigation/Deep-Link Compatibility and CTA Retargeting
* f — Validation, QA Evidence, and Release Checklist

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk overlap
- `components/dashboard/settings-view.tsx` is actively referenced by Phase 159 and Phase 160 planning artifacts; semantic merge is required before shipping if those phase changes land concurrently.
- `lib/auto-send-evaluator.ts` is actively targeted by Phase 162d; only a minimal shared fix (`Lead.phone` select) was applied in this phase to clear build validation.

### Validation blockers
- None blocking phase close after explicit user waiver of replay requirements for this phase.

### Stale-assumption correction
- Initial clean-worktree assumption is no longer true during execution; ongoing concurrent phases (`157-161`) introduced broad uncommitted changes. Phase 156 proceeded by explicit user direction.

## Decisions This Turn

- [x] User response `1` confirmed proceeding with scoped Phase 156 work despite dirty worktree and overlapping active phases.
- [x] Applied a minimal coordination-safe fix in `lib/auto-send-evaluator.ts` (`Lead.phone` included in lead select) to clear build validation blocker while preserving Phase 156 scope.
- [x] User explicitly waived replay validation for this phase (“replay not needed here”, 2026-02-16).

## Open Questions (Need Human Input)

- None currently.

## Assumptions (>=90% Confidence)
- Phase 159 knowledge-upload hotfix behavior in `settings-view.tsx` remains intact after IA refactor (12MB preflight + 413 messaging).
- Keeping top-level tab contract unchanged (`general|integrations|ai|booking|team|admin`) preserves existing deep links.
- Admin access should derive from workspace capabilities and remain hidden for `CLIENT_PORTAL` users.

## Phase Summary (running)
- 2026-02-16 17:13:12Z — Completed settings IA refactor in `components/dashboard/settings-view.tsx`: AI tab reduced to persona/content setup; Admin now contains `Model Selector`, `Controls`, and a single `AI Dashboard`; admin derivation now accepts capabilities-derived workspace admin state. Validation: `npm run lint` pass (warnings), `npm run test:ai-drafts` pass, replay dry/live blocked by DB preflight, `npm run build` blocked by unrelated concurrent type error in `lib/auto-send-evaluator.ts`.
- 2026-02-16 17:27:44Z — Added subphase-level progress evidence, migration matrix, and RED TEAM closure notes across `phase-156/{a,b,c,d,e,f}/plan.md`; marked execution decision from user input and finalized scoped blocker handling.
- 2026-02-16 17:36:20Z — Cleared build blocker via one-line lead select fix in `lib/auto-send-evaluator.ts`; re-ran gates: `npm run lint` pass (warnings), `npm run build` pass, `npm run test:ai-drafts` pass, replay dry/live still blocked by Supabase DB connectivity (`db.pzaptpgrcezknnsfytob.supabase.co` unreachable). Artifacts: `.artifacts/ai-replay/run-2026-02-16T17-35-33-926Z.json`, `.artifacts/ai-replay/run-2026-02-16T17-35-37-434Z.json`.
- 2026-02-16 17:42:55Z — User explicitly waived replay requirement (“replay not needed here”); phase validation accepted with `lint/build/test:ai-drafts` passing and replay categorized as intentionally skipped for Phase 156 closure.
- 2026-02-16 17:44:18Z — Wrote `docs/planning/phase-156/review.md` and marked Phase 156 ready for closure (`Go`) with replay waiver recorded.
