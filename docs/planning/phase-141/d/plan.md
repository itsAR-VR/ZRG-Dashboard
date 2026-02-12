# Phase 141d — RED TEAM Hardening + Cross-Path Gate + UX/Observability Validation

## Focus

Close the gaps discovered in RED TEAM review and apply locked product decisions:
- lock down multi-agent coordination for shared hotspots,
- apply Meeting Overseer toggle to all relevant runtime paths,
- add manual-action disabled-route toasts,
- add admin Settings visibility for route state + skip activity,
- execute explicit runtime validation matrix for toggle behavior.

## Inputs

- Root plan updates in `docs/planning/phase-141/plan.md` (Repo Reality Check + RED TEAM Findings + Locked Decisions).
- Existing implementation targets from 141a/141b/141c:
  - `prisma/schema.prisma`
  - `actions/settings-actions.ts`
  - `components/dashboard/settings-view.tsx`
  - `lib/ai-drafts.ts`
- Related overlapping runtime for scope decision:
  - `lib/followup-engine.ts`
  - `lib/meeting-overseer.ts`
- Manual draft action surfaces:
  - `actions/message-actions.ts`
- Existing draft pipeline observability artifacts/metadata paths in `lib/ai-drafts.ts`.
- Active concurrent-phase state from current working tree (`git status --porcelain`).

## Work

1. **Pre-flight conflict check (required)**
   - Re-run:
     - `git status --porcelain`
     - `ls -dt docs/planning/phase-* | head -10`
   - Re-open current versions of all shared target files immediately before editing.
   - Merge by symbol/function anchors only; do not use stale line-number edits.

2. **Server + UI contract hardening**
   - Ensure new toggle fields are included in:
     - `UserSettingsData`,
     - `getUserSettings()` no-workspace default object,
     - `workspaceSettings.create` fallback object,
     - response mapping return object,
     - admin-gated `updateUserSettings()` write flags.
   - Ensure UI load/save path includes new fields through `handleSaveSettings`.

3. **Cross-path overseer gate completion**
   - Apply `meetingOverseerEnabled` check to follow-up overseer extraction path(s) in `lib/followup-engine.ts`.
   - Ensure behavior is consistent with ai-drafts overseer toggle semantics.
   - Emit structured skip telemetry for follow-up overseer skip events.

4. **Manual-action UX feedback**
   - For all manual draft-generation entry points only, show disabled-route messaging when route is disabled:
     - draft generation disabled
     - draft verification disabled (if surfaced in manual flow)
     - meeting overseer disabled (if surfaced in manual flow)
   - Include at minimum:
     - `regenerateDraft`
     - `fastRegenerateDraft`
     - manual/bulk admin regeneration paths (`regenerateDraftSystem` / `regenerateAllDrafts` user-visible result semantics)
   - Messaging must include where route can be re-enabled: `Settings -> Admin -> Admin Dashboard`.
   - Do not add toasts for webhook/background flows.

5. **Admin Settings visibility (both now)**
   - Move/ensure route-toggle control block is in `Settings -> Admin -> Admin Dashboard`.
   - Add route status cards with skip counters.
   - Add recent skip event log section in Settings admin panel.
   - Source data from structured logs + persisted skip artifacts/metadata.

6. **Runtime gate safety checks**
   - Confirm `draftGenerationEnabled` gate blocks *new* draft creation while preserving idempotent existing-draft lookups unless product decision changes.
   - Confirm Step 3 gate only impacts verifier route and keeps deterministic post-pass intact for produced drafts.
   - Confirm `meetingOverseerEnabled` gate is enforced in both ai-drafts and follow-up overseer extraction paths.
   - Confirm toggle settings are independent (no automatic setting-to-setting coupling) and default ON state runs email pipeline Step 1 → Step 2 → Step 3.

7. **Validation matrix execution**
   - Run `npm run lint`.
   - Run `npm run build` (if blocked by unrelated existing failures, document blocker ownership).
   - Execute toggle-state runtime checks and verify DB/telemetry outcomes:
     - generation OFF,
     - verification OFF,
     - meeting overseer OFF,
     - all ON.
   - Validate expected `AIDraft` and `AIInteraction` presence/absence plus pipeline artifact behavior.
   - Validate manual-action toast behavior and admin visibility sections.

8. **Coordination notes + conflict log**
   - If conflicts are encountered, append conflict-resolution log in root phase plan execution notes:
     - issue, cause (phase/file), resolution, files affected.

## Validation (RED TEAM)

