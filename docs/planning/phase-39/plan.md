# Phase 39 — AI Personas (Multi-Persona Support + Campaign Assignment)

## Purpose

Enable users to create multiple AI personas per workspace that define how the AI communicates (name, tone, greeting, signature, goals, service description), then assign these personas to campaigns for A/B testing different communication styles across different industries, lead types, or outreach strategies.

## Decisions Locked (Stakeholder Clarifications)

- The workspace keeps the existing **AI personality settings** behavior (legacy `WorkspaceSettings.ai*` fields remain and are not removed).
- The **default persona** is a real persona and is **kept in sync** with legacy `WorkspaceSettings` persona fields (and should not “get rid of” anything).
- A workspace with **zero personas** should **auto-create** a “Default Persona” on the **first visit** to AI Personality settings.
- Personas can be **renamed** (name is editable; still unique per workspace).
- `idealCustomerProfile` (ICP) stays **workspace-level** and should be moved out of AI Personality UI into **General Settings** UI.

## Plan Overrides (Read This)

Some earlier subphases (a–e) describe ICP as per-persona and/or prefer explicit user-driven default creation. These are superseded by the locked decisions above and by subphase **g** (added below). If there is any conflict, follow **g**.

## Context

Currently, AI personality settings are stored as single values on `WorkspaceSettings`:
- `aiPersonaName`, `aiTone`, `aiGreeting`, `aiSmsGreeting`, `aiSignature`, `aiGoals`
- `serviceDescription`, `idealCustomerProfile`

This one-size-fits-all approach limits experimentation. Different campaigns may benefit from different communication styles:
- **Direct/Aggressive** for time-sensitive offers
- **Consultative/Educational** for complex B2B sales
- **Casual/Friendly** for SMB outreach
- **Formal/Professional** for enterprise prospects

**Key requirements from stakeholder:**
> "Under the AI personality settings, I want to be able to create new personas and have multiple sets of AI personas."
> "These AI personas should also be able to be changed in the campaign assignment within the booking tab."

**Design decisions:**
1. **New `AiPersona` model**: Stores name, tone, greeting, smsGreeting, signature, goals, serviceDescription (ICP remains workspace-level)
2. **Default persona**: Each workspace has one default persona (used when no campaign-specific persona is assigned)
3. **Campaign assignment**: `EmailCampaign.aiPersonaId` (optional) - falls back to workspace default if null
4. **Migration**: Existing `WorkspaceSettings` persona fields are migrated to a "Default Persona" on first load (or via backfill)

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 38 | Uncommitted | Files: `lib/ai-drafts.ts` | Phase 38 improves JSON parsing robustness; no persona changes. Phase 39 will add persona lookup - changes are additive. |
| Phase 36 | Complete | Files: `lib/ai-drafts.ts`, `components/dashboard/settings/ai-campaign-assignment.tsx` | Phase 36 added booking process assignment. Phase 39 adds persona assignment following the same pattern. |
| Phase 37 | Complete | Files: `components/dashboard/settings-view.tsx` | Phase 37 was a11y pass. Phase 39 replaces AI Personality tab content - no conflict. |

**Coordination note (must do before 39e):** `lib/ai-drafts.ts` currently has uncommitted changes in the working tree. Reconcile/merge Phase 38 work first so persona integration is applied on top of the final, stable draft pipeline.

## Pre-Flight Conflict Check

- [ ] Ran `git status` — check for unexpected modifications to `lib/ai-drafts.ts`, `prisma/schema.prisma`, `components/dashboard/settings-view.tsx`
- [ ] Scanned last 10 phases — no overlapping persona-related changes
- [ ] Read current state of `WorkspaceSettings` persona fields and `lib/ai-drafts.ts` prompt builders

## Objectives

* [x] Create `AiPersona` data model with all persona fields (39a - completed 2026-01-19)
* [x] Build persona CRUD actions (create, read, update, delete, list, set default) (39b - completed 2026-01-19)
* [x] Implement persona manager UI in AI Personality settings tab (39c - completed 2026-01-19)
* [x] Add persona selector to campaign assignment panel (Booking tab) (39d - completed 2026-01-19)
* [x] Update AI draft generation to use campaign-assigned persona (with fallback to default) (39e - completed 2026-01-19)
* [x] Maintain backward compatibility with existing single-persona workspaces (via `resolvePersona` fallback chain)

## Constraints

