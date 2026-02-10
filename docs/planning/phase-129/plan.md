# Phase 129 — System Default Prompts + Workspace-Specific Overrides

## Purpose
Add a workspace-specific prompt editing system with a super-admin editable **system default** layer, so prompt edits never leak across clients and defaults can be updated globally without code changes.

## Context
- Today, core AI prompt templates live in code (`lib/ai/prompt-registry.ts`) and affect all workspaces unless a workspace-specific override exists.
- The repo already supports per-workspace prompt customization via:
  - `PromptOverride` (per-client prompt message overrides)
  - `PromptSnippetOverride` (per-client reusable snippet overrides)
  - Settings UI for editing these (`components/dashboard/settings-view.tsx`)
- The missing capability: a **system-level default prompt editor** that:
  - is editable in-app by super admins,
  - applies to all workspaces by default,
  - is automatically superseded by workspace overrides when present,
  - allows one-click reset at workspace level (back to system defaults).

We will implement a 3-tier resolution order:
`workspace override` > `system default override` > `code default`.

## Decisions (Locked)

1. **Drift model: FLAT**
   - Both system and workspace overrides anchor `baseContentHash` to code default hash.
   - Resolution picks the highest-priority matching override per message slot.
   - No cascade-invalidation complexity.

2. **Stale warning badges: YES**
   - When a super admin changes a system default, workspace overrides get a "potentially stale" warning badge in the UI.
   - Track `systemDefaultUpdatedAt` timestamp. If a workspace override's `updatedAt` < the system default's `updatedAt` for the same `promptKey/role/index`, show an amber "System default changed" badge.
   - UI-only indicator — stale workspace overrides still apply at runtime (flat model).
   - Workspace admins can review and re-save or reset.

## Concurrent Phases
Overlap scan performed against the last 10 planning phases and current repo state (RED TEAM verified).

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 119 | **Complete** (committed `71f4bf1`) | `lib/ai/prompt-runner/runner.ts` retry expansion | Re-read `prompt-runner/runner.ts` before adding telemetry suffixes; preserve retry expansion semantics. |
| Phase 122 | **Complete** (committed `3cdb243`) | `lib/ai/prompt-registry.ts` Meeting Overseer prompt tightening | Re-read `prompt-registry.ts` from HEAD; do not revert template content changes. |
| Phase 123 | **Complete** (committed `3cdb243`) | `prisma/schema.prisma` — added `DraftPipelineRun`, `DraftPipelineArtifact` | Schema merge coordination: re-read schema before adding system override models. Single `db:push` after all edits. |
| Phase 126 | **Complete** (committed `3cdb243`) | `prisma/schema.prisma` — added `Appointment` fields | Same as 123 — schema coordination. |
| Phase 127 | **Complete** (committed `3cdb243`) | `prisma/schema.prisma` — added `WorkspaceMemoryEntry`; super-admin UI patterns | Reuse `isTrueSuperAdminUser` gating pattern. |
| Phase 128 | **Complete** (committed `3cdb243`) | `lib/ai-drafts.ts` escalation/pricing | No overlap — Phase 129 does not touch draft generation. |
| Working tree | **Dirty (Phase 129 WIP)** | Modified: `actions/ai-observability-actions.ts`, `components/dashboard/settings-view.tsx`, `lib/ai/prompt-registry.ts`, `lib/ai/prompt-snippets.ts`, `lib/workspace-access.ts`, `prisma/schema.prisma`, `scripts/test-orchestrator.ts` · Untracked: `actions/system-prompt-actions.ts`, `lib/__tests__/prompt-system-defaults.test.ts`, `docs/planning/phase-129/` | This phase owns these changes; ensure quality gates pass on the combined state. |

## Repo Reality Check (RED TEAM)

