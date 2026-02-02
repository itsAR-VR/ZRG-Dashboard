# Phase 83 — CRM Analytics (Google Sheet Replica) + Pipeline/Sales Skeleton

## Purpose
Recreate the Founders Club CRM Google Sheet view inside the **Analytics** tab, keep it updated automatically as “interest” comes in, and add **schema skeleton** to support pipeline + sales-call recording/outcome fields (without building full workflows yet).

## Context
- Source of truth (layout/columns): Google Sheet (user provided link) + local `Founders Club CRM.xlsx` (full workbook layout).
- Current product surface:
  - Analytics view exists: `components/dashboard/analytics-view.tsx`
  - CRM view exists (separate from Analytics): `components/dashboard/crm-view.tsx`
- Current data primitives that already exist and can power a first “sheet replica”:
  - Interest detection: inbound post-process pipelines classify sentiment (`lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/sms-inbound-post-process.ts`)
  - Campaign attribution: `Lead.emailCampaignId`, `Lead.smsCampaignId`, `Lead.campaignId`
  - Response attribution: outbound `Message.sentBy` (`ai` | `setter`) + `Message.sentByUserId`
  - Lead score: `Lead.overallScore` (+ fit/intent if needed)
  - Booking/meeting signals: `Lead.appointmentBookedAt`, `Appointment` history
- Goal framing:
  - **MVP:** replicate the sheet view and populate key fields for “interest” rows automatically.
  - **Skeleton only (no full workflows yet):** add nullable pipeline + sales call fields/models so future AI optimization and sales ops can be built on top.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 80 | Uncommitted | `prisma/schema.prisma`, booking/followup behavior | Schema changes must be merged cleanly before adding new CRM models/fields |
| Phase 81 | Uncommitted | `prisma/schema.prisma`, Slack/auto-send | Same schema coordination requirement as Phase 80 |
| Phase 79 | Uncommitted | inbound drafting logic | Independent, but shares “interest” concepts and booking flows |
| Phase 82 | Active (planning artifacts) | Founders Club CRM column inventory | Reuse column list + mapping notes as inputs for the replica |

## Objectives
* [x] Capture the Google Sheet layout (columns, sections, formulas, formatting intent) and define the in-app replica spec
* [x] Add Prisma schema skeleton to persist:
  - “interest registered” metadata
  - pipeline status/value/outcomes
  - sales call recording/outcome/coaching fields
* [x] Define a live automation path so rows appear/refresh as new inbound interest is detected
* [x] Plan the Analytics tab UX: spreadsheet-like table, filters, and export
* [x] Document future (not-now) features in `README.md` (sales call scoring/training, AI optimization loop)

## Constraints
- Do not store or commit Google Sheet row data or any CRM exports containing PII.
- Must respect workspace isolation (only show data within `resolveClientScope`).
- Idempotency required for automated row creation/updates (webhooks + retries are common).
- Keep MVP performant for large datasets (virtualized table, pagination/cursor queries).

## MVP Columns (Requested)
The first version of the in-app CRM table must include at minimum:

| Column | Meaning | Likely Source (Current Repo) |
|--------|---------|------------------------------|
| Date lead responded with interest | First time the lead expressed interest | Inbound `Message.sentAt` at the moment sentiment becomes positive (captured during inbound post-process) |
| Type of interest | What kind of interest | `Lead.sentimentTag` (e.g., “Meeting Requested”, “Information Requested”, etc.) |
| Lead status | Current lifecycle state | `Lead.status` |
| Campaign it came from | Attribution | `Lead.emailCampaignId` / `Lead.smsCampaignId` (+ name snapshot) |
| AI vs human response | Who handled the response/flow | Derived from nearest prior outbound `Message.sentBy` / `Message.sentByUserId` (deterministic rule in Phase 83c) |
| Lead score | Quality score | `Lead.overallScore` (and/or fit/intent/overall) |

## Success Criteria
- [x] Clear spec for a “Google Sheet replica” view inside Analytics (columns + ordering + computed fields).
- [x] Clear schema plan (models/enums/fields + indexes) that supports pipeline + sales call metadata while staying optional/nullable.
- [x] Clear automation plan for “lead registered interest” → row appears/updates.
- [x] README contains a concise roadmap note for the future sales-call + AI optimization loop.

## Subphase Index
* a — Sheet replica spec (Playwright + workbook validation)
* b — Schema skeleton (Prisma models/enums + indexes)
* c — Live automation plan (interest detection + idempotent upserts)
* d — Analytics UI plan (table, filters, export, performance)
* e — README roadmap (future features, not implemented)

## Phase Summary

### Status: Complete

**What shipped:**
- Sheet replica spec based on the local workbook headers (Playwright not required per current request)
- Schema skeleton in `prisma/schema.prisma` (`LeadCrmRow`, `CrmResponseMode`, pipeline + sales call fields)
- Live CRM row upserts via `lib/lead-crm-row.ts` wired into inbound post-process pipelines
- Analytics CRM table UI in `components/dashboard/analytics-crm-table.tsx` and tabbed layout in `components/dashboard/analytics-view.tsx`
- Server action `getCrmSheetRows` in `actions/analytics-actions.ts`
- Roadmap update in `README.md` documenting skeleton-only CRM/pipeline/sales-call fields

**Key decisions:**
- Store CRM row data in a 1:1 `LeadCrmRow` model to avoid bloating `Lead`.
- Attribute AI vs human response from the most recent outbound message in the same channel.
- Keep pipeline and sales-call fields nullable until workflows are built.

**Artifacts / code paths:**
- `prisma/schema.prisma`
- `lib/lead-crm-row.ts`
- `lib/inbound-post-process/pipeline.ts`
- `lib/background-jobs/email-inbound-post-process.ts`
- `lib/background-jobs/sms-inbound-post-process.ts`
- `lib/background-jobs/linkedin-inbound-post-process.ts`
- `actions/analytics-actions.ts`
- `components/dashboard/analytics-crm-table.tsx`
- `components/dashboard/analytics-view.tsx`
- `README.md`

**Notes:**
- Playwright validation was intentionally skipped; the workbook headers were sufficient for the MVP replica.
