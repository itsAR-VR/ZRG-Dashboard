# Phase 131 — CRM Analytics Window + Response Types + Setter vs AI Booking Rates

## Purpose
Fix the Analytics → CRM custom date range filtering (currently selecting dates does nothing) and add first-glance + in-depth CRM analytics: response type (meeting request, information request, follow-up in future, objection), booking rates for the selected window, and setter vs AI attribution.

## Context
- User need: the CRM analytics view should support a custom date window and immediately reflect it in both the table and the summary analytics.
- User need: surface response intent quickly (Meeting Request / Information Request / Follow-up Future / Objection) and show booking conversion over the selected period.
- User need: breakdown by human setters vs AI would be especially valuable.
- Repo reality (verified):
  - `components/dashboard/analytics-view.tsx` already computes `windowParams` from date presets (including an inclusive custom end-date), but the CRM tab does not receive those params.
  - `components/dashboard/analytics-crm-table.tsx` fetches rows via `actions/analytics-actions.ts:getCrmSheetRows()` and supports filters, but does not pass `filters.dateFrom/dateTo` so the window is never applied.
  - `actions/analytics-actions.ts` already defines `CrmSheetFilters` with `dateFrom/dateTo` and `getCrmSheetRows()` already applies the filter to `LeadCrmRow.interestRegisteredAt`.
  - Response mode already exists (`CrmResponseMode`, `deriveCrmResponseMode()` in `lib/crm-sheet-utils.ts`) and the CRM table already renders "AI vs Human Response".
  - Existing sentiment tags include Meeting Requested / Call Requested / Information Requested / Follow Up / Not Interested, but there is no `Objection` sentiment yet. The plan is to add `Objection` to the sentiment taxonomy and route the classifier to it.

## Concurrent Phases
Overlaps detected by scanning the last 10 phases and current repo state (`git status --porcelain` shows a dirty working tree).

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 127 | Active (uncommitted in working tree) | Unrelated: memory governance + confidence UI (`actions/memory-governance-actions.ts`, `components/dashboard/confidence-control-plane.tsx`) | Keep this phase scoped to CRM analytics and sentiment taxonomy; do not edit memory-governance files. |
| Phase 126 | Complete | `actions/analytics-actions.ts`, `components/dashboard/analytics-view.tsx` | Re-read current implementations before edits; keep analytics windowing + serialization constraints intact. |
| Phase 130 | Complete | `lib/inbound-post-process/pipeline.ts` | When adding a new sentiment label, preserve Phase 130 behavior (auto-send pipeline) and update switch/case passthrough safely. |
| Phase 132 | Active (untracked planning + code in working tree) | Analytics + attribution adjacent (`actions/analytics-actions.ts`, `components/dashboard/analytics-view.tsx`) | Avoid duplicating windowing/attribution logic; coordinate any shared-file changes (especially `actions/analytics-actions.ts`). |

## Objectives
* [x] Make Analytics date window apply to CRM tab data (table + summary).
* [x] Add response-type visibility (Meeting Request / Information Request / Follow-up Future / Objection) and optional filtering.
* [x] Add booking rates for the selected window and show **both**:
  - Cohort conversion: leads that entered in window that ever book.
  - In-window rate: leads that entered and booked inside the same window.
* [x] Show attribution breakdowns: AI vs Human and per-setter (top setters).
* [x] Add tests for new derivations and critical windowing behavior; pass quality gates.

## Constraints
- No secrets/tokens/PII committed.
- Keep Server Action return shapes consistent: `{ success, data?, error? }`.
- Prefer DB aggregates for summary metrics (avoid client-side full-table scans).
- Keep the CRM window definition consistent everywhere:
  - Cohort membership is based on `LeadCrmRow.interestRegisteredAt`.
  - `windowTo` is exclusive; Analytics custom range UI already makes end-date inclusive by adding +1 day in `analytics-view.tsx`.
- Response-type classification is sentiment-based (deterministic), with a new `Objection` sentiment label added to the classifier taxonomy.
- Avoid Prisma schema changes unless absolutely necessary (sentimentTag is a `String`, so this should remain schema-free).

## Success Criteria
1. In Analytics, selecting `Custom range` and picking `From`/`To` changes the CRM tab row set and summary metrics immediately (no refresh required). (Done)
2. CRM tab shows response-type breakdown and AI vs Human breakdown for the selected window. (Done)
3. CRM tab shows booking rates (cohort conversion and in-window rate) for the selected window. (Done)
4. Setter vs AI breakdown is visible and matches the underlying response-mode attribution logic. (Done)
5. Quality gates pass: `npm test`, `npm run lint`, `npm run build`. (Done)

