# Phase 137d — Resilience Hardening Blueprint (Edge Cases + A11y Integrity)

## Focus
Make the interface robust under real-world stress: long/strange text, empty/error/loading states, network failures, permission constraints, and accessibility edge cases.

## Inputs
- `docs/planning/phase-137/a/plan.md` issue inventory
- `docs/planning/phase-137/b/plan.md` IA contract
- `docs/planning/phase-137/c/plan.md` performance constraints

## Work
1. Run `impeccable-harden` to identify production fragility in all core views.
2. Address systemic resilience risks:
   - text overflow/wrapping in dense data panels and cards
   - keyboard/focus completeness and interactive semantics
   - resilient empty/error/loading/retry states
   - reduced-motion and high-contrast compatibility
   - internationalization-readiness (expansion + locale formatting surfaces)
3. Add/adjust tests and checks where needed for regressions on critical flows.
4. Validate hardening changes do not degrade performance budgets from 137c.

## Output
- Completed resilience hardening implementation across highest-risk surfaces:
  - `components/dashboard/settings-view.tsx`
    - core-first workspace load + deferred integrations/booking slices
    - workspace-stale async guard + per-workspace deferred slice cache
    - AI observability gated to AI/Admin tabs
    - workspace-save guard + loading live-region semantics
  - `components/dashboard/action-station.tsx`
    - LinkedIn status failure recovery affordance (`Retry`) and clearer failure state copy
    - channel-specific send failure fallback messages for clearer user recovery path
    - LinkedIn status fetch now uses reusable callback for effect + retry action
  - `components/dashboard/crm-drawer.tsx`
    - status/sentiment select labeling and descriptions for assistive tech
    - loader live-regions for response timing, sequence loading, appointment history, and booking slots
    - follow-up progress bar semantics (`progressbar` + value attributes) with safe step bounds

## Handoff
- Phase 137e should run `impeccable-polish` + supporting visual consistency passes on hardened surfaces:
  - `components/dashboard/settings-view.tsx`
  - `components/dashboard/action-station.tsx`
  - `components/dashboard/crm-drawer.tsx`
- Preserve all resilience semantics introduced in 137d (ARIA labels/live regions, retry affordances, deferred load behavior) while polishing spacing/visual hierarchy.
- Keep performance-neutral edits where possible and re-run `npm run lint` + `npm run build -- --webpack`.

## Validation (RED TEAM)
- `git status --porcelain` checked before and after code edits.
- `ls -dt docs/planning/phase-* | head -10` used for overlap checks.
- `rg -n "loadIntegrationsSlice|loadBookingSlice|refreshAiObservability|handleSaveSettings|role=\"status\""` run against `components/dashboard/settings-view.tsx` to confirm deferred-loader and hardening touch points exist after refactor.
- `npm run lint` -> pass (16 warnings, 0 errors) after hardening changes.
- `npm run build -- --webpack` -> pass after hardening changes.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Started d-stage resilience hardening by improving sidebar polling failure behavior.
  - Added graceful error handling so count fetch failures no longer risk leaving loading state unresolved.
  - Added image decoding/loading hints for non-blocking logo rendering.
  - Added workspace branding hardening path in General settings:
    - admin-gated brand fields in `UserSettingsData` and `updateUserSettings`
    - new `uploadWorkspaceBrandLogo` server action (5MB + PNG/JPG/WebP + public URL + previous object cleanup)
    - crop+resize upload UI in Settings General tab with freeform crop controls and theme-aware canvas fill
  - Migrated auth logos + sidebar logo rendering toward `next/image` while preserving workspace logo fallback behavior.
  - Ran parallel subagent re-checks for Action Station, Settings-General, and CRM Drawer to refresh skill routing and high-risk defect queue.
  - Applied top-priority hardening fixes from subagent findings:
    - `components/dashboard/crm-drawer.tsx`
      - guarded workspace-name null path (`workspaceName` fallback before `.toLowerCase()`)
      - reset booking dialog state/slots/selection on lead switch to prevent stale slot reuse
      - reset slot state when opening booking dialog and when `lead.clientId` is unavailable
    - `components/dashboard/action-station.tsx`
      - blocked Enter-to-send while send/regenerate is already in-flight
      - blocked send/approve handlers while pending
      - added request-sequence guard to avoid stale draft fetch state overwrite when channel/conversation changes quickly
  - Ran two parallel subagent audits focused on `settings-view`:
    - `impeccable-optimize` routing check for eager fetch hotspots and tab-gated loading candidates
    - `impeccable-harden` + `impeccable-rams` check for async race safety and loading-state accessibility
  - Implemented settings-shell load-path hardening/optimization in `components/dashboard/settings-view.tsx`:
    - kept `loadSettings` focused on core settings hydration + minimal calendar links for General-tab warnings
    - deferred Integrations and Booking heavy loads into tab-gated slice loaders with delayed background prefetch
    - added per-workspace deferred-slice cache (`integrations`, `booking`) to avoid repeated tab-switch fetch churn
    - added workspace-staleness guard via `activeWorkspaceRef` for deferred async loaders
    - gated AI observability refresh to AI/Admin tabs only
    - added missing workspace guard in save handler (`Select a workspace before saving settings`)
    - added a11y loading semantics (`role="status"`, `aria-live="polite"`, SR label)
  - Ran RED TEAM/phase-gaps delta check for this turn:
    - verified new deferred-load symbols and accessibility hooks exist in file reality
    - captured remaining stale-state interaction risk in root phase plan for 137d/137f validation
  - Applied `impeccable-rams` fixes in `components/dashboard/crm-drawer.tsx`:
    - added select trigger labeling/descriptions for Status and Sentiment controls
    - added live-region semantics for response timing, sequence, appointment-history, and booking-slot loading states
    - added accessible follow-up progressbar semantics and hardened zero-step edge case
  - Applied `impeccable-clarify` + hardening pass in `components/dashboard/action-station.tsx`:
    - improved LinkedIn status-check copy and added explicit retry affordance
    - added explicit “status unknown” messaging when LinkedIn status fetch fails
    - replaced generic send-failure fallback with channel-specific recovery copy
- Commands run:
  - `npm run lint` — pass (16 warnings, 0 errors).
  - `npm run build -- --webpack` — pass.
  - `npm run lint` — pass (15 warnings, 0 errors) after CRM/Action Station hardening slice.
  - `npm run build -- --webpack` — pass after CRM/Action Station hardening slice.
- Blockers:
  - No hard blocker in subphase 137d scope.
- Next concrete steps:
  - Begin 137e visual polish pass on newly hardened surfaces.
  - Carry deferred-loader interaction verification into 137f regression packet (workspace/tab/provider churn checklist).

## Coordination Notes
**Files modified:** `components/dashboard/settings-view.tsx` and phase-137 planning docs.  
**Potential conflicts with:** uncommitted multi-agent changes exist in AI/knowledge modules and Prisma schema (`lib/ai-drafts.ts`, `lib/knowledge-asset-*`, `prisma/schema.prisma`, etc.); this turn avoided those files and merged only against current `settings-view` state.  
**Integration notes:** preserved admin-only settings writes and existing workspace contracts; deferred loaders are additive and keep integration/booking behavior intact while reducing general-tab startup work.
