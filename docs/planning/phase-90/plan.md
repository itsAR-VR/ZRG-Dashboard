# Phase 90 — CRM Sheet: Backfill + Full Columns + Inline Editing

## Purpose
Make the Analytics → CRM "Google Sheet replica" **fully populated and editable**, eliminating placeholder columns by combining:
- **Live system data** (Leads, Messages, FollowUpTasks, Appointments)
- **Idempotent CSV backfill** from the Founders Club export (no PII committed)
- **Spreadsheet-like inline editing** with a per-edit decision to update CRM-only fields vs automation-driving fields.

## Context
- Phase 83 introduced:
  - `LeadCrmRow` (1:1) to store "interest registered" snapshot + pipeline/sales skeleton
  - Analytics tab CRM table (`components/dashboard/analytics-crm-table.tsx`) and `getCrmSheetRows`
  - Live upserts on positive inbound sentiment via inbound post-process
- Current gaps:
  - Many sheet columns are returned as `null` placeholders in `getCrmSheetRows` (follow-ups, step responded, response completion, etc.)
  - "AI vs Human Response" attribution is currently derived from outbound **before** interest; desired behavior is based on the outbound response **after** interest, and "AI vs Human" should mean "AI auto-send vs human setter".
  - Historic sheet status/category/pipeline values exist in the local export and should be backfilled into the DB safely and idempotently.
  - The CRM table should support full spreadsheet-style editing for relevant columns, with a per-edit prompt when changing fields that could affect follow-up automation (`Lead.status` / `Lead.sentimentTag`).

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 83 | Uncommitted (working tree) | `prisma/schema.prisma`, `actions/analytics-actions.ts`, `components/dashboard/analytics-view.tsx` | Treat CRM/Analytics files as unstable; merge semantically and avoid overwriting Phase 83 work. |
| Phase 88 | Untracked (working tree) | Analytics UI/actions (tabs, date window) | Coordinate changes in `analytics-view.tsx` and `analytics-actions.ts` so CRM tab survives analytics consolidation. |
| Phase 89 | Untracked (working tree) | Setter membership/assignment patterns | Ensure assignee dropdown reflects the current roster (Vee/David/Emar shift); avoid importing legacy setter names from CSV. |
| Phase 85 | Untracked (working tree) | Client portal RBAC affecting mutation | Ensure edit actions respect role/capabilities (client portal users may be read-only). |

## Objectives
* [x] Add schema fields needed to persist editable CRM columns (job title, lead type, application status, category override).
* [x] Implement an idempotent CSV backfill importer (dry-run default) to populate Lead + LeadCrmRow for "interested" rows.
* [x] Update `getCrmSheetRows` so CRM rows have no placeholders: compute follow-ups, step-responded, response completion, and AI/Human response.
* [x] Add server actions to support inline cell editing + per-edit "update automation?" prompt + assignment dropdown.
* [x] Update CRM table UI to support spreadsheet-like inline editing and remove unused rolling-rate columns.
* [x] Add tests + a verification runbook; run `npm run lint`, `npm run build`, and `npm run db:push` (if schema changes).

## Constraints
- **PII:** Do not commit any CRM exports or row data. Local exports remain ignored via `.gitignore`.
- **Row scope:** CRM table shows **interested-only** rows (positive interest).
- **Backfill:** Default **fill blanks only**; must be idempotent and safe to re-run.
- **Automation coupling:** Editing Lead Status / Lead Category requires a per-edit prompt:
  - CRM-only (updates `LeadCrmRow` display fields)
  - Update both (also updates `Lead.status` and/or `Lead.sentimentTag` via heuristic mapping)
- **Follow-ups columns:** `Follow-up 1..5` come from the follow-up engine (`FollowUpTask`), not from the spreadsheet export.
- **Step responded:** Compute "touch #" (count of outbound touches before the interest inbound, same channel).
- **Rolling rates:** `Rolling Meeting Request Rate` and `Rolling Booking Rate` are not needed in the CRM table UI; keep these insights in Analytics elsewhere.