- `rg -n "draftGenerationEnabled|draftVerificationStep3Enabled|meetingOverseerEnabled" prisma/schema.prisma actions/settings-actions.ts components/dashboard/settings-view.tsx lib/ai-drafts.ts`
- `rg -n "UserSettingsData|getUserSettings|updateUserSettings|bookingQualificationCheckEnabled" actions/settings-actions.ts`
- `rg -n "generateResponseDraft\\(" app/api lib/background-jobs lib/inbound-post-process actions`
- `rg -n "runMeetingOverseerExtraction|shouldRunMeetingOverseer|runMeetingOverseerGate" lib/followup-engine.ts lib/ai-drafts.ts`
- `rg -n "toast|Settings|disabled" actions/message-actions.ts components/dashboard/settings-view.tsx`
- `rg -n "AI_ROUTE_SETTINGS_PATH|Admin Dashboard|fastRegenerateDraft|regenerateDraft|regenerateAllDrafts" actions/message-actions.ts components/dashboard/action-station.tsx components/dashboard/settings-view.tsx`
- `rg -n "ai.route_skip\\.|ai.route_skipped|meeting_overseer_draft|meeting_overseer_followup" lib/ai/route-skip-observability.ts actions/ai-observability-actions.ts lib/ai-drafts.ts lib/followup-engine.ts`
- `rg -n "handleSaveSettings|draftGenerationEnabled|draftVerificationStep3Enabled|meetingOverseerEnabled" components/dashboard/settings-view.tsx`
- `npm run lint`
- `npm run build`

## Output

- Coordinated, conflict-aware execution plan for remaining Phase 141 work with locked scope/UX/observability decisions applied.
- Validation matrix results documented with pass/fail evidence and any known external blockers clearly called out.

## Handoff

Proceed to implementation with Phase 141d as authoritative override for RED TEAM gaps and locked product decisions.

## Progress This Turn (Terminus Maximus)

### What was done

- Ran a multi-agent RED TEAM pass plus main-agent verification against phase docs and live code.
- Verified overlap/conflict risk across the last 10 phases (`144, 142, 143, 141, 139, 137, 138, 140, 136, 135`).
- Compared sub-agent findings against current symbols and updated root plan gaps/criteria accordingly.

### Sub-agent comparison outcome

- Shared agreed high-risk findings:
  - UI guidance mismatch: `AI_ROUTE_SETTINGS_PATH` currently points to `Email Draft Generation` while toggles are rendered in the Campaign Strategist card.
  - Skip-route naming mismatch in planning text: implementation uses `meeting_overseer_draft` / `meeting_overseer_followup` (not `meeting_overseer_draft_path`).
  - Success validation mismatch: disabled Step 3 should be validated via skip telemetry (`featureId = ai.route_skipped`), not only Step 3 prompt keys.
  - Multi-agent merge risk remains high in `lib/ai-drafts.ts`, `lib/followup-engine.ts`, `actions/settings-actions.ts`, and `components/dashboard/settings-view.tsx`.
- Additional medium-risk finding:
  - `fastRegenerateDraft` is manual/UI but does not currently surface Step 3/Meeting Overseer skip notices.

### Commands executed (non-mutating validation)

- `git status --short`
- `ls -1dt docs/planning/phase-* | head -n 12`
- `rg -n "draftGenerationEnabled|draftVerificationStep3Enabled|meetingOverseerEnabled|blockedBySetting|skippedRoutes|recordAiRouteSkip" lib/ai-drafts.ts`
- `rg -n "meetingOverseerEnabled|recordAiRouteSkip|meeting_overseer_followup" lib/followup-engine.ts`
- `rg -n "DRAFT_GENERATION_DISABLED|notices|AI_ROUTE_SETTINGS_PATH|fastRegenerateDraft" actions/message-actions.ts`
- `rg -n "getAiRouteSkipSummary|AI_ROUTE_SKIP_FEATURE_ID|aiRouteSkips|aiPipelineToggles" actions/ai-observability-actions.ts components/dashboard/settings-view.tsx lib/ai/route-skip-observability.ts`
- `rg -n "prisma/schema.prisma|actions/settings-actions.ts|components/dashboard/settings-view.tsx|lib/ai-drafts.ts|lib/followup-engine.ts" docs/planning/phase-{135,136,137,138,139,140,141,142,143,144} -g 'plan.md'`

### Coordination Notes

- File overlap confirmed with active phases:
  - Phase 142: `prisma/schema.prisma`, `actions/settings-actions.ts`, `components/dashboard/settings-view.tsx`
  - Phase 144: `components/dashboard/settings-view.tsx`, `components/dashboard/action-station.tsx`
  - Phase 139/140/143: `lib/ai-drafts.ts`; Phase 138/139: `lib/followup-engine.ts`
- Conflict handling applied:
  - Plan now requires symbol-anchored merging and file re-read before edits in shared hotspots.
  - Validation now includes route-skip key checks and settings-contract checks to catch silent field drops.

