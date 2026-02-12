# Phase 141 — AI Pipeline Route Switches (Per-Workspace UI Toggles)

## Purpose

Add on/off switches in the workspace Settings UI for four AI pipeline routes: draft generation, draft generation Step 2, draft verification (Step 3), and the Meeting Overseer scheduling gate. Allows workspace admins to disable AI routes that are causing more harm than good without code changes or redeployment.

## Context

Recent production issues (Phases 135, 140, 119) show the AI draft verification step actively worsening drafts — stripping valid pricing, aggressively rewriting content. The Meeting Overseer has separate scheduling coherence issues. Rather than refactoring the pipeline, simple per-workspace toggles let admins disable specific routes immediately while root-cause fixes land in parallel phases.

Deterministic post-processing (booking link enforcement, forbidden terms, pricing safety, em-dash normalization, length clamping) remains mandatory for drafts that are produced. If draft generation is disabled, that post-pass does not run because no draft is created.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 137 | Active (uncommitted) | `components/dashboard/settings-view.tsx`, `actions/settings-actions.ts` | Settings shell is still being refined; re-read current file state immediately before edits. |
| Phase 138 | Active (uncommitted) | `lib/ai-drafts.ts`, `lib/followup-engine.ts`, `lib/meeting-overseer.ts` | Shared scheduling/overseer surfaces; merge by symbol, not by stale line numbers. |
| Phase 139 | Active (uncommitted) | `lib/ai-drafts.ts`, `lib/followup-engine.ts`, `lib/meeting-overseer.ts` | Timezone + overseer v2 changes already landed; preserve those paths while adding gates. |
| Phase 140 | Active (uncommitted) | `lib/ai-drafts.ts`, pricing/Step 3 logic | Step 3 toggle must preserve pricing safety post-pass and existing telemetry patterns. |
| Phase 142 | Active (uncommitted) | `prisma/schema.prisma`, `actions/settings-actions.ts`, `components/dashboard/settings-view.tsx` | Booking qualification rollout is sharing settings/schema surfaces; avoid non-141 refactors in those files. |
| Phase 143 | Active (uncommitted) | `lib/ai-drafts.ts` | Action-signal prompt/context work shares `generateResponseDraft()` hotspots; keep edits symbol-local. |
| Phase 144 | Active (uncommitted) | `components/dashboard/settings-view.tsx` | Performance phase is actively reshaping settings UI; preserve existing AI-route behavior while merging. |

## Objectives

* [x] Add 4 boolean fields to WorkspaceSettings schema (`draftGenerationEnabled`, `draftGenerationStep2Enabled`, `draftVerificationStep3Enabled`, `meetingOverseerEnabled`)
* [x] Wire fields through server action (load + save)
* [x] Place the route toggle switches in `Settings -> Admin -> Admin Dashboard`
* [x] Add runtime checks in `lib/ai-drafts.ts` with `?? true` fallbacks
* [x] Ensure Step 2 can be disabled independently while preserving draft generation (`Step 1 -> Step 3` when Step 2 is off)
* [x] Apply `meetingOverseerEnabled` across both draft path and follow-up auto-booking overseer paths
* [x] Add disabled-route notices across all manual draft-generation entry points (with Admin-tab location guidance)
* [x] Add admin Settings visibility for route state + skip activity (status cards + recent events)
* [x] Validate behavior across all `generateResponseDraft()` callsites (webhooks, background jobs, manual actions)
* [x] Record Step 2 route-skip telemetry in all manual flows with per-lead granularity
* [ ] Verify lint, build, and toggle-state outcomes with explicit DB/telemetry checks

## Constraints

- All toggles default to `true` (no behavior change until explicitly turned off)
- Toggle settings are independent (no automatic setting-to-setting coupling; one toggle changing must not auto-toggle another)
- Every runtime check uses `settings?.field ?? true` fallback for null safety
- Step 2 toggle must be independent of Step 1/Step 3 and must not block overall draft creation when disabled
- No pipeline refactoring — toggles wrap existing code blocks with `if` checks
- Follow existing Switch pattern in `components/dashboard/settings-view.tsx` (ARIA labels, admin-gated)
- Enforce admin-only writes server-side in `actions/settings-actions.ts` (`requireClientAdminAccess` path), not just disabled UI controls
- Do not rely on hardcoded line numbers in shared hot files (`lib/ai-drafts.ts`); patch by function/symbol anchors
- Update all default-setting paths in `getUserSettings()` and `workspaceSettings.create` fallback to keep payloads structurally consistent
- Verify no regressions in idempotency path (`triggerMessageId` existing-draft return path) when generation toggle is off
- Toast/notice messaging for disabled routes must be shown across all manual draft-generation entry points only (not webhooks/background jobs)
- All disabled-route guidance text must point to `Settings -> Admin -> Admin Dashboard`
- Skipped-route observability must include structured logs and persisted artifacts/metadata for admin visibility
- Manual Step 2 skip telemetry should emit per-lead events in all manual flows (forward-only; no history backfill)
- `npm run lint` and `npm run build` must pass
- `npm run db:push` after schema change (`DIRECT_URL` configured)