## Success Criteria
- Analytics → CRM table:
  - Has no placeholder-only columns (values are computed/imported/editable).
  - Uses `DATE = interest date` (first positive inbound / imported interest date).
  - Shows Lead Category and Lead Status using the **hybrid** rule:
    - Category: `leadCategoryOverride ?? interestType ?? Lead.sentimentTag`
    - Status: `LeadCrmRow.pipelineStatus ?? Lead.status`
  - Shows `AI vs Human Response` and `Response step complete` based on the outbound response **after** interest.
  - Shows `Follow-up 1..5` as the next five pending follow-up due dates.
- CSV importer exists with `--dry-run` default and `--apply` mode; idempotent; fill blanks only; skips assignment import by default.
- Inline editing works for all intended columns; assignment uses a workspace member dropdown.
- Validation passes: `npm run lint`, `npm run build`, and `npm run db:push` (if schema changed).

## Repo Reality Check (RED TEAM)

### What exists today
- **LeadCrmRow model:** `prisma/schema.prisma:522-575` — has interest snapshot, response attribution, pipeline skeleton, sales call skeleton
- **Lead model:** `prisma/schema.prisma:368-516` — NO `jobTitle` field (Phase 90a must add it)
- **FollowUpTask model:** `prisma/schema.prisma:830-853` — has `leadId`, `dueDate`, `status`, `instanceId`
- **getCrmSheetRows:** `actions/analytics-actions.ts:1288-1461` — returns CrmSheetRow with many null placeholders
- **CrmSheetRow interface:** `actions/analytics-actions.ts:111-149` — includes rolling rate fields (to be removed)
- **upsertLeadCrmRowOnInterest:** `lib/lead-crm-row.ts:14-93` — sets responseMode from outbound BEFORE interest (bug per plan)
- **analytics-crm-table.tsx:** `components/dashboard/analytics-crm-table.tsx:1-339` — read-only table, no inline editing
- **Importer mapping:** `docs/planning/phase-82/artifacts/importer-checklist.md` — exists and can be referenced

### Plan assumptions vs reality
| Assumption | Reality | Status |
|------------|---------|--------|
| `Lead.jobTitle` exists | Does NOT exist in schema | ❌ 90a must add |
| `LeadCrmRow.leadType` exists | Does NOT exist | ❌ 90a must add |
| `LeadCrmRow.applicationStatus` exists | Does NOT exist | ❌ 90a must add |
| `LeadCrmRow.leadCategoryOverride` exists | Does NOT exist | ❌ 90a must add |
| `getCrmSheetRows` returns computed follow-ups | Returns `null` for followUp1-5 | ❌ 90c must fix |
| `getCrmSheetRows` returns stepResponded | Returns `null` | ❌ 90c must fix |
| Response attribution is post-interest | Currently pre-interest in `upsertLeadCrmRowOnInterest` | ❌ 90e must fix |
| Inline editing exists | No inline editing in CRM table | ❌ 90d must add |
| Rolling rate columns exist in UI | Yes, at lines 264-265 in table header | ✅ Remove in 90d |

### Verified touch points
- `prisma/schema.prisma:368` — Lead model start
- `prisma/schema.prisma:522` — LeadCrmRow model start
- `prisma/schema.prisma:830` — FollowUpTask model start
- `lib/lead-crm-row.ts:31-39` — lastOutbound query uses `sentAt: { lte: params.messageSentAt }` (pre-interest)
- `lib/lead-crm-row.ts:51-56` — responseMode derivation
- `actions/analytics-actions.ts:1398-1454` — CrmSheetRow mapping with null placeholders
- `components/dashboard/analytics-crm-table.tsx:232-268` — table headers including rolling rate columns

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Response attribution semantic change:** Currently `upsertLeadCrmRowOnInterest` stores response mode from BEFORE interest. Changing to AFTER interest requires:
  1. NOT storing response attribution at upsert time (Phase 90e)
  2. Computing it at query time in `getCrmSheetRows` (Phase 90c)
  → **Mitigation:** Phase 90e clears `responseMode/responseMessageId` from upsert; Phase 90c computes from first outbound AFTER `interestRegisteredAt`.

