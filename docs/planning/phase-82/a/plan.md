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
### Column Inventory (CSV Header Scan)

Total columns detected: **62**

**Named headers:**
- DATE
- Campaign
- Company Name
- Website
- First Name
- Last Name
- Job Title
- Lead's Email
- Lead LinkedIn
- Phone Number
- Email/LinkedIn Step Responded
- Lead Category
- Lead Status
- Channel
- Lead Type
- Application Status
- Appointment Setter
- Setter Assignment
- Notes
- Initial response date
- Follow-up 1
- Follow-up 2
- Follow-up 3
- Follow-up 4
- Follow-up 5
- Response step complete
- Date of Booking
- Date of Meeting
- Qualfied
- Follow-up Date Requested
- Setters
- Rolling Meeting Request Rate
- Rolling Booking Rate

**Unnamed/empty headers:** `Unnamed: 31` through `Unnamed: 61`  
These appear unused/empty in the export and are safe to drop in mapping.

### Unknowns / Decisions Needed
- Confirm whether `Lead Category` maps directly to `Lead.sentimentTag` or is a separate CRM-specific taxonomy.
- Confirm if `Lead Status` should map to `Lead.status` or to a pipeline-specific field (separate from sentiment).

## Handoff
Proceed to Phase 82b to materialize the mapping into an `.xlsx` artifact (no PII).
