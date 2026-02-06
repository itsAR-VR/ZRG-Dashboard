# Phase 114 — Admin “Last 3 Days” AI Ops Visibility + Day-Only Expansion (Offered-Slot Threads)

## Purpose
Improve operator visibility and booking conversion by:
- adding an Admin Dashboard panel that shows “everything related” AI/automation logs for the past 3 days
- expanding day-only auto-booking to threads with offered slots when the lead requests a different weekday (gate-approved)

## Context
- Phase 113 hardened booking-first auto-booking (scenario-aware booking gate, day-only Scenario 3, bounded retry-once, fail-closed on gate failure).
- Follow-up request: better visibility (“see all the logs and things like that… at least for the past three days”) inside the Admin Dashboard.
- Follow-up request: when offered slots exist but the lead replies with a different weekday (e.g., we offered Tue/Wed, they say “Thursday works”), auto-book the earliest available Thursday slot **if the booking gate approves**.

## Concurrent Phases
Working tree contains uncommitted changes (Phase 112 + Phase 113 work). This phase will overlap shared surfaces and must merge semantically (do not overwrite/revert unrelated edits).

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 113 | Complete (local changes exist) | `lib/followup-engine.ts` | Extend Scenario 1/2 logic on top of Phase 113 booking-gate + day-only helpers. |
| Phase 112 | Active/dirty | Admin UI + shared AI surfaces | Avoid touching `components/dashboard/settings-view.tsx` in this phase; add visibility in Admin Dashboard tab only. Merge carefully with existing `admin-dashboard-tab` work. |

## Objectives
* [x] Expand day-only auto-booking to offered-slot threads when lead requests a different weekday (gate-approved).
* [x] Add Admin Dashboard “AI Ops (Last 3 Days)” visibility across relevant AI/automation events.
* [x] Keep PII hygiene: no raw message bodies in UI, logs, or metadata.
* [x] Validate with `npm test`, `npm run lint`, `npm run build`.

## Decisions (Locked 2026-02-06)
- Booking gate `null` policy: **fail closed always** (no auto-book; create FollowUpTask; send Slack alert).
- Day-only expansion scope: **Yes, if gate approves** (book earliest available slot on that weekday even if it was not offered).
- Slack noise policy: **do not** add Slack alerts for explicit booking-gate `deny`; instead provide Admin “last 3 days” visibility.
- UI location: Admin Dashboard tab.
- Visibility scope: “Everything related” (booking gate + meeting overseer extract + followup proposed-time parse + auto-send eval), default window = last 3 days.
- Permissions: AI Ops feed is **visible to workspace admins**, but **settings changes remain super-admin only**.

## Constraints
- Do not store or display raw inbound message text in the new Admin panel.
- Keep queries bounded and paginated (default last 72h, explicit limit + cursor/page).
- Prefer additive changes to existing admin surfaces; do not refactor unrelated settings UI.
- Preserve booking idempotency and existing persistence keys (`messageId_stage` for gate decisions).

## Success Criteria
- [x] Offered-slot threads can day-only auto-book on a different requested weekday when the gate approves.
- [x] Time-of-day filtering narrows slot selection when overseer provides `preferred_time_of_day` (graceful fallback to weekday-only).
- [x] Admin Dashboard shows a filterable, paginated "AI Ops (Last 3 Days)" feed that includes booking-gate events and related AI events.
- [x] No raw inbound message text is present in the Admin feed payloads.
- [x] `npm test`, `npm run lint`, `npm run build` pass.

## Subphase Index
* a — Day-only auto-book expansion (offered-slot threads)
* b — AI Ops feed backend (query + normalization + permissions)
* c — Admin Dashboard UI panel (filters + pagination)
* d — Tests, validation, and phase review

---

## Repo Reality Check (RED TEAM)

### Verified touch points

| Artifact | Status | Location |
|----------|--------|----------|
| `processMessageForAutoBooking` | Exists | `lib/followup-engine.ts:3153-3757` |
| `selectEarliestSlotForWeekday` | Exists | `lib/followup-engine.ts:258-282` |
| `runFollowupBookingGate` | Exists (private) | `lib/followup-engine.ts:2812-2962` |
| `runFollowupBookingGateWithOneRetry` | Exists (exported) | `lib/followup-engine.ts:3038-3046` |
| `selectOfferedSlotByPreference` | Exists | `lib/meeting-overseer.ts:157-192` |
| `normalizeTimeOfDay` | Exists | `lib/meeting-overseer.ts` (used in `selectOfferedSlotByPreference` for morning/afternoon/evening) |
| `getWorkspaceAvailabilitySlotsUtc` | Exists | `lib/availability-cache.ts:682-730` |
| `MeetingOverseerDecision` model | Exists | `prisma/schema.prisma:1062-1083` (stages observed: `"extract"` / `"gate"` / `"booking_gate"`) |
| `AIInteraction` model | Exists | `prisma/schema.prisma:1288-1319` |
| `listAiOpsEvents` | Implemented | `actions/ai-ops-feed-actions.ts` |
| `ConfidenceControlPlane` mount | Exists at line 582 | `components/dashboard/admin-dashboard-tab.tsx:582` |
| `AiOpsPanel` mount | Implemented | `components/dashboard/admin-dashboard-tab.tsx` |
| `isTrueSuperAdminUser` | Exists | `lib/workspace-access.ts` (used elsewhere; Admin tab is workspace-admin scoped) |
| Scenario type | `"accept_offered" \| "proposed_time_match" \| "day_only"` | `lib/followup-engine.ts:2780` |

