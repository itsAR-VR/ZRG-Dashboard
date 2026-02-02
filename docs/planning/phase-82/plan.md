# Phase 82 — Founders Club CRM Spreadsheet Mapping (XLSX)

## Purpose
Turn the pasted spreadsheet requirements into a concrete, spreadsheet-backed column mapping and an import/cleanup plan for the Founders Club CRM data.

## Context
- Repo root currently contains untracked CRM exports: `Founders Club CRM.xlsx` and `Founders Club CRM - Founders Club CRM.csv`.
- These files include PII (names/emails/phones) and must **not** be committed; this phase includes guardrails and artifacts that avoid copying PII into git-tracked files.
- The ZRG Dashboard canonical model lives in `prisma/schema.prisma` (notably `Lead` + message/follow-up tables). This phase focuses on mapping CRM spreadsheet columns → existing schema fields and defining transformation rules.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 79 | Uncommitted | `lib/ai-drafts.ts`, booking prompt strategy | Independent; avoid rebasing/merging while Phase 79 is mid-change |
| Phase 80 | Uncommitted | `prisma/schema.prisma`, auto-send schedule + booking pause | Treat schema as unstable until Phase 80 is merged; don’t build hard dependencies on in-flight fields |
| Phase 81 | Uncommitted | `prisma/schema.prisma`, Slack settings + orchestrator | Same as Phase 80; keep this phase scoped to planning + artifacts |

## Objectives
* [x] Identify which spreadsheet columns are source-of-truth vs derived/empty (e.g., "Unnamed" columns)
* [x] Produce an `.xlsx` mapping artifact listing columns, target model/field, and transforms
* [x] Define an import/cleanup strategy (idempotency, dedupe rules, and required lookups)
* [x] Ensure PII exports stay untracked (gitignore)

## Constraints
- Do not add CRM PII to git-tracked files.
- Prefer mapping into existing Prisma fields (e.g., `Lead.firstName`, `Lead.email`, `Lead.companyName`) before proposing schema changes.
- Any proposed importer must be **idempotent** (safe to re-run) and dedupe primarily by normalized email and/or phone.

## Success Criteria
- [x] A mapping spreadsheet exists on disk (not committed) with formulas summarizing mapping coverage.
- [x] `docs/planning/phase-82/a/plan.md`, `docs/planning/phase-82/b/plan.md`, and `docs/planning/phase-82/c/plan.md` exist and clearly describe next actions.
- [x] `.gitignore` prevents accidental commit of CRM export files.

## Subphase Index
* a — Inspect source workbook/CSV and extract column inventory
* b — Generate column-mapping `.xlsx` artifact (with formulas + validations)
* c — Draft importer/cleanup approach (dry-run, dedupe, and field transforms)

## Phase Summary

### Status: Complete

**What shipped:**
- Column inventory (Phase 82a) covering 62 headers and unused `Unnamed:*` columns
- Mapping artifact: `docs/planning/phase-82/artifacts/founders-club-crm-column-mapping.xlsx` (headers-only, formulas + validations)
- Importer checklist: `docs/planning/phase-82/artifacts/importer-checklist.md`
- `.gitignore` protections for CRM files (`Founders Club CRM*.csv`, `Founders Club CRM*.xlsx`, `docs/planning/**/artifacts/*.xlsx`)

### Key Decisions
- Keep mapping focused on existing `Lead` fields; avoid schema changes in this phase.
- Idempotent import keyed by normalized email (primary) and phone (secondary).
- No CRM row data or PII is committed to git.

### Artifacts
- `docs/planning/phase-82/artifacts/founders-club-crm-column-mapping.xlsx`
- `docs/planning/phase-82/artifacts/importer-checklist.md`
- `docs/planning/phase-82/review.md`

### Follow-ups
- If manual import is needed later, implement against the checklist artifact in a follow-on phase.
