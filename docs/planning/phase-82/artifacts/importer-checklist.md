# Founders Club CRM Importer Checklist (Phase 82c)

## Scope
- Import the Founders Club CRM CSV into existing ZRG Dashboard models without committing any PII.
- Use the mapping artifact to drive which columns are kept vs ignored.
- Keep all pipeline/sales call fields optional (skeleton-only).

## Inputs
- Local, untracked export: `Founders Club CRM - Founders Club CRM.csv`
- Mapping artifact: `docs/planning/phase-82/artifacts/founders-club-crm-column-mapping.xlsx`

## Idempotency & Dedupe
- **Primary key:** normalized email (lowercase, trimmed).
- **Secondary key:** normalized phone (digits only, E.164 best-effort).
- **Optional fallback:** LinkedIn URL if email/phone missing.
- Upsert leads by email/phone; do not create duplicates if a lead already exists.

## Field Mapping Notes (MVP)
- `First Name` → `Lead.firstName`
- `Last Name` → `Lead.lastName`
- `Lead's Email` → `Lead.email`
- `Phone Number` → `Lead.phone`
- `Company Name` → `Lead.companyName`
- `Website` → `Lead.companyWebsite`
- `Lead LinkedIn` → `Lead.linkedinUrl`
- `Lead Status` → `Lead.status` (confirm mapping table)
- `Lead Category` → `Lead.sentimentTag` (confirm taxonomy)
- `Campaign` → `Lead.campaignId` (if matching) else store as note/tag
- `Notes` → optional `Message` row (direction = inbound, channel = "crm_import")

## Transform Rules
- Dates: parse with `Date.parse` fallback; store ISO (UTC).
- Status/category: map to known enums; unknowns → `null` + note for manual review.
- Phone: strip non-digits; preserve `+` when present; store as E.164 when possible.

## Execution Flow (Suggested)
1. **Load CSV** (headers only first pass) and validate expected columns.
2. **Dry-run**: count rows, mapped fields, and missing identifiers.
3. **Normalize**: email/phone/linkedin, trim strings, parse dates.
4. **Upsert Lead**: use email/phone; update only empty fields by default.
5. **Optional notes**: create `Message` rows for `Notes` if enabled.
6. **Report**: output counts (created, updated, skipped, missing identifiers).

## Safety
- Default to `--dry-run`; require `--apply` to write.
- Log only row counts and lead IDs (no PII).
- Run against a non-production database first.

## Output
- Summary report with counts and any unmapped/unknown values.
