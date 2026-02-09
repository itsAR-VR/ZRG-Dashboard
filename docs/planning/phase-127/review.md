# Phase 127 Review

## Scope Recap
Phase 127 adds:
- Governed long-term memory (lead + workspace) with explicit approval gating and TTL caps
- Auto-send evaluator↔revision loop observability (stop reasons, iterations, deltas)
- Retention/pruning for draft pipeline runs/artifacts and expired inferred memory
- Super Admin control plane UI (Settings → Admin)

## Evidence

### Data Model
- Schema changes: `prisma/schema.prisma`
  - `MemoryEntryStatus` enum
  - `LeadMemoryEntry.status` + provenance fields/indexes
  - `WorkspaceMemoryEntry` model + indexes + Client relation
  - Workspace policy fields (`memoryAllowlistCategories`, thresholds, evaluator model/effort)
- Command:
  - `npm run db:push` — pass (database in sync) (recorded during Phase 127a)

### Quality Gates
- `npm test` — pass
- `npm run lint` — pass (warnings only)
- `npm run build` — pass

## Notes / Known Warnings
- ESLint warnings exist in unrelated UI files (missing hook deps, `<img>` usage); lint still passes.
- Next build emits CSS optimizer warnings for `var(--...)/var(--*-*)` patterns; build still succeeds.

## Rollout / Ops Checklist
- Optional env vars (see `README.md`):
  - `AUTO_SEND_EVALUATOR_MODEL`, `AUTO_SEND_EVALUATOR_REASONING_EFFORT`
  - `AUTO_SEND_REVISION_MODEL`, `AUTO_SEND_REVISION_REASONING_EFFORT`
  - `AUTO_SEND_REVISION_LOOP_TIMEOUT_MS`
  - `DRAFT_PIPELINE_RUN_RETENTION_DAYS`
- Configure memory governance policy in Settings → Admin (Super Admin only):
  - Allowlist categories
  - Min confidence / TTL thresholds (TTL cap enforced)
  - Review + approve/reject PENDING memory entries