## Repo Reality Check (RED TEAM)

- What exists today:
  - Workspace settings schema is in `prisma/schema.prisma` (`WorkspaceSettings` model).
  - Settings read/write path is centralized in `actions/settings-actions.ts` (`UserSettingsData`, `getUserSettings`, `updateUserSettings`).
  - Settings UI controls live in `components/dashboard/settings-view.tsx`; save action is `handleSaveSettings` (not `handleSave`).
  - Draft runtime path is `generateResponseDraft()` in `lib/ai-drafts.ts`.
- `generateResponseDraft()` is called from webhook routes, background jobs, pipeline orchestration, and manual actions.
- Route skip observability lives in `lib/ai/route-skip-observability.ts` and is surfaced in `actions/ai-observability-actions.ts` via `getAiRouteSkipSummary()`.
- Draft-generation gate returns `{ blockedBySetting, skippedRoutes, runId }` (no `draftId`/`content`) when disabled.
- Email pipeline currently uses Step 1 strategy + Step 2 generation + Step 3 verification; Step 2 disable must preserve downstream draft production.
- What the original plan assumed:
  - Line anchors in `lib/ai-drafts.ts` were stale (high churn from phases 138/139/140).
  - Meeting Overseer gating scope was implicitly limited to draft path only.
  - Route-skip naming used `meeting_overseer_draft_path`, but code uses `meeting_overseer_draft` / `meeting_overseer_followup`.
  - Toggle location decision was unresolved (Email Draft Generation vs Campaign Strategist); human decision now requires Admin-tab placement.
- Verified touch points:
  - `prisma/schema.prisma` (`model WorkspaceSettings`)
  - `actions/settings-actions.ts` (`UserSettingsData`, `getUserSettings`, `updateUserSettings`, admin gating flags)
  - `components/dashboard/settings-view.tsx` (`handleSaveSettings`, AI route toggles card, AI Route Switch Activity)
  - `lib/ai-drafts.ts` (`generateResponseDraft`, Step 3 verifier block, Meeting Overseer gate block)
  - `lib/followup-engine.ts` (`runMeetingOverseerExtraction` usage; meeting overseer gate + skip recording)
  - `actions/message-actions.ts` (manual regenerate path + UI notices)
  - `lib/ai/route-skip-observability.ts` (skip interaction prompt keys)
  - `actions/ai-observability-actions.ts` (skip summary aggregation + mapping)

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Shared-file merge race in `lib/ai-drafts.ts` and settings surfaces can silently drop gating logic.
  - Mitigation: enforce symbol-anchored edits and re-read file state immediately before each patch.
- Toggle-off behavior can appear successful while downstream flows expect `draftId`/`content`.
  - Mitigation: validate all callsites that consume `generateResponseDraft()` output.

### Missing or ambiguous requirements
- Admin gating requirement was UI-first; server enforcement details were underspecified.
  - Plan fix: explicitly wire new fields into admin-gated update flags in `updateUserSettings()`.
- Default-setting paths were incomplete (no-workspace defaults + create fallback path).
  - Plan fix: include both default object and `workspaceSettings.create` path updates.
- Decision lock applied:
  - `meetingOverseerEnabled` applies to all overseer routes (draft + follow-up engine).
  - `draftGenerationEnabled` preserves existing-draft idempotent returns and blocks only new generation.
  - Manual actions surface disabled-route toasts; admin settings include status cards + recent skip events.

### Repo mismatches (fix the plan)
- `components/dashboard/settings-view.tsx` save function is `handleSaveSettings`.
- Original `lib/ai-drafts.ts` line references in 141c were stale and non-actionable under concurrent edits.
- Skip-route naming uses `meeting_overseer_draft` / `meeting_overseer_followup` (not `meeting_overseer_draft_path`).
- Current code places toggles in Campaign Strategist card; locked decision requires moving them to `Settings -> Admin -> Admin Dashboard`.
- Step 2 route skip key was not represented in route-skip observability summary/types.

### Performance / timeouts
- New gates should not add new LLM latency; they should reduce it when disabled.
  - Plan fix: no additional prompt calls introduced; preserve existing timeout configuration on remaining enabled paths.

### Security / permissions
- Non-admin mutation risk if new fields are not included in server-side admin flag checks.
  - Plan fix: require `requireClientAdminAccess` coverage for new toggle fields.

