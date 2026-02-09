# Phase 126d — Tests, QA, and Coordination Notes

## Focus
Ship with confidence: tests to prevent regressions, explicit QA scenarios, and coordination notes given concurrent schema/analytics work.

## Inputs
- New schema + ingestion changes (126a)
- New capacity metric module (126b)
- Analytics/UI wiring (126c)
- Dedicated backfill function (126a)
- Existing test harness: `scripts/test-orchestrator.ts` (Node `node:test`, manual `TEST_FILES` array)

## Work

### 1. Unit tests (minimal but meaningful)

**Capacity metric math** — `lib/__tests__/calendar-capacity-metrics.test.ts`:
- `bookedPct` math: denom=0 → null, 5 booked + 15 available → 0.25, etc.
- Combined totals = sum of breakdown totals + unattributed
- Window filtering: slots before `now` excluded, slots after `now + windowDays` excluded
- Empty cache: returns `bookedPct: null`, `totalSlots: 0`
- Stale cache: `cacheMeta[].isStale === true` when `staleAt < now`
- Date serialization: verify no `Date` objects in output (all ISO strings)

**Schema guard test (RED TEAM L-1 — use type assertion, not text parsing):**
Instead of reading `prisma/schema.prisma` as text, use Prisma's generated types:
```typescript
// lib/__tests__/prisma-appointment-calendar-fields.test.ts
import type { Prisma } from "@prisma/client";

// Type-level assertion — compilation fails if fields don't exist
type _AssertGhlCalendarId = Prisma.AppointmentCreateInput["ghlCalendarId"];
type _AssertCalendlyEventTypeUri = Prisma.AppointmentCreateInput["calendlyEventTypeUri"];

test("Appointment model has calendar attribution fields", () => {
  // If this file compiles, the fields exist. Runtime assertion for test runner:
  const input: Partial<Prisma.AppointmentCreateInput> = {
    ghlCalendarId: "test-calendar-id",
    calendlyEventTypeUri: "https://api.calendly.com/event_types/test",
  };
  assert.ok(input.ghlCalendarId);
  assert.ok(input.calendlyEventTypeUri);
});
```

**Register both in `scripts/test-orchestrator.ts`** — add to `TEST_FILES` array:
- `"lib/__tests__/calendar-capacity-metrics.test.ts"`
- `"lib/__tests__/prisma-appointment-calendar-fields.test.ts"`

### 2. QA scenarios (manual)

**Scenario A — GHL provider, full attribution:**
- Workspace with `meetingBookingProvider = GHL`
- Default calendar configured (`ghlDefaultCalendarId` set)
- Availability cache populated with slots in next 30d
- At least one CONFIRMED appointment in next 30d with `ghlCalendarId` matching default calendar
- **Verify:** KPI card shows correct percentage, tooltip shows breakdown

**Scenario B — Calendly provider:**
- Workspace with `meetingBookingProvider = CALENDLY`
- Event type URI configured (`calendlyEventTypeUri` set)
- Webhook or reconcile populates `calendlyEventTypeUri` on Appointment
- **Verify:** Same as Scenario A but via Calendly path

**Scenario C — Unattributed bookings:**
- Workspace with historical appointments (pre-Phase-126, attribution fields NULL)
- **Verify:** `unattributedBookedSlots > 0` appears in tooltip with explanation text
- Run `backfillAppointmentAttribution(clientId)` → verify count decreases

**Scenario D — No calendar configured:**
- Workspace with no `WorkspaceAvailabilityCache` rows
- **Verify:** KPI card shows "—", no errors

**Scenario E — Stale cache:**
- Workspace where `WorkspaceAvailabilityCache.staleAt < now`
- **Verify:** Tooltip shows staleness warning with relative time

**Scenario F — Insights Chat (workspace-scope):**
- Open Insights Chat with no campaign filter
- Ask: "What is my calendar capacity?"
- **Verify:** AI cites real numbers from the capacity metric

**Scenario G — Insights Chat (campaign-scope):**
- Open Insights Chat with a campaign filter active
- Ask about capacity
- **Verify:** AI does NOT hallucinate capacity numbers (it lacks the data)

### 3. Coordination / merge hygiene (RED TEAM M-2)

**Phase 123 overlap:** Both phases modify `prisma/schema.prisma`. Phase 123 adds `DraftPipelineRun` and `DraftPipelineArtifact` models. Phase 126 adds fields to `Appointment` + new composite index.
- **Action:** Re-read `prisma/schema.prisma` before editing. Do not assume HEAD matches.
- **Action:** Run `npm run db:push` only after both phases' schema changes are merged.
- **Action:** If Phase 123 has already pushed, rebase Phase 126 schema edits on top.

**Phase 120 overlap:** Both phases modify `components/dashboard/analytics-view.tsx`. Phase 120 added AI draft booking conversion cards.
- **Action:** Do not remove or reorder existing cards. Add the 8th KPI card to the end of the `kpiCards` array.
- **Action:** The grid layout change (`lg:grid-cols-7` → `md:grid-cols-4`) affects all existing cards — verify they still render correctly.

**Phase 124 overlap:** Modifies `lib/workspace-capabilities.ts` and settings actions.
- **Action:** Keep commits isolated. Do not bundle unrelated settings/RBAC work.

**Keep commits scoped:**
1. Schema + ingestion attribution (126a) — first
2. Capacity metric module (126b) — second
3. Analytics/UI wiring (126c) — third
4. Tests (126d) — last

### 4. Quality gates

Run and record results:
- `npm test` — all tests pass including new capacity metric tests
- `npm run lint` — no new errors
- `npm run build` — succeeds (confirms Server Action serialization, type safety)

### Validation Steps
1. All new tests pass in `scripts/test-orchestrator.ts`
2. Existing tests still pass (no regressions from schema changes)
3. All 7 QA scenarios verified manually
4. Quality gates pass: `npm test && npm run lint && npm run build`

## Output
- Tests in place, QA checklist documented, and coordination notes captured for concurrent phases.

## Handoff
- Follow with a short `review.md` summarizing actual files changed, test outputs, and any production monitoring to validate the metric.
- Consider future enhancement: admin endpoint to trigger `backfillAppointmentAttribution` for all workspaces.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Verified Phase 126 implementation is present on disk (capacity module, analytics wiring, UI KPI card, and appointment attribution write paths).
  - Ran quality gates (`npm test`, `npm run lint`, `npm run build`) against the current combined working tree state.
- Commands run:
  - `git status -sb` — dirty working tree (multiple concurrent phases active locally)
  - `npm test` — PASS (261 tests)
  - `npm run lint` — PASS (0 errors, warnings only)
  - `npm run build` — PASS (Next.js build succeeded; CSS optimization warnings only)
  - `npm run db:push` — PASS ("database is already in sync")
- Blockers:
  - Manual QA not performed yet (UI + Insights Chat scenarios from this subphase).
- Next concrete steps:
  - Run `$phase-gaps` on Phase 126 and patch docs if any gaps remain.
  - Run `$phase-review` and write `docs/planning/phase-126/review.md` (include evidence from test/lint/build and the db:push outcome or blocker).
