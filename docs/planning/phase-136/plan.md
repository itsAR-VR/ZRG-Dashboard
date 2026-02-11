# Phase 136 — Workspace-Level "Skip Human Review" Global Toggle

## Purpose

Add a workspace-level `autoSendSkipHumanReview` toggle that serves as the global default for all campaigns. Individual campaigns can override it (explicit true/false) or inherit the workspace value (null). This eliminates the need to toggle each campaign individually when you want fully-autonomous auto-send across the board.

## Context

Phase 130 added the per-campaign `autoSendSkipHumanReview` checkbox. However, workspaces with many campaigns must toggle each one individually — there's no global default. The user wants a single workspace-level switch that all campaigns inherit unless explicitly overridden, following the same inheritance pattern already used by `autoSendScheduleMode` (workspace default → campaign override → hardcoded fallback).

**Inheritance pattern (already established):**
- `autoSendScheduleMode`: workspace default (ALWAYS) → campaign nullable override → "ALWAYS" fallback
- Resolution: `lib/auto-send-schedule.ts:451-481` — `campaign ?? workspace ?? "ALWAYS"`
- UI: campaign shows "Inherit workspace" option when value is null

**Current state (campaign-only):**
- `EmailCampaign.autoSendSkipHumanReview` — `Boolean @default(false)`, no workspace equivalent
- Orchestrator reads: `context.emailCampaign?.autoSendSkipHumanReview === true` (line 279)
- Pipeline passes `lead.client?.settings` as `workspaceSettings` (line 368) — adding a field to the schema is sufficient for data flow

**Hard blocks always apply regardless of toggle state:** opt-out, blacklist, automated reply, empty draft.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 130 | Complete | Direct predecessor — added per-campaign toggle | Build on top; no conflict |
| Phase 135 | Complete | Touches `lib/ai-drafts.ts` (pricing) | Independent; no file overlap |

Uncommitted change: `components/dashboard/confidence-control-plane.tsx` — unrelated to this work.

## Objectives

* [x] Add `autoSendSkipHumanReview` field to `WorkspaceSettings` schema
* [x] Make `EmailCampaign.autoSendSkipHumanReview` nullable (null = inherit workspace)
* [x] Add resolution logic in orchestrator: campaign ?? workspace ?? false
* [x] Add workspace-level UI toggle in the Auto-Send Schedule settings card
* [x] Update campaign UI from checkbox to 3-state selector (Inherit / Skip / Require)

## Constraints

- Follow the existing `autoSendScheduleMode` inheritance pattern exactly
- Hard blocks must never be bypassed regardless of toggle state
- Workspace toggle must be admin-gated (`requireClientAdminAccess`)
- Backward-compatible: existing `false` values stay `false`, not `null`

## Success Criteria

- [x] Workspace toggle ON → campaign with `null` inherits → auto-send skips human review
- [x] Campaign explicit `false` → overrides workspace `true` → human review required
- [x] Hard blocks still force review regardless of any toggle
- [x] `npm run build` and `npm run lint` pass
- [x] `npm run db:push` applies cleanly

## Subphase Index

* a — Schema + types (Prisma schema, AutoSendContext type)
* b — Backend logic (orchestrator resolution, settings actions, campaign actions)
* c — Workspace settings UI (global toggle in Auto-Send Schedule card)
* d — Campaign settings UI (3-state selector replacing checkbox)

## Phase Summary

- Shipped:
  - Added workspace-level `autoSendSkipHumanReview` setting and converted campaign override to nullable inherit semantics.
  - Updated orchestrator decision logic to resolve `campaign ?? workspace ?? false`.
  - Updated settings and campaign actions to persist/read nullable override correctly (no boolean coercion of `null`).
  - Added workspace settings UI toggle and campaign-level 3-state selector (`Inherit workspace`, `Skip review`, `Require review`).
  - Added explicit workspace-setting field selection in inbound processing paths and tests for inheritance precedence.
- Verified:
  - `npm run db:push`: pass
  - `npm run lint`: pass (warnings only, no errors)
  - `npm run build`: pass
  - `npm test -- lib/auto-send/__tests__/orchestrator.test.ts`: pass
- Notes:
  - Backward-compatibility decision held: existing campaign `false` values remain `false`; no backfill to `null`.
  - Multi-agent overlap occurred in `actions/settings-actions.ts` and `components/dashboard/settings-view.tsx` due to concurrent Knowledge Asset work; changes were merged semantically and validated in combined-state lint/build.