### Remaining actions

- Execute manual runtime matrix for toggle states and capture DB/telemetry evidence.

## Progress This Turn (Terminus Maximus) — Execution Pass

- Work done:
  - Moved AI route toggle controls from the Campaign Strategist section to `Settings -> Admin -> Admin Dashboard` (`components/dashboard/settings-view.tsx`).
  - Updated disabled-route guidance path constant to `Settings -> Admin -> Admin Dashboard` (`actions/message-actions.ts`).
  - Added disabled-route notices to `fastRegenerateDraft` (Step 3 + Meeting Overseer off-state notices).
  - Surfaced fast-regenerate notices in UI toasts (`components/dashboard/action-station.tsx`).
  - Added early workspace-level `draftGenerationEnabled` guard for bulk manual regeneration (`regenerateAllDrafts`) to return explicit disabled guidance.
- Commands run:
  - `npm run lint` — pass (warnings only; existing react-hooks + baseline-browser-mapping warnings).
  - `npm run build` — pass (Next build succeeded; existing baseline-browser-mapping + middleware deprecation warnings only).
  - `rg -n "draftGenerationEnabled|draftVerificationStep3Enabled|meetingOverseerEnabled" prisma/schema.prisma actions/settings-actions.ts components/dashboard/settings-view.tsx lib/ai-drafts.ts` — pass.
  - `rg -n "generateResponseDraft\\(" app/api lib/background-jobs lib/inbound-post-process actions` — pass.
  - `rg -n "runMeetingOverseerExtraction|shouldRunMeetingOverseer|runMeetingOverseerGate|meetingOverseerEnabled" lib/followup-engine.ts lib/ai-drafts.ts` — pass.
  - `rg -n "AI_ROUTE_SETTINGS_PATH|Admin Dashboard|fastRegenerateDraft|regenerateDraft|regenerateAllDrafts|result\\.notices" actions/message-actions.ts components/dashboard/action-station.tsx components/dashboard/settings-view.tsx` — pass.
- Coordination conflicts:
  - Overlap confirmed with active/recent phases:
    - Phase 142 (`actions/settings-actions.ts`, `components/dashboard/settings-view.tsx`, `prisma/schema.prisma`)
    - Phase 144 (`components/dashboard/settings-view.tsx`, `components/dashboard/action-station.tsx`)
    - Phase 139/140/143 (`lib/ai-drafts.ts`)
  - Resolution: edits were restricted to 141-owned symbols in UI/manual-action layers; no drive-by edits to shared runtime logic outside agreed 141 scope.
- Blockers:
  - None for code changes.
  - Remaining validation requires manual runtime toggle-matrix checks (DB/telemetry assertions) in a live/test workspace.
- Next concrete steps:
  - Run manual toggle-state matrix:
    - generation OFF, verification OFF, overseer OFF, all ON
    - verify `AIDraft`/`AIInteraction`/pipeline artifact expected presence/absence.
  - Capture evidence in this subphase Output and then finalize phase review.

## Progress This Turn (Terminus Maximus) — Execution Pass 2 + RED TEAM

- Work done:
  - Closed the remaining manual-entry notice gap from RED TEAM:
    - Added shared disabled-route notice helper in `actions/message-actions.ts`.
    - Propagated Step 3/Meeting Overseer off-state notices into `fastRegenerateDraft`.
    - Added bulk-manual notice propagation by extending `RegenerateAllDraftsResult` with optional `notices` and populating from workspace settings.
    - Surfaced bulk notices in `components/dashboard/settings/bulk-draft-regeneration.tsx` on initial run.
- Commands run:
  - `npm run lint` — pass (warnings only; unchanged baseline warnings).
  - `npm run build` — pass.
  - `npm run db:push` — pass (`database is already in sync`).
  - `rg -n "AI_ROUTE_SETTINGS_PATH|Admin Dashboard|fastRegenerateDraft|regenerateAllDrafts|notices" actions/message-actions.ts components/dashboard/action-station.tsx components/dashboard/settings/bulk-draft-regeneration.tsx` — pass.
- RED TEAM wrap-up:
  - Finding addressed: bulk manual entry path lacked Step 3/Meeting Overseer disabled notices.
  - Final sanity RED TEAM pass (scoped to changed files) reported no remaining actionable gaps for locked decisions.
- Coordination notes:
  - Continued overlap with phases 142/144 on settings surfaces; changes remained scoped to route-toggle/manual-notice symbols.
- Blockers:
  - None for implementation.
  - Manual runtime matrix still pending (requires workspace-level execution + DB/telemetry inspection).
- Next concrete steps:
  - Execute manual matrix + telemetry assertions and append concrete evidence to Output.