- **Follow-up query performance:** Computing follow-up due dates for N leads requires N×5 queries without batching.
  → **Mitigation:** Phase 90c must use a single batched query: `SELECT leadId, dueDate FROM FollowUpTask WHERE leadId IN (...) AND status = 'pending' ORDER BY dueDate ASC` then group/slice in-memory.

- **Inline edit collision:** Two users editing the same cell concurrently could overwrite each other.
  → **Mitigation:** Use optimistic UI with `updatedAt` staleness check; reject stale edits with "conflict" error.

- **CSV backfill matching failures:** Normalized email/phone/LinkedIn matching may fail to match existing leads if normalization differs.
  → **Mitigation:** Phase 90b must use EXACT same normalization functions used elsewhere in codebase (`lib/email-utils.ts`, `lib/phone-utils.ts`, `lib/linkedin-utils.ts`).

### Missing or ambiguous requirements
- **Lead.jobTitle vs LeadCrmRow.jobTitle:** Plan says add to `Lead`, but could argue it belongs on `LeadCrmRow` for CRM-only display.
  → **Decision:** Add to `Lead` (contact attribute, not interest-specific).

- **Heuristic mapping for status/category:** Plan says "heuristic mapping" but doesn't define the mapping table.
  → **Mitigation:** Define explicit mapping in Phase 90c: e.g., `Lead Status = "Meeting Booked" → Lead.status = "meeting-booked"`.

- **Per-edit prompt UX:** Plan mentions "prompt" but doesn't specify modal vs inline toggle vs radio.
  → **Assumption:** Use a simple dropdown/toggle within the edit cell UI (not a blocking modal).

- **Assignment dropdown source:** Plan says use workspace members, but doesn't specify role filter.
  → **Assumption:** Filter to `SETTER` role members only (consistent with Phase 89).