- Must not break existing draft generation for workspaces without personas
- Persona assignment follows the same pattern as booking process assignment (`EmailCampaign.aiPersonaId`)
- `WorkspaceSettings` persona fields remain for backward compatibility and remain **in sync** with the default persona
- Persona CRUD should be workspace-admin gated (existing `requireClientAdminAccess` patterns)
- No changes to the two-step email pipeline architecture (Phase 30)
- Persona selection in campaign assignment UI should be optional (null = use workspace default)
- Auto-creating the default persona on first visit must be idempotent and admin-gated (avoid double-creates / multi-default states).
- ICP stays workspace-level; only the **UI placement** changes (AI Personality → General Settings).

## Success Criteria

- [x] User can create, edit, and delete multiple AI personas in the AI Personality settings tab
- [x] User can mark one persona as the workspace default
- [x] User can assign a specific persona to any synced campaign (in Booking tab)
- [x] AI drafts use the campaign-assigned persona when available, otherwise fall back to workspace default persona
- [x] Existing workspaces with single-persona settings continue to work without migration steps (auto-create default persona on first visit; drafts fallback to WorkspaceSettings)
- [x] A/B testing scenario works: same campaign copy with different personas for comparison (assignment mechanism complete; comparison reporting out-of-scope)

## Subphase Index

* a — Data Model & Schema (AiPersona model, campaign relation, indexes)
* b — Persona CRUD Actions (create, read, update, delete, list, setDefault)
* c — Persona Manager UI (settings page persona list, create/edit modal, delete confirmation)
* d — Campaign Persona Assignment (add persona selector to campaign assignment panel)
* e — AI Draft Integration (update draft generation to resolve persona from campaign)
* f — Hardening & Backward Compatibility (default sync rules, edge cases, rollouts)
* g — Locked Decisions Update (default sync + auto-create + ICP UI move)

## Repo Reality Check (RED TEAM)

- What exists today:
  - `WorkspaceSettings` model has: `aiPersonaName`, `aiTone`, `aiGreeting`, `aiSmsGreeting`, `aiSignature`, `aiGoals`, `serviceDescription`, `idealCustomerProfile`
  - `lib/ai-drafts.ts:generateResponseDraft` resolves persona using campaign persona → default persona → `WorkspaceSettings` fallback
  - `components/dashboard/settings-view.tsx` wires the AI Personality tab to the persona manager UI
  - `components/dashboard/settings/ai-campaign-assignment.tsx` has booking process dropdown (pattern to reuse for persona)
  - `actions/email-campaign-actions.ts` has `getEmailCampaigns(...)` (already joins booking process + lead counts) and `assignBookingProcessToCampaign` (pattern to reuse for persona assignment)
- What this plan assumes:
  - A persona is optional per campaign (null = default)
  - Default persona concept: one persona per workspace marked `isDefault: true`
  - Backward compatibility: workspaces without explicit personas use `WorkspaceSettings` values directly (lazy migration)
- Verified touch points:
  - `prisma/schema.prisma` (new `AiPersona` model, `EmailCampaign.aiPersonaId`)
  - `lib/ai-drafts.ts` (persona resolution logic)
  - `components/dashboard/settings-view.tsx` (replace AI Personality tab)
  - `components/dashboard/settings/ai-campaign-assignment.tsx` (add persona column)
  - `actions/email-campaign-actions.ts` (add `assignPersonaToCampaign`)
  - New: `actions/ai-persona-actions.ts`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Lazy migration confusion**: If a workspace has `WorkspaceSettings` values but no `AiPersona` rows, the UI must synthesize a "virtual" default from settings, or auto-create on first visit.
- **Orphaned persona assignments**: If a persona is deleted but campaigns reference it, drafts could fail or use wrong persona.
- **Performance**: Loading personas for every draft generation could add latency if not co-fetched with lead/settings.
- **Two defaults**: Without a DB constraint, concurrent “set default” operations can briefly create multiple defaults unless we enforce it in a transaction.
- **Settings drift**: If we keep `WorkspaceSettings.ai*` fields for backward compatibility but stop updating them, other flows that still read settings can diverge from the default persona.
- **Write-on-load side effects**: auto-creating the default persona on first visit introduces a write path during a UI read; this must be admin-gated and idempotent.

