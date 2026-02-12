# Phase 141e — Step 2 Independent Toggle + Step1→Step3 Runtime Preservation

## Focus

Implement a fourth independent workspace AI-route toggle (`draftGenerationStep2Enabled`) with default ON, and ensure turning Step 2 OFF still generates an email draft by preserving a Step 1 -> Step 3 path.

## Inputs

- Root phase requirements in `docs/planning/phase-141/plan.md` (updated locked decision for Step 2 independence).
- Existing route-toggle implementation:
  - `prisma/schema.prisma`
  - `actions/settings-actions.ts`
  - `components/dashboard/settings-view.tsx`
  - `lib/ai-drafts.ts`
  - `lib/ai/route-skip-observability.ts`
  - `actions/ai-observability-actions.ts`
  - `actions/message-actions.ts`
- Multi-agent overlap signals from recent phases:
  - Phase 142: `prisma/schema.prisma`, `actions/settings-actions.ts`, `components/dashboard/settings-view.tsx`
  - Phase 143: `lib/ai-drafts.ts`
  - Phase 144: `components/dashboard/settings-view.tsx`

## Work

1. Add `draftGenerationStep2Enabled` in `WorkspaceSettings` with `@default(true)`.
2. Wire setting through `UserSettingsData`, `getUserSettings`, and `updateUserSettings` (defaults, read mapping, admin-gated writes, upsert create/update).
3. Add Admin-tab UI toggle and route-activity card support in settings view.
4. Add runtime Step 2 gating in `generateResponseDraft()`:
   - Skip Step 2 when disabled.
   - Record route skip telemetry as `draft_generation_step2`.
   - Preserve draft generation by building a Step 1-backed bridge draft so Step 3 can still run.
5. Extend route-skip observability types/mapping/counts with the new route key.
6. Surface Step 2 disabled notices in manual regeneration flows.
7. Re-run quality gates and schema sync.

## Validation (RED TEAM)

- `npm run lint` — pass (warnings only, no new errors).
- `npm run build` — pass.
- `npm run db:push` — pass, schema synced.
- `rg -n "draftGenerationEnabled|draftGenerationStep2Enabled|draftVerificationStep3Enabled|meetingOverseerEnabled" prisma/schema.prisma actions/settings-actions.ts components/dashboard/settings-view.tsx lib/ai-drafts.ts` — pass.
- `rg -n "draft_generation_step2|ai.route_skip.draft_generation_step2.v1" actions/ai-observability-actions.ts lib/ai/route-skip-observability.ts lib/ai-drafts.ts components/dashboard/settings-view.tsx` — pass.
- `rg -n "DRAFT_GENERATION_STEP2_DISABLED_NOTICE|draft_generation_step2" actions/message-actions.ts` — pass.

## Output

- Added independent Step 2 toggle end-to-end with default ON persistence and admin-only mutation controls.
- Runtime now supports Step 2 OFF without disabling overall draft creation by using a Step 1-backed bridge draft before Step 3.
- Added Step 2 route skip telemetry + admin observability counters/event labeling.
- Added manual-action notice messaging for Step 2 disabled state.

## Handoff

- Remaining non-code validation: execute live runtime matrix in a workspace (Step 2 ON/OFF with Step 3 ON/OFF) and capture `AIDraft` + `AIInteraction` evidence in phase review.

## Progress This Turn (Terminus Maximus)

- Work done:
  - Implemented Step 2 independent toggle across schema/settings/UI/runtime/observability/manual notices.
  - Added `buildStep1BridgeEmailDraft()` to preserve generation when Step 2 is disabled.
  - Added route skip key/mapping/count/event handling for `draft_generation_step2`.
  - Updated phase root plan for new subphase and locked decision scope.
  - Ran a post-implementation RED TEAM sub-agent pass and patched notice behavior to be channel-aware (avoid Step 2/Step 3 notices on non-email channels).
- Commands run:
  - `git status --short` — confirmed heavy multi-phase overlap before edits.
  - `ls -dt docs/planning/phase-* | head -10` — reviewed recent overlap phases.
  - `npm run lint` — pass.
  - `npm run build` — pass.
  - `npm run db:push` — pass.
  - `npm run lint` (post-RED-TEAM fix) — pass.
  - `npm run build` (post-RED-TEAM fix) — pass.
  - Validation grep matrix listed above — pass.
- Coordination notes:
  - Merged on shared files by symbol anchors only (`lib/ai-drafts.ts`, `components/dashboard/settings-view.tsx`, `actions/settings-actions.ts`, `prisma/schema.prisma`).
  - Explicitly avoided unrelated refactors in concurrent-phase hotspots.
- Blockers:
  - None for implementation.
- Next concrete steps:
  - Capture live telemetry/DB evidence for Step 2 OFF behavior in phase review.