## Phase Summary (running)
- 2026-02-10 17:07 EST — Fixed CRM windowing + added response type + booking conversion KPIs and setter/AI attribution breakdowns; shipped Objection sentiment taxonomy + prompt/pipeline updates; verified quality gates. (files: `components/dashboard/analytics-view.tsx`, `components/dashboard/analytics-crm-table.tsx`, `actions/analytics-actions.ts`, `lib/crm-sheet-utils.ts`, `lib/sentiment-shared.ts`, `lib/ai/prompts/sentiment-classify-v1.ts`, `lib/inbound-post-process/pipeline.ts`, `lib/sentiment.ts`, `lib/ai/prompt-registry.ts`, `lib/__tests__/crm-sheet.test.ts`)
- 2026-02-10 19:44 EST — Tweaked CRM analytics semantics: show Any vs Kept booking metrics, classify any `Follow Up` sentiment as follow-up-in-future, and make Response Mode filtering match effective mode; re-ran quality gates. (files: `actions/analytics-actions.ts`, `components/dashboard/analytics-crm-table.tsx`, `lib/crm-sheet-utils.ts`, `lib/__tests__/crm-sheet.test.ts`, `docs/planning/phase-131/f/plan.md`, `docs/planning/phase-131/plan.md`)
- 2026-02-10 19:48 EST — Updated Phase 131 review to reflect 131f semantics; queued phase-gaps RED TEAM pass. (files: `docs/planning/phase-131/review.md`, `docs/planning/phase-131/f/plan.md`, `docs/planning/phase-131/plan.md`)

## Repo Reality Check (RED TEAM)

- Note: The bullets below reflect the pre-implementation state captured during planning; the Phase Summary documents the changes shipped in this phase.

- What exists today:
  - `components/dashboard/analytics-view.tsx` computes `windowParams` (lines 156-159, shape `{ from: string; to: string } | undefined`) with inclusive end-date via +1 day (line 146), but does NOT pass it to `<AnalyticsCrmTable />` (line 1078 passes only `activeWorkspace`).
  - `components/dashboard/analytics-crm-table.tsx` props accept only `activeWorkspace` (line 317-319). Filters state is `CrmSheetFilters` but `dateFrom/dateTo` are never set. `normalizedFilters` (lines 333-340) only normalizes `campaign`, `leadCategory`, `leadStatus`.
  - `actions/analytics-actions.ts` `CrmSheetFilters` (lines 504-511) includes `dateFrom/dateTo`. `getCrmSheetRows()` applies them to `LeadCrmRow.interestRegisteredAt` using `gte`/`lte` (lines 1760-1773). Filter infrastructure is ready — just needs wiring.
  - `CrmSheetRow.dateOfBooking` maps to `Lead.appointmentBookedAt` (line 1995). `LeadCrmRow` has NO booking fields — must JOIN to `Lead`.
  - "AI vs Human Response" column already renders in CRM table (header line 636, cell line 780) using `responseModeLabel()` helper (lines 50-55).
  - `deriveCrmResponseMode()` exists in `lib/crm-sheet-utils.ts` (lines 30-34), returns `CrmResponseMode` (AI/HUMAN/UNKNOWN).
  - `SENTIMENT_TAGS` in `lib/sentiment-shared.ts` (lines 4-18) has 13 tags; "Objection" does NOT exist yet.
  - Classifier prompt in `lib/ai/prompts/sentiment-classify-v1.ts` has priority order (line 26) ending: `...Follow Up > Not Interested > Interested > Neutral`.
  - `mapInboxClassificationToSentimentTag()` switch in `lib/inbound-post-process/pipeline.ts` (lines 36-59) defaults unknown classifications to "Neutral".
  - `lib/sentiment.ts` has separate `EmailInboxClassification` type (line 289), `allowed_categories` (line 409), schema enum (line 533), and validation list (line 589) — all need "Objection" for cross-channel consistency.
  - `lib/crm-sheet-utils.ts:mapSentimentTagFromSheet()` (lines 20-28) maps manual CRM imports — needs "Objection" entry.
  - Existing booking rate pattern in setter funnel (line 1678-1681): `l.appointmentBookedAt !== null || l.ghlAppointmentId !== null`. Reuse this dual-field OR logic.

