# Phase 82b — Generate Column-Mapping XLSX Artifact

## Focus
Create an `.xlsx` artifact that lists each source column and provides editable fields for target model/field and transform notes, including formulas to track mapping coverage.

## Inputs
- Phase 82a column inventory (CSV headers)
- Mapping targets from `prisma/schema.prisma`

## Work
- Create `docs/planning/phase-82/artifacts/` locally (keep artifact untracked).
- Generate `founders-club-crm-column-mapping.xlsx` with:
  - Table: Source Column, Keep?, Target Model, Target Field, Transform, Notes
  - Data validations (Keep? = Yes/No; Target Model list)
  - Summary formulas: total columns, kept columns, coverage %
- Keep the file free of PII (headers only; no row data).

## Output
- `docs/planning/phase-82/artifacts/founders-club-crm-column-mapping.xlsx` (local artifact)

## Handoff
Proceed to Phase 82c to draft the importer/cleanup strategy based on the mapping decisions.