### Repo mismatches (fixed in this plan)
- Phase 90a references `Lead.jobTitle` — must be ADDED (doesn't exist)
- Phase 90a references `LeadCrmRow.leadType` — must be ADDED
- Phase 90a references `LeadCrmRow.applicationStatus` — must be ADDED
- Phase 90a references `LeadCrmRow.leadCategoryOverride` — must be ADDED

### Performance / timeouts
- **Computed columns query budget:** `getCrmSheetRows` currently fetches 150 rows at a time. Computing follow-ups + touch counts for 150 leads could timeout.
  → **Mitigation:** Use parallel batched queries (follow-ups, outbound counts) with 10s timeout; return partial data with warning if timeout.

- **Backfill script memory:** Large CSV (10k+ rows) loaded into memory.
  → **Mitigation:** Use streaming CSV parser (`papaparse` with streaming mode) in Phase 90b.

### Security / permissions
- **Edit action authorization:** Must check workspace access + role (Phase 85 client portal users should be read-only).
  → **Mitigation:** Phase 90c actions must call `getWorkspaceCapabilities()` and reject if `!capabilities.canEditCrm` (or similar).

- **Backfill script access:** Script runs with direct DB access; must not be exposed as an API endpoint.
  → **Mitigation:** Keep as CLI-only script in `scripts/` directory; do not add API route.

### Testing / validation
- **Test orchestrator registration:** New test files MUST be added to `scripts/test-orchestrator.ts` TEST_FILES array.
  → **Mitigation:** Phase 90f explicitly includes this step.

- **Edge case: Lead with no follow-ups:** Should show "—" for follow-up 1-5, not throw.
  → **Mitigation:** Phase 90c handles empty array gracefully.

- **Edge case: Lead with no outbound after interest:** AI vs Human should show "Unknown", not throw.
  → **Mitigation:** Phase 90c handles null first outbound gracefully.

## Assumptions (Agent)

- **Assumption:** `Lead.jobTitle` is the correct location for job title (not LeadCrmRow) (confidence ~95%)
  - Mitigation: If wrong, can migrate to LeadCrmRow in a follow-up phase.

- **Assumption:** Per-edit prompt for status/category should use inline dropdown, not modal (confidence ~85%)
  - Mitigation: If modal is preferred, Phase 90d UX can be adjusted without backend changes.

- **Assumption:** Phase 83/85/88/89 will be merged BEFORE Phase 90 implementation (confidence ~90%)
  - Mitigation: If not merged, Phase 90 must re-read all touched files before editing and merge semantically.

- **Assumption:** Backfill script should NOT import setter assignments from CSV (per Phase 89 roster changes) (confidence ~95%)
  - Mitigation: Script explicitly skips assignment columns; assignments are editable via UI.

## Resolved Questions

- [x] **Status/Category heuristic mapping:** Use 1:1 mapping where possible
  - "Qualified" → `Lead.status = "qualified"`
  - "Meeting Booked" → `Lead.status = "meeting-booked"`
  - "Not Interested" → `Lead.status = "not-interested"`
  - "Blacklisted" → `Lead.status = "blacklisted"`
  - (other) → `Lead.status = "new"`
  - For categories: map sheet values directly to `Lead.sentimentTag` with case normalization

- [x] **Inline edit conflict behavior:** Reject stale edits
  - Show error "cell was modified by another user" if row `updatedAt` changed since edit started
  - Implementation: Accept optional `expectedUpdatedAt` in `updateCrmSheetCell`; reject if mismatch

## Subphase Index
* a — Schema + contracts for editable CRM columns
* b — CSV backfill importer (idempotent, interested-only)
* c — Server actions + `getCrmSheetRows` (compute missing columns, hybrid fields)
* d — CRM table UI inline editing + remove rolling columns
* e — Fix response attribution + ensure interest upserts don't set pre-interest response
* f — Tests + QA runbook + verification commands

## Phase Summary
- Schema updated for CRM fields; `npm run db:push` executed in Phase 90a.
- CSV importer added with dry-run/apply modes; runbook + QA checklist created.
- `getCrmSheetRows` now computes step responded, follow-ups, response completion, and AI/Human response from post-interest outbound.
- Inline editing added in CRM table with assignment dropdown and automation toggle for status/category.
- `upsertLeadCrmRowOnInterest` no longer stores pre-interest response attribution.
- Quality gates:
  - `npm run test` ✅ (102 tests, 0 failures)
  - `npm run lint` ⚠️ warnings only (0 errors, 22 pre-existing warnings)
  - `npm run build` ✅

## Post-Implementation Review (2026-02-02)
**Status: ✅ COMPLETE**

All success criteria verified. See `docs/planning/phase-90/review.md` for full evidence mapping.

### Verified Deliverables
- Schema fields: `Lead.jobTitle`, `LeadCrmRow.{leadType,applicationStatus,leadCategoryOverride}` ✅
- CSV importer: `scripts/import-founders-club-crm.ts` with streaming papaparse ✅
- Computed columns: stepResponded, followUp1-5, responseStepComplete, responseMode (query-time) ✅
- Server actions: `getCrmAssigneeOptions`, `updateCrmSheetCell` with stale edit rejection ✅
- UI: Inline editing, assignment dropdown, automation toggle, rolling columns removed ✅
- Response attribution: `upsertLeadCrmRowOnInterest` sets `responseMode: null` ✅
- Tests: `lib/__tests__/crm-sheet.test.ts` registered in orchestrator ✅
- Documentation: `artifacts/backfill-runbook.md`, `artifacts/qa-checklist.md` ✅