### Missing or ambiguous requirements
- Should deleting a persona reassign campaigns to the default, or leave them as null (manual)?
  - Assumption: Deleting a persona sets all `EmailCampaign.aiPersonaId` referencing it to null (cascade via Prisma `onDelete: SetNull`)
- Should the default persona be editable, or is it always auto-created from `WorkspaceSettings`?
  - Assumption: Default persona is a regular persona that can be edited; `isDefault` is just a flag
- Should `idealCustomerProfile` remain workspace-global for lead scoring, or be driven by the default persona?
  - Risk: Lead scoring uses `WorkspaceSettings.idealCustomerProfile` today; moving the UX to persona-only without syncing will confuse operators.

### Repo mismatches (fix the plan)
- `WorkspaceSettings.serviceDescription` is currently workspace-level; this phase makes it per-persona (default persona stays synced to legacy settings).
- `WorkspaceSettings.idealCustomerProfile` remains workspace-level and should be moved out of AI Personality UI into General Settings UI.
- `qualificationQuestions` remains on `WorkspaceSettings` (shared across personas) — personas don't override questions
- `lib/ai-drafts.ts:generateResponseDraft` uses a `select:` query; persona integration should follow the same pattern (select `emailCampaign.aiPersona` and `client.aiPersonas(where: { isDefault: true })`).

### Performance / timeouts
- Avoid extra DB roundtrips for persona. Options:
  - Expand the existing lead query in `generateResponseDraft` to also select `emailCampaign { aiPersona { ... } }` and `client { aiPersonas(where: { isDefault: true }) }`, **or**
  - Add a small follow-up query keyed by `lead.emailCampaignId` when channel is `email` (and keep SMS/LinkedIn untouched).
- Do not add persona-related writes (e.g., “auto-create default persona”) on webhook paths unless explicitly approved; default behavior should be read-only fallback to `WorkspaceSettings`.

### Security / permissions
- Persona CRUD requires workspace admin access
- Campaign persona assignment requires workspace admin access (same as booking process assignment)
- Read-only persona listing can be non-admin (optional), but any create/update/delete/default operations are admin-only.

### Testing / validation
- Manual test: create persona → assign to campaign → verify draft uses persona settings
- Edge case: delete persona → verify campaigns fall back to default
- Edge case: no personas exist → verify `WorkspaceSettings` fallback works
- Concurrency edge case: rapidly click “Set Default” on two personas → verify exactly one ends default (server-side transaction enforcement).
- Validation commands: `npm run lint`, `npm run build`, and if schema changes, `npm run db:push`.

## Open Questions (Need Human Input)

- None (locked decisions applied; see subphase g).

## Assumptions (Agent)

- Default persona is marked with `isDefault: true` (only one per workspace)
- When no persona is assigned to a campaign, fall back to workspace default persona
- If no default persona exists, fall back to `WorkspaceSettings` fields directly (backward compatibility)
- Persona deletion uses `onDelete: SetNull` to null out campaign references
- `qualificationQuestions` remain on `WorkspaceSettings`, not per-persona
- Persona support is scoped to `EmailCampaign` assignment (Email); SMS/LinkedIn persona assignment remains out-of-scope for Phase 39.
- Default persona changes are mirrored into `WorkspaceSettings` legacy persona fields to preserve existing behavior.

## Phase Summary

**Status: Ready to Ship (2026-01-19)**

- Shipped (working tree; uncommitted):
  - Schema: `AiPersona` + `EmailCampaign.aiPersonaId` relation (`prisma/schema.prisma`).
  - Actions: persona CRUD (`actions/ai-persona-actions.ts`) + campaign persona assignment (`actions/email-campaign-actions.ts`).
  - UI: persona manager (`components/dashboard/settings/ai-persona-manager.tsx`) + campaign selector (`components/dashboard/settings/ai-campaign-assignment.tsx`) + settings wiring (`components/dashboard/settings-view.tsx`).
  - Drafts: persona resolution chain in `lib/ai-drafts.ts`.
  - **Locked decisions implemented (Phase 39g)**:
    - Auto-create default persona on first visit (admin-gated, transactional)
    - Default persona syncs to WorkspaceSettings (backward compatibility)
    - ICP moved to General Settings (workspace-level, not per-persona)
- Verified:
  - `npm run lint`: pass (warnings only)
  - `npm run build`: pass
  - `npm run db:push`: pass (DB already in sync)
- All follow-ups complete. See `docs/planning/phase-39/review.md` for details.
