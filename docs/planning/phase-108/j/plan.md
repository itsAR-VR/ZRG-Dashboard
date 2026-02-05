# Phase 108j — Proposal Workflow + History/Rollback + True Super Admins

## Focus
Deliver the full proposal workflow for prompt overrides + knowledge assets, including version history, multi-step rollback, and true super-admin allowlist enforcement.

## Inputs
- Prompt overrides:
  - `prisma/schema.prisma` (`PromptOverride`, `PromptSnippetOverride`)
  - `actions/ai-observability-actions.ts`
- Knowledge assets:
  - `prisma/schema.prisma` (`KnowledgeAsset`)
  - `actions/settings-actions.ts`
- Workspace admin gating:
  - `lib/workspace-access.ts`
  - `actions/*` admin checks

## Work
1. **Schema: history + proposals**
   - Add revision tables for prompt overrides and knowledge asset text.
   - Add proposal table to track suggestion → approval → applied.
2. **Approval flow:**
   - Workspace admins approve; true super-admins apply globally.
   - Super-admin allowlist via env (case-insensitive emails).
3. **Rollback:**
   - UI + action to browse history and rollback to any prior revision.
4. **UI/UX:**
   - Aggregate-only view for non-admins.
   - Evidence/proposals admin-only.

## Validation (RED TEAM)
- Ensure admin-only access for proposal details.
- Verify history allows rollback to earliest version.

## Output
- Proposal workflow + apply gating (true super admins) with per-proposal audit trails.
- Prompt/snippet/knowledge asset revision tables with rollback actions.
- UI history dialogs for prompt overrides + knowledge assets.

## Handoff
Phase 108i validates proposal approval/apply + rollback in QA.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added revision tables for prompt overrides/snippets and knowledge assets (`prisma/schema.prisma`).
  - Added proposal model + actions + UI wiring for approval/apply/rollback.
  - Enforced true super-admin allowlist for proposal apply.
- Commands run:
  - `rg -n "PromptOverrideRevision|KnowledgeAssetRevision" prisma/schema.prisma` — verified schema additions.
- Blockers:
  - None.
- Next concrete steps:
  - Validate rollback flow end-to-end after db:push (Phase 108i).
