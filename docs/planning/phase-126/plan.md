# Phase 126 — Calendar Capacity Utilization Metric (% Booked)

## Purpose
Add a "true booking %" metric so operators (and the Insights AI) can see calendar load and decide when a client needs more team capacity / availability.

## Context
- User intent (2026-02-09): to know real/true booking %, the AI needs a calendar availability % metric.
  - Proposed metric: `booked_slots / (booked_slots + available_slots)` (aka "% booked").
  - Goal: spot clients who are capacity constrained and should expand their team or available time frame.
- Repo reality:
  - We already cache *available* slots per workspace in `WorkspaceAvailabilityCache` (`slotsUtc`, `availabilitySource` = DEFAULT | DIRECT_BOOK).
  - We already persist bookings in `Appointment` (Phase 34) and roll them up onto `Lead`.
  - Missing piece: `Appointment` does not store calendar identifiers (GHL calendarId / Calendly event_type uri), so "booked vs available" cannot be matched to the same calendar/event-type reliably.
  - Analytics snapshot for Insights Chat comes from `actions/analytics-actions.ts:getAnalytics()`, which is stored in `InsightContextPack.metricsSnapshot`.

## Concurrent Phases
Overlaps detected by scanning the last 10 phases and current repo state (`git status --porcelain`).

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 123 | Active (local docs untracked) | `prisma/schema.prisma` (adds DraftPipelineRun/DraftPipelineArtifact) | Coordinate schema edits; merge models/indexes cleanly; run `npm run db:push` after both land. |
| Phase 125 | Active (local docs untracked) | Availability domain (AI draft refresh) | Avoid touching availability-refresh modules; keep this phase scoped to cache + analytics + appointment attribution. |
| Phase 124 | Active (local docs untracked) | Settings/RBAC fixes (`lib/workspace-capabilities.ts`, `actions/settings-actions.ts`) | Keep commits isolated; do not bundle unrelated settings/RBAC work. |
| Phase 120 | Complete | `components/dashboard/analytics-view.tsx` (analytics UI) | Integrate UI changes without breaking existing cards and windowing fetch logic. |
| Working tree | Dirty | `prisma/schema.prisma` already modified | Re-read current schema before edits; do not assume HEAD matches. |

## Objectives
* [x] Attribute bookings to the calendar/event-type that produced availability (schema + write paths)
* [x] Compute "% booked" for a forward-looking window (default: next 30 days)
* [x] Surface metric in workspace analytics UI and include in Insights Chat analytics snapshot
* [x] Preserve safety and performance (no external provider calls in analytics; cache-only)
* [x] Add tests + run quality gates
* [x] Run `npm run db:push` against the intended DB environment (required due to Prisma schema changes)

## Constraints
- Never commit secrets/tokens/PII.
- Prisma schema changes require `npm run db:push` against the correct DB before considering the phase done.
- Analytics must not trigger external availability fetches; use `WorkspaceAvailabilityCache` and DB-only appointment counts.
- Default window: next 30 days (from "now").
- Numerator definition: appointments with `Appointment.status = CONFIRMED` and `startAt` within the window.
- Combined capacity: produce one combined metric across DEFAULT + DIRECT_BOOK, but keep an explicit breakdown and an "unattributed booked" count to avoid misleading totals.
- All analytics payloads must be Server Action serializable (no `Date` instances returned to client).

## Success Criteria
1. For a workspace with configured calendar links and at least one booking, analytics returns:
   - `capacity.bookedPct` (combined) and DEFAULT/DIRECT_BOOK breakdowns
   - `unattributedBookedSlots` when bookings exist but cannot be mapped to configured identifiers
   - `cacheMeta` with `fetchedAtIso`, `isStale`, `lastError` (required, not optional)
2. Analytics UI shows a KPI card **"Capacity (30d)"** with tooltip showing full breakdown (booked/available/total, DEFAULT vs DIRECT_BOOK, unattributed count, cache freshness warning if stale).
3. Insights Chat can answer questions referencing the metric — **workspace-scope only** (when no campaign filter is active). Campaign-scoped chats do not include capacity; this is a documented limitation because `buildAnalyticsSnapshot()` only calls `getAnalytics()` on the workspace path.
4. Backfill behavior: a **dedicated backfill function** (`backfillAppointmentAttribution`) populates missing calendar attribution onto existing `Appointment` rows. This is NOT done via reconciliation early-return modification (see RED TEAM CRITICAL-2).
5. Quality gates pass: `npm test`, `npm run lint`, `npm run build`.

## Subphase Index
* a — Data model + ingestion attribution (Appointment calendar identifiers) + dedicated backfill function
* b — Capacity computation module (cache + appointment counts, combined + breakdown)
* c — Analytics + UI + Insights snapshot integration (workspace-scope only)
* d — Tests + QA + rollout notes (quality gates, edge cases, coordination)

## Success Criteria Status (Running)
* [ ] (1) Runtime analytics payload validated for a real workspace (capacity object + breakdown + cacheMeta)
* [ ] (2) Analytics UI manually verified (Capacity (30d) card + tooltip + grid layout)
* [ ] (3) Insights Chat manually verified (workspace-scope uses capacity; campaign-scope does not hallucinate)
* [x] (4) Backfill function exists (`backfillAppointmentAttribution`)
* [x] (5) Quality gates pass (`npm test`, `npm run lint`, `npm run build`)