- What exists today (verified at commit `3cdb243`):
  - `prisma/schema.prisma` — `PromptOverride` (L1922), `PromptSnippetOverride` (L1942), both revision models present
  - `actions/ai-observability-actions.ts` — `getSnippetRegistry()` (L1018), `savePromptOverride()` (L480), `resetPromptOverride()` (L553)
  - `lib/workspace-access.ts` — `requireAuthUser` (L41), `isTrueSuperAdminUser` (L29); no `requireSuperAdminUser()` helper yet
  - `lib/ai/prompt-registry.ts` — `getAIPromptTemplate` (L1508), `getPromptWithOverrides` (L1600), `computePromptMessageBaseHash` (L1529)
  - `lib/ai/prompt-runner/resolve.ts` — `resolvePromptTemplate` (L11), delegates to `getPromptWithOverrides`
  - `lib/ai/prompt-snippets.ts` — `getEffectiveSnippet` (L219), `SNIPPET_DEFAULTS` (L156)
  - `components/dashboard/settings-view.tsx` — AI Prompts dialog (L5912+), tabs: "prompts" + "variables"
  - `scripts/test-orchestrator.ts` — node:test + tsx runner
  - `actions/access-actions.ts` — `getGlobalAdminStatus()` (L6)
- Verified touch points:
  - `computePromptMessageBaseHash` — `lib/ai/prompt-registry.ts:1529` (SHA-256)
  - `baseContentHash` field — on `PromptOverride` (L1929) and `PromptOverrideRevision` (L1968)
  - `isTrueSuperAdminUser` — used in 7+ action files with consistent pattern
  - `PromptSnippetOverride` does NOT have `baseContentHash` (only prompts do)
  - Workspace override unique constraint: `@@unique([clientId, promptKey, role, index])`
  - Snippet override unique constraint: `@@unique([clientId, snippetKey])`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **G1 (HIGH): Drift protection under 3-tier resolution** — `baseContentHash` anchoring semantics must be explicitly defined. **Resolution:** Use flat model — both system and workspace overrides anchor to code default hash. At resolution time: workspace override (hash match) > system override (hash match) > code default. Documented in 129b.
- **G6 (MEDIUM): "Reset to default" has 4 distinct scenarios** — reset target depends on which layers exist. **Resolution:** UI shows dynamic copy: "Reset to System Default" vs "Reset to Code Default". Documented in 129c.

### Missing or ambiguous requirements
- **G2 (MEDIUM):** `PromptSnippetOverride` has no `baseContentHash` — plan confirms: keep snippet overrides without drift protection (matching current behavior). Add optional `codeDefaultSnapshot` on system snippet overrides for UI warning only.
- **G4 (MEDIUM):** Super-admin gating pattern not specified → Extract `requireSuperAdminUser()` helper in `lib/workspace-access.ts`. Documented in 129a.
- **G8 (MEDIUM):** `getSnippetRegistry()` return shape expansion not specified → Exact shape documented in 129a.

### Repo mismatches (fixed)
- **G3 (LOW):** Phase 119 status was "Planned/Unknown" → corrected to "Complete". Added missing phases 122, 123, 126 to table.

### Performance / timeouts
- No concerns — system override queries are simple indexed lookups alongside existing workspace queries. One additional DB query per prompt resolution.

### Security / permissions
- **G4:** All system prompt mutations must use `requireSuperAdminUser()` gating (new helper). Read-only system data can be fetched by workspace admins for display purposes.

### Testing / validation
- **G5 (LOW):** Telemetry key formats locked: `sys_<timestamp>` for system, `ws_<timestamp>` for workspace. Documented in 129b.
- **G7 (LOW):** Schema migration is additive-only (new tables, no drops). Safe rollback: unused tables left in place.

### Post-implementation notes (RED TEAM)
- **UI drift visibility:** Implemented a "Code changed" badge for prompt messages when an override exists but is not applied due to `baseContentHash` mismatch. Workspace Prompts tab also renders the **effective** content (matching runtime precedence) and seeds the editor with the saved override content when drifted so admins can re-save (rebase) safely.
- **Telemetry suffix change:** Prompt telemetry now uses `ws_<timestamp>` / `sys_<timestamp>` suffixes (instead of older `ovr_...` conventions referenced in older docs). If any dashboards/log filters exist for prompt keys, update them accordingly.