### Testing / validation
- Lint/build-only validation is insufficient for behavioral toggles.
  - Plan fix: add runtime validation matrix (DB record checks + pipeline artifact/AIInteraction checks) and caller-safety checks.
- Route-skip observability depends on `AIInteraction` rows with `featureId = ai.route_skipped` and prompt keys `ai.route_skip.*`; verify those, not `draft.verify.email.step3`, when toggles are disabled.
- Manual UI “fast regenerate” path does not surface Step 3 / Meeting Overseer skip notices; if required, add explicit coverage.

## Success Criteria

- All 4 switches visible in `Settings -> Admin -> Admin Dashboard` with admin gating
- With default settings (all ON), email draft pipeline executes Step 1 → Step 2 → Step 3.
- Toggle off "AI Draft Generation" → no AIDraft records created for new inbound messages
- Toggle off "Draft Generation (Step 2)" → Step 2 route skip telemetry emitted (`ai.route_skip.draft_generation_step2.v1`) and draft generation continues through Step 1-backed draft + Step 3.
- Toggle off "Draft Verification" → no Step 3 verifier AI calls; skip interactions recorded under `ai.route_skipped` (`ai.route_skip.draft_verification_step3.v1`)
- Toggle off "Meeting Overseer" → no meeting overseer AI interactions/decisions from either `lib/ai-drafts.ts` or follow-up overseer extraction paths; skip interactions recorded under `ai.route_skipped` (`ai.route_skip.meeting_overseer_*`)
- Deterministic post-pass continues for produced drafts regardless of Step 3/Meeting Overseer toggle states
- All manual draft-generation entry points show disabled-route guidance/notices when relevant, including where to re-enable in `Settings -> Admin -> Admin Dashboard`
- Manual flows emit per-lead Step 2 skip telemetry when Step 2 is disabled (including fast regenerate path).
- Admin Settings surface shows both:
  - route status cards with skip counters
  - recent skip event log
- All toggles ON → behavior identical to before this change
- Lint and build pass
- Validation matrix completed:
  - one run per channel (`email`, `sms`, `linkedin`) with generation toggle OFF
  - one email run with Step 3 OFF + generation ON
  - one meeting-intent run with meeting-overseer toggle OFF
  - verify expected absence/presence of `AIDraft`, `AIInteraction`, and draft pipeline artifact rows

## Subphase Index

* a — Schema + Server Action (database + persistence layer)
* b — Settings UI Switches (frontend layer)
* c — Runtime Checks in ai-drafts.ts (logic layer)
* d — RED TEAM Hardening + Cross-Path Gate + UX/Observability Validation (coordination layer)
* e — Step 2 Independent Toggle + Step1→Step3 Runtime Preservation (runtime/settings/observability)
* f — Manual Step 2 Telemetry Parity + NTTAN Gate + Phase Review Prep

## Locked Decisions (Human Confirmed — 2026-02-12)

- `meetingOverseerEnabled` toggle controls both:
  - draft-time meeting overseer path in `lib/ai-drafts.ts`
  - follow-up auto-booking overseer extraction path(s) in `lib/followup-engine.ts`
- When `draftGenerationEnabled` is off:
  - preserve idempotent return of existing draft for same `triggerMessageId`
  - block only creation of new drafts
- Disabled-route toast behavior:
  - show notices for all manual draft-generation entry points only
  - include where to re-enable in `Settings -> Admin -> Admin Dashboard`
- Toggle placement:
  - place route toggles under `Settings -> Admin -> Admin Dashboard` (not Email Draft Generation / Campaign Strategist)
- Toggle independence + defaults:
  - all four toggles ship default ON
  - toggles are configured independently (no auto-coupling between setting values)
  - default-on generation path includes Step 1 → Step 2 → Step 3 for email
  - when Step 2 is OFF, email generation still produces drafts via Step 1-backed bridge draft before Step 3
- Observability and admin visibility:
  - structured skip logs + persisted skip artifacts/metadata
  - admin settings include status cards and recent skip event log
- Manual telemetry parity decisions (Human Confirmed — 2026-02-12):
  - Step 2 skip telemetry should be recorded across all manual flows.
  - Step 2 OFF draft source remains Step 1 bridge draft path.
  - Metrics are forward-only (no historical backfill).
  - Manual skip telemetry granularity is per lead event.

## Assumptions (Agent)

- Assumption: defaulting new nullable settings to enabled via `settings?.field ?? true` is the correct backward-compatible contract for existing rows (confidence ~95%).
  - Mitigation check: verify one pre-existing workspace row with nulls still behaves as enabled.

## Phase Summary (running)

