# Phase 82a — Inspect Source Workbook/CSV

## Focus
Inventory the Founders Club CRM spreadsheet structure (sheets + columns) and identify which columns should be mapped into ZRG Dashboard vs ignored as derived/empty.

## Inputs
- `Founders Club CRM.xlsx` (local, untracked)
- `Founders Club CRM - Founders Club CRM.csv` (local, untracked)
- `prisma/schema.prisma` (`Lead`, `Message`, follow-up models)

## Work
- Confirm sheet names and identify the primary data sheet (likely “Founders Club CRM”).
- Extract column headers from the CSV and classify:
  - **Mapped** (candidate to import)
  - **Derived** (rates/rollups)
  - **Empty/Unnamed** (drop)
- Define preliminary normalization rules:
  - dates (DATE / booking / meeting)
  - phone normalization (digits-only)
  - status/category normalization (map to `Lead.status` and/or `Lead.sentimentTag`)

## Output
- A column inventory (source headers) used as the backbone for the mapping artifact in Phase 82b.
- A short list of “unknowns” that need user clarification (e.g., which statuses should map to `Lead.status` vs sentiment tags).

## Handoff
Proceed to Phase 82b to materialize the mapping into an `.xlsx` artifact (no PII).