## Objectives
* [x] Add system-default override storage (Prisma models + revisions) for prompt templates and snippet variables.
* [x] Extract `requireSuperAdminUser()` helper in `lib/workspace-access.ts`.
* [x] Implement layered prompt/snippet resolution at runtime:
  - `workspace` > `system` > `code` (flat drift model — both anchor to code default hash)
  - preserve existing workspace override drift protection (`baseContentHash`)
* [x] Add super-admin-only UI surfaces for editing system defaults.
* [x] Add clear indicators in the workspace prompt editor for whether content is coming from workspace/system/code.
* [x] Add stale warning badges when system defaults change after workspace overrides were saved.
* [x] Add tests for precedence, drift, staleness, and gating; pass quality gates (`npm test`, `npm run lint`, `npm run build`).

## Constraints
- Never commit secrets/tokens/PII.
- System defaults are editable by **true super admins only** (SUPER_ADMIN allowlist via `requireSuperAdminUser()`).
- Keep existing Server Action shapes consistent (`{ success, data?, error? }`).
- Prisma schema changes require `npm run db:push` against the correct DB before completing.
- Preserve existing drift protection semantics for workspace overrides (do not silently apply stale overrides).
- Schema migration is additive-only (new tables, no column drops) — rollback-safe.
- Flat drift model: both system and workspace `baseContentHash` anchor to code default content hash.

## Success Criteria
- [x] Any workspace can customize prompts/snippets without affecting other workspaces.
- [x] Workspace "Reset to default" restores to **system defaults** (or code defaults if no system override exists). UI copy reflects which target.
- [x] Editing a system default updates all workspaces that have not customized that prompt/snippet.
- [x] Workspace overrides with `updatedAt` older than the corresponding system default show an amber "System default changed" badge.
- [x] UI clearly distinguishes:
  - Workspace Customized (blue badge)
  - Using System Default (amber badge)
  - Using Code Default (gray/no badge)
- [x] All tests and build checks pass.

## Assumptions (Agent)

- Separate tables for system overrides (not nullable `clientId`). Confidence ~95%.
  - Mitigation: If unified table preferred, add `isSystemDefault Boolean @default(false)` and adjust constraints.
- No new env vars needed. Confidence ~95%.
  - Mitigation: If feature-flagging desired, add `SYSTEM_PROMPT_DEFAULTS_ENABLED=true`. Feature is RBAC-gated, so likely redundant.
- Existing `resolvePromptTemplate()` needs no direct changes — delegates to `getPromptWithOverrides()`. Confidence ~98%.

## Subphase Index
* a — Data model + super-admin server actions (system prompt/snippet overrides + revisions + `requireSuperAdminUser` helper)
* b — Runtime resolution (flat-model layered prompt/snippet resolution + telemetry key suffixes)
* c — UI surfaces (System Defaults tab + 3-state indicators + reset semantics + stale warning badges)
* d — Tests + rollout checklist (unit tests for precedence/drift/staleness/gating + quality gates)

## Phase Summary (running)
- 2026-02-10 — Implemented system-default prompts + workspace overrides end-to-end (Prisma models, super-admin actions, runtime precedence, Settings UI, tests); verified via local quality gates. (files: `prisma/schema.prisma`, `lib/workspace-access.ts`, `actions/system-prompt-actions.ts`, `actions/ai-observability-actions.ts`, `lib/ai/prompt-registry.ts`, `lib/ai/prompt-snippets.ts`, `components/dashboard/settings-view.tsx`, `lib/__tests__/prompt-system-defaults.test.ts`, `scripts/test-orchestrator.ts`)

## Phase Summary
- Shipped:
  - System-default prompt + snippet overrides stored in DB (with revision history + rollback) and applied at runtime with precedence `workspace > system > code`.
  - Super-admin Settings UI tabs for editing system prompts/variables; workspace UI badges + reset + stale-warning indicator.
- Verified:
  - `npm test`: pass
  - `npm run lint`: pass (warnings only)
  - `npm run build`: pass
  - `npm run db:push`: pass (database in sync)