## Phase Summary
- Shipped:
  - Implemented capacity utilization (% booked) end-to-end (schema + attribution + metric compute + analytics/UI wiring) and added unit/type tests. (files: `prisma/schema.prisma`, `lib/appointment-upsert.ts`, `lib/booking.ts`, `app/api/webhooks/calendly/[clientId]/route.ts`, `lib/ghl-appointment-reconcile.ts`, `lib/calendly-appointment-reconcile.ts`, `lib/calendar-capacity-metrics.ts`, `actions/analytics-actions.ts`, `components/dashboard/analytics-view.tsx`, `lib/__tests__/calendar-capacity-metrics.test.ts`, `lib/__tests__/prisma-appointment-calendar-fields.test.ts`, `scripts/test-orchestrator.ts`)
- Verified (2026-02-09):
  - `npm test`: pass
  - `npm run lint`: pass (warnings only)
  - `npm run build`: pass
  - `npm run db:push`: pass ("database is already in sync")
- Notes:
  - Manual QA not performed yet (UI + Insights Chat scenarios).

## Open Questions (Need Human Input)
* Manual QA: do you want us to verify the UI + Insights Chat scenarios locally now, or defer to post-deploy verification?
  - Why it matters: the code is compiled + tested, but the highest-signal validation is confirming real workspaces show expected capacity numbers and tooltips, and that campaign-scoped Insights Chat does not hallucinate.
  - Default assumption until confirmed: defer manual QA to post-deploy / live verification.

## RED TEAM Findings (2026-02-09)

Adversarial repo-reality review identified 10 findings. All decisions resolved.

### CRITICAL (plan revisions applied below)

| # | Finding | Resolution |
|---|---------|------------|
| C-1 | `buildAnalyticsSnapshot()` has two mutually exclusive paths — campaign path calls `getEmailCampaignAnalytics()` only, NOT `getAnalytics()`. Capacity metric invisible in campaign-scoped Insights Chat. | **Workspace-only.** Document limitation. No changes to campaign path. |
| C-2 | Reconciliation `needsUpdate` checks Lead rollup, NOT Appointment fields. Modifying early-return to detect NULL attribution adds a DB read to every reconcile call's hot path. | **Dedicated backfill function** (`backfillAppointmentAttribution`). Reconciliation hot path unchanged. |

### HIGH (implementation notes added to subphases)

| # | Finding | Resolution |
|---|---------|------------|
| H-1 | No composite index for windowed appointment counts via nested `lead: { clientId }` filter. | Add `@@index([leadId, status, startAt])` in 126a schema changes. |
| H-2 | Cache staleness not surfaced — plan had cache meta as "optional". | Upgraded to **required**. Tooltip shows freshness warning. |
| H-3 | KPI grid `lg:grid-cols-7` + 8th card = truncation risk. | Label shortened to **"Capacity (30d)"**. Grid to `lg:grid-cols-4` (2 rows). |
| H-4 | `getWorkspaceAvailabilityCache()` returns `Date` objects — Server Action serialization trap. | Explicit `.toISOString()` conversion at serialization boundary. |

### MEDIUM/LOW

| # | Finding | Resolution |
|---|---------|------------|
| M-1 | `slotsUtc` filtering is in-memory array processing, not SQL. | Clarified in 126b. Use existing `getWorkspaceAvailabilitySlotsUtc()` utility. |
| M-2 | Phase 123 schema conflict (`DraftPipelineRun` models). | Re-read schema before editing. Sequential `db:push`. |
| M-3 | "Unattributed" definition ambiguous (pre-126 vs misconfigured vs webhook gap). | Tooltip explains: "may be historical (pending backfill) or from unconfigured calendars." |
| L-1 | Schema guard test (text parsing) is fragile. | Use type-level Prisma assertion instead. |

### Repo Reality — Verified Write Paths

All 5 appointment write paths have the calendar ID / event type URI **available at call site** but do NOT currently pass it to `upsertAppointmentWithRollup`:

| Write Path | Calendar ID Available As | Currently Passed? |
|---|---|---|
| `lib/booking.ts` → GHL | `calendarId` param / `settings.ghlDefaultCalendarId` | ❌ |
| `lib/booking.ts` → Calendly | `selectedEventTypeUri` variable | ❌ |
| `app/api/webhooks/calendly/[clientId]/route.ts` | `eventTypeUri` from `parseInviteePayload()` | ❌ |
| `lib/ghl-appointment-reconcile.ts` | `primary.calendarId` from GHL API response | ❌ |
| `lib/calendly-appointment-reconcile.ts` | `primary.event.event_type` from Calendly API response | ❌ |

### Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Insights Chat scope for capacity metric | **Workspace-only** — document limitation |
| 2 | Backfill strategy for existing Appointments | **Dedicated backfill pass** — no hot-path impact |
| 3 | KPI card label | **"Capacity (30d)"** — full explanation in tooltip |