### Verified featureId values for 114b queries

| featureId | promptKey | Confirmed In |
|-----------|-----------|-------------|
| `"followup.booking.gate"` | `"followup.booking.gate.v1"` | `lib/ai/prompt-registry.ts:1173`, `lib/followup-engine.ts:2940` |
| `"meeting.overseer.extract"` | `"meeting.overseer.extract.v1"` | `lib/ai/prompt-registry.ts:1185`, `lib/meeting-overseer.ts:267` |
| `"followup.parse_proposed_times"` | `"followup.parse_proposed_times.v1"` | `lib/ai/prompt-registry.ts:1149`, `lib/followup-engine.ts:2723` |
| `"auto_send.evaluate"` | `"auto_send.evaluate.v1"` | `lib/ai/prompt-registry.ts:1072`, `lib/auto-send-evaluator.ts:340` |

### Database indexes (already exist, sufficient for 114b)

- `AIInteraction[clientId, featureId, createdAt(sort: Desc)]`
- `AIInteraction[clientId, createdAt(sort: Desc)]`
- `MeetingOverseerDecision[clientId, createdAt(sort: Desc)]`
- `MeetingOverseerDecision@@unique([messageId, stage])`

---

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes

1. **Insertion point for 114a was unspecified** → In `processMessageForAutoBooking`, the new branch must go inside the `if (offeredSlots.length > 0)` block (line ~3268), AFTER the `acceptedSlot` resolution chain (line ~3326) and BEFORE the existing clarification-task fallback (line ~3328-3333). Guard: `if (!acceptedSlot && overseerDecision?.acceptance_specificity === "day_only" && overseerDecision?.preferred_day_of_week)`.

2. **MeetingOverseerDecision stage values are broader than the comment** → `MeetingOverseerDecision.stage` is a free-form string; meeting overseer uses `"extract"` / `"gate"`, and followup booking gate persists `"booking_gate"` (see `lib/followup-engine.ts`). 114b must include `"booking_gate"` to show booking-gate decisions.

3. **Auth surface mismatch risk** → Admin Dashboard is workspace-admin scoped, while Phase 112's AI interaction inspector is true-super-admin only. 114b should use `requireClientAdminAccess(clientId)` and return a non-PII DTO (no raw `payload` or raw `metadata`).

### Missing requirements (added)

4. **Trigger conditions** — 114a now specifies exact conditions: `acceptance_specificity === "day_only"` + `preferred_day_of_week` set + `selectOfferedSlotByPreference` returns null (no offered slot matches the weekday).

5. **Time-of-day filtering** — 114a will extend `selectEarliestSlotForWeekday` to accept optional `preferredTimeOfDay` and filter using the same hour ranges as `selectOfferedSlotByPreference` (morning=5-12, afternoon=12-17, evening=17-21). Graceful fallback to weekday-only if time-of-day filtering yields no results.

### Repo mismatches (corrected)

6. Stage value `"booking_gate"` is used for followup booking gate persistence (in addition to `"extract"`/`"gate"`).
7. `"auto_send.evaluate"` featureId confirmed correct
8. PII hygiene rules are in Phase 114 plan constraints, not in AGENTS.md (plan reference corrected)

### Testing gaps (added)

9. 114d now has explicit test file targets: extend `lib/__tests__/followup-engine-dayonly-slot.test.ts` + create `lib/__tests__/ai-ops-feed.test.ts`

---

## Assumptions (Agent)

- The day-only expansion uses overseer-preferred weekday/time-of-day when available, and falls back to deterministic weekday token detection when overseer is absent/unavailable. (confidence ~92%)
- Phase 114b uses a new workspace-admin-scoped action `actions/ai-ops-feed-actions.ts` (instead of the super-admin-only inspector). (confidence ~95%)
- The UI panel (114c) is a new child component `components/dashboard/ai-ops-panel.tsx` mounted in `components/dashboard/admin-dashboard-tab.tsx`. (confidence ~98%)
- No schema changes are needed — existing indexes are sufficient. (confidence ~97%)

## Phase Summary (running)
- 2026-02-06 — Implemented offered-slot weekday day-only expansion + time-of-day filtering support (files: `lib/followup-engine.ts`, `docs/planning/phase-114/a/plan.md`).
- 2026-02-06 — Implemented AI Ops feed backend (last 72h) (files: `actions/ai-ops-feed-actions.ts`, `docs/planning/phase-114/b/plan.md`).
- 2026-02-06 — Added Admin Dashboard AI Ops panel + mount (files: `components/dashboard/ai-ops-panel.tsx`, `components/dashboard/admin-dashboard-tab.tsx`, `docs/planning/phase-114/c/plan.md`).
- 2026-02-06 — Added tests + validated with `npm test`, `npm run lint`, `npm run build` (files: `lib/__tests__/followup-engine-dayonly-slot.test.ts`, `lib/__tests__/ai-ops-feed.test.ts`, `scripts/test-orchestrator.ts`).
- 2026-02-06 — Locked permissions: AI Ops visible to workspace admins; settings changes remain super-admin only. Verified schema sync with `npm run db:push` (files: `docs/planning/phase-114/plan.md`, `docs/planning/phase-114/review.md`).
