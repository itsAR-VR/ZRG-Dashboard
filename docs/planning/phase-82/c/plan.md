# Phase 82c — Import/Cleanup Strategy (Design)

## Focus
Define how the mapped spreadsheet fields should be imported into the existing ZRG Dashboard schema, safely and repeatably.

## Inputs
- Phase 82b mapping decisions
- Existing models and constraints in `prisma/schema.prisma`
- Existing scripts patterns in `scripts/` (dotenv loading, Prisma adapter usage, dry-run flags)

## Work
- Decide canonical identifiers for idempotency:
  - Primary: normalized email
  - Secondary: normalized phone
  - Optional: LinkedIn URL (if present)
- Define normalization/transforms per mapped field (date parsing, trimming, status mapping).
- Choose import shape:
  - Leads only (minimum viable)
  - Leads + notes/messages (if “Notes” should become Message rows)
  - Campaign mapping rules (if spreadsheet campaign names should map to `EmailCampaign` or remain as tags/notes)
- Define safe execution:
  - `--dry-run` default
  - `--apply` writes
  - logs output IDs only (no PII)

## Output
- A concrete importer checklist (and optionally a script stub) ready for implementation in a follow-on phase.

## Handoff
If implementation is desired, create a follow-on phase to build and validate the importer against a non-production database.