- 2026-02-12 00:00 UTC — Completed combined RED TEAM pass using sub-agents + main-agent verification; tightened repo-reality and validation criteria for route-skip telemetry and multi-agent conflict handling. Added explicit gaps for settings-path guidance mismatch, skip-route naming alignment, and manual fast-regenerate notice scope. Updated phase docs: `docs/planning/phase-141/plan.md`, `docs/planning/phase-141/d/plan.md`.
- 2026-02-12 00:00 UTC — Locked final product decisions: route toggles must live in `Settings -> Admin -> Admin Dashboard`; disabled-route notices must cover all manual draft-generation entry points. Updated root phase plan criteria/objectives/constraints accordingly.
- 2026-02-12 00:00 UTC — Implemented locked decision updates in code: moved AI route toggles to Admin tab dashboard, updated manual guidance path to Admin Dashboard, added fast-regenerate notices, and added bulk-regeneration generation-disabled early fail. Re-ran lint/build and validation grep matrix. (files: `components/dashboard/settings-view.tsx`, `actions/message-actions.ts`, `components/dashboard/action-station.tsx`)
- 2026-02-12 00:00 UTC — Closed RED TEAM residual gap for bulk manual notice parity by propagating disabled-route notices through `regenerateAllDrafts` and surfacing them in the bulk regeneration card; re-ran lint/build (pass). (files: `actions/message-actions.ts`, `components/dashboard/settings/bulk-draft-regeneration.tsx`, `docs/planning/phase-141/d/plan.md`)
- 2026-02-12 00:00 UTC — Final scoped RED TEAM sanity pass on changed files reported no remaining actionable gaps for locked Phase 141 decisions.
- 2026-02-12 00:00 UTC — Ran `npm run db:push` for Phase 141 schema gate; Prisma confirmed database is already in sync.
- 2026-02-12 02:15 UTC — Implemented independent `draftGenerationStep2Enabled` toggle (default ON) across schema/settings/UI/runtime/manual notices/route-skip observability; added Step 1-backed bridge draft path so Step 2 OFF continues to Step 3. Re-ran `npm run lint`, `npm run build`, and `npm run db:push` (pass). (files: `prisma/schema.prisma`, `actions/settings-actions.ts`, `components/dashboard/settings-view.tsx`, `lib/ai-drafts.ts`, `lib/ai/route-skip-observability.ts`, `actions/ai-observability-actions.ts`, `actions/message-actions.ts`)
- 2026-02-12 02:20 UTC — Ran post-implementation RED TEAM sub-agent pass; resolved residual notice mismatch by making disabled-route notices channel-aware (Step 2/Step 3 notices only for email) and revalidated with `npm run lint` + `npm run build` (pass). (files: `actions/message-actions.ts`, `docs/planning/phase-141/e/plan.md`)
- 2026-02-12 02:48 UTC — Completed Phase 141f manual Step 2 telemetry parity check: confirmed `fastRegenerateDraft` as the only manual path bypassing `generateResponseDraft()` and added explicit per-lead Step 2 skip telemetry there. Re-ran NTTAN gate: `npm run test:ai-drafts` passed; both `npm run test:ai-replay` commands failed with Prisma `P1001` (database unreachable at `db.pzaptpgrcezknnsfytob.supabase.co`). Phase remains partial pending replay gate execution after DB connectivity is restored. (files: `actions/message-actions.ts`, `docs/planning/phase-141/f/plan.md`)
- 2026-02-12 02:48 UTC — Executed explicit sub-agent + main-agent red-team comparison for Phase 141f and folded findings into docs: added missing validation mappings (`rg`, `lint`, `build`), added concrete replay unblock steps (DNS/network/env + real client-id resolution), and refreshed concurrent-phase overlap table to include phases 142/143/144. Re-validated `npm run lint` and `npm run build` (pass, warnings only). (files: `docs/planning/phase-141/plan.md`, `docs/planning/phase-141/f/plan.md`)
- 2026-02-12 02:59 UTC — Pulled real client IDs from Supabase via MCP (`Client` table) and re-ran replay with valid client ID `29156db4-e9bf-4e26-9cb8-2a75ae3d9384`; replay still failed with Prisma `P1001` at `db.pzaptpgrcezknnsfytob.supabase.co`, confirming blocker is environment DB connectivity (not client-id selection). (files: `docs/planning/phase-141/f/plan.md`)
- 2026-02-12 03:27 UTC — Implemented live replay robustness patch (default `--channel any` + fallback widening + hard fail on empty selection unless `--allow-empty`) and added historical outbound comparison context to replay judge input. Revalidated `lint`, `build`, `test:ai-drafts`, and replay unit tests (pass). Replay dry-run now selects 20 cases for `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`; full replay remains blocked by OpenAI 401 invalid API key in this environment. (files: `lib/ai-replay/*`, `scripts/live-ai-replay.ts`, `lib/ai/prompt-registry.ts`, `docs/planning/phase-141/f/plan.md`)