- Verified touch points:
  - `components/dashboard/analytics-view.tsx` — `windowParams`, `windowRange`, `AnalyticsCrmTable` rendering
  - `components/dashboard/analytics-crm-table.tsx` — props, filters, normalizedFilters, getCrmSheetRows calls
  - `actions/analytics-actions.ts` — `CrmSheetFilters`, `getCrmSheetRows()`, `CrmSheetRow`
  - `lib/sentiment-shared.ts` — `SENTIMENT_TAGS`, `SENTIMENT_TO_STATUS`, `POSITIVE_SENTIMENTS`
  - `lib/ai/prompts/sentiment-classify-v1.ts` — prompt categories + priority order
  - `lib/inbound-post-process/pipeline.ts` — `mapInboxClassificationToSentimentTag()` switch
  - `lib/sentiment.ts` — `EmailInboxClassification`, `analyzeInboundEmailReply()`
  - `lib/crm-sheet-utils.ts` — `deriveCrmResponseMode()`, `mapSentimentTagFromSheet()`
  - `lib/snooze-detection.ts` — `detectSnoozedUntilUtcFromMessage()`, already integrated in pipeline
  - `prisma/schema.prisma` — `Lead.appointmentBookedAt`, `Lead.ghlAppointmentId`, `LeadCrmRow` (no booking fields)

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Sentiment hardcode coverage**: Plan originally listed 3 files for "Objection" update. RED TEAM found **5 locations** total that must be updated (auto-reply-gate and auto-send-evaluator excluded per user decision — AI handles objections without hard block). Missing any causes silent fallback to "Neutral". → Expand 131b scope.
- **Booking evidence location**: `LeadCrmRow` has NO booking fields. Booking evidence (`appointmentBookedAt`, `ghlAppointmentId`) lives only on `Lead`. → 131c must JOIN to Lead model.
- **Canceled bookings counted**: No filter for appointment status. Leads with `appointmentStatus = 'canceled'` would inflate booking rates. → 131c must exclude canceled appointments.

### User decisions (locked)
- **Objection auto-reply/auto-send**: NO hard block. AI handles objections without human review. Do NOT update `lib/auto-reply-gate.ts` or `lib/auto-send-evaluator.ts`.
- **Objection priority order**: Follow Up > **Objection** > Not Interested.

### All 5 sentiment hardcode locations for "Objection"

| # | File | Lines | What to Update |
|---|------|-------|----------------|
| 1 | `lib/sentiment-shared.ts` | 4-18, 23-37 | Add to `SENTIMENT_TAGS` + `SENTIMENT_TO_STATUS` (→ `"new"`) |
| 2 | `lib/ai/prompts/sentiment-classify-v1.ts` | 26, 28-41 | Add category definition + priority: Follow Up > Objection > Not Interested |
| 3 | `lib/inbound-post-process/pipeline.ts` | 36-59 | Add `case "Objection": return "Objection"` to switch |
| 4 | `lib/sentiment.ts` | 289, 409, 533, 589 | Add `"Objection"` to type, allowed_categories, schema enum, validation list |
| 5 | `lib/crm-sheet-utils.ts` | 20-28 | Add `if (normalized === "objection") return "Objection"` |

### Performance / timeouts
- Summary aggregates (131c) should use SQL `COUNT`/`SUM(CASE...)` with window-scoped WHERE — avoid loading all CrmRows into JS.
- Existing pattern to follow: reactivation analytics SQL CTEs in `actions/analytics-actions.ts` (lines 207-280).

### Testing / validation
- 131e must test: response-type derivation for all 5 types, `mapInboxClassificationToSentimentTag("Objection")` returns "Objection" (not "Neutral"), and booking rate computation excludes canceled appointments.

## Open Questions (Need Human Input)

- [ ] Should “Kept” also exclude `no_show` (or be based on `showed` only), not just cancellations? (confidence <90%)
  - Why it matters: this changes the Kept booking counts/rates across the KPI strip and all breakdown tables.
  - Current assumption in this phase: Kept means “not canceled” (`appointmentStatus != 'canceled'` AND `appointmentCanceledAt` is null).

## Subphase Index
* a — Wire Analytics window into CRM table fetch (fix custom date)
* b — Add `Objection` sentiment (5 locations) + derive response type taxonomy
* c — Add server-side CRM window summary aggregates (rates + breakdowns)
* d — Render CRM analytics summary UI + filters + table tweaks
* e — Tests + QA + quality gates
* f — Semantics tweaks: any vs kept bookings, Follow Up response type, effective response-mode filtering
