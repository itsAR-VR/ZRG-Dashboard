# Phase 83a — Sheet Replica Spec (Playwright + Workbook)

## Focus
Extract the layout and intent of the Google Sheet (and cross-check against `Founders Club CRM.xlsx`) so we can recreate the same “view” inside the Analytics tab.

## Inputs
- Google Sheet link (provided by user)
- Local workbook: `Founders Club CRM.xlsx` (sheet names + formatting conventions)
- Local CSV headers (from exports) for column inventory (Phase 82 artifact can be reused as the starting column list)

## Work
- Use Playwright MCP to open the Google Sheet and capture:
  - Which tab is the “CRM table” view (gid provided by user)
  - Column ordering + header names
  - Frozen rows/columns, grouping, filters, and any conditional formatting rules
  - Any computed columns (rolling rates, booking rate, etc.) and how they’re calculated
- Use the exported headers as an initial baseline (safe: headers only, no PII) to speed up the capture:
  - Confirm which headers are actually displayed in the Google Sheet view
  - Identify columns that are computed-only in Sheets (vs stored fields)
- Decide MVP scope:
  - **Required columns for MVP** (interest date/type, lead status, campaign, response mode, lead score)
  - **Display-only placeholders** (sales call, pipeline) until functionality exists
  - **Exclude/derive later** (rolling rates, historical follow-up columns) if not feasible immediately
- Produce a written “Replica Spec”:
  - Table columns (name, source, type, editable vs computed)
  - Default sort
  - Filter controls
  - Column-to-model mapping references (Phase 83b)

## Output

### Replica Spec (Initial, Workbook-Driven)

**Primary sheet observed:** `Founders Club CRM` (from local `Founders Club CRM.xlsx`)

**Header row (row 1) columns:**
1. DATE
2. Campaign
3. Company Name
4. Website
5. First Name
6. Last Name
7. Job Title
8. Lead's Email
9. Lead LinkedIn
10. Phone Number
11. Email/LinkedIn Step Responded
12. Lead Category
13. Lead Status
14. Channel
15. Lead Type
16. Application Status
17. Appointment Setter
18. Setter Assignment
19. Notes
20. Initial response date
21. Follow-up 1
22. Follow-up 2
23. Follow-up 3
24. Follow-up 4
25. Follow-up 5
26. Response step complete
27. Date of Booking
28. Date of Meeting
29. Qualfied (typo in sheet)
30. Follow-up Date Requested
31. Setters
34. Rolling Meeting Request Rate
35. Rolling Booking Rate

> Note: the CSV export includes many `Unnamed:*` columns after the above headers. They appear empty/unused in the workbook view and can be ignored in the replica.

**MVP Column Plan (in-app CRM table):**
- **Required (live, auto-populated):**
  - `Initial response date` (interest date)
  - `Lead Category` (interest type / sentiment)
  - `Lead Status`
  - `Campaign`
  - `AI vs Human Response` (derived; new column not in sheet but requested)
  - `Lead Score` (derived; new column not in sheet but requested)
- **Core identity (display-only, from Lead):**
  - `First Name`, `Last Name`, `Lead's Email`, `Phone Number`, `Company Name`, `Website`, `Lead LinkedIn`
- **Channel / routing:**
  - `Channel`, `Appointment Setter`, `Setter Assignment`
- **Placeholder / skeleton (editable later):**
  - `Notes`, `Lead Type`, `Application Status`, `Setters`, `Follow-up Date Requested`
  - Pipeline/Sales call fields (not in sheet; will add as new columns in the replica view)
- **Computed / later:**
  - `Follow-up 1..5`, `Response step complete`, `Date of Booking`, `Date of Meeting`
  - `Rolling Meeting Request Rate`, `Rolling Booking Rate`

**Default sort (proposal):** `Initial response date` DESC (fallback to `DATE`/`createdAt`)

**Filters (proposal):** Campaign, Lead Status, Lead Category, Channel, Appointment Setter, Response Mode (AI vs Human), Date range

### Playwright MCP Note
Playwright MCP access to the Google Sheet could not be executed in this environment (no MCP tool available). The replica spec above is based on the local workbook and CSV headers. A follow-up pass is required to confirm any Google Sheets-only formatting (frozen columns, filters, conditional formatting).

## Handoff
Proceed to Phase 83b with the column list above. Use it to define schema skeleton fields and determine which columns are stored vs computed vs placeholders.
