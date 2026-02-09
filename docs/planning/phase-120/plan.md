# Phase 120 — AI Draft Booking Conversion Analytics

## Purpose
Extend Analytics so the existing **AI Draft Response Outcomes** view also shows **booking conversion rates** attributable to AI-drafted outbound messages.

## Context
- Current UI (`components/dashboard/analytics-view.tsx`) shows counts of AI-draft response dispositions (Auto‑Sent / Approved / Edited) by channel.
- The user wants “stats for like booking rates and things like that” tied to these AI draft outcomes.
- Repo already tracks booking evidence on `Lead` (e.g. `appointmentBookedAt`, `ghlAppointmentId`, Calendly URIs).
- We should anchor any time windowing to an immutable send-time source. Existing outcome analytics already does this by deriving send time from `min(Message.sentAt)` per draft (via a `draft_send_time` CTE), specifically to avoid `AIDraft.updatedAt` drift.

Decisions (from conversation):
- Booking attribution window: **30 days** after send.
- Pending buffer: **7 days** (exclude the newest 7 days from the rate to avoid undercounting).
- UI breakdown: **Channel + disposition** (Email/SMS/LinkedIn x Auto‑Sent/Approved/Edited).

## Concurrent Phases
Overlaps detected by scanning the last 10 phases (119 → 110) and current repo state.

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 110 | Complete | `actions/ai-draft-response-analytics-actions.ts` windowing semantics | Reuse the existing `draft_send_time` anchor pattern; do not regress the existing outcomes query. |
| Phase 111 | Complete | `responseDisposition` correctness (idempotent paths) | Booking conversion breakdown depends on accurate `responseDisposition`; no schema changes required. |
| Phase 119 | Active/Unknown | AI reliability work (unrelated) | No direct file overlap expected; keep changes scoped to analytics. |

## Objectives
* [x] Add a server action that computes booking conversions attributable to AI draft sends, broken down by channel + disposition.
* [x] Add an Analytics UI card showing eligible/booked/pending and booking rate for each bucket.
* [x] Add lightweight regression tests to keep windowing anchored to send time and prevent drift.
* [x] Validate locally (`npm test`, `npm run lint`, `npm run build`).

## Constraints
- No secrets/tokens/PII in code or logs.
- Keep Server Actions returning `{ success, data?, error? }`.
- Keep analytics windowing anchored to message send time (do not use `AIDraft.updatedAt`).
- Email stats must match existing outcomes semantics: **only AI_AUTO_SEND campaigns**.
- Keep queries bounded and protected by a statement timeout (match other analytics actions).
- No Prisma schema changes in this phase.

## Success Criteria
- [x] Analytics page shows a new card under Campaigns: **AI Draft Booking Conversion**.
- [x] Card shows 9 buckets (3 channels x 3 dispositions) with:
  - Booked, Not booked, Pending, Booked-no-timestamp
  - Booking rate = `booked / (booked + not_booked)` — excludes PENDING and BOOKED_NO_TIMESTAMP from denominator
- [x] Query deduplicates by lead (not by draft) for the final aggregation.
- [x] Query applies two-layer time windowing: UI date range on `dst."sentAt"` AND attribution window on `appointmentBookedAt`.
- [x] Email rows are filtered to `EmailCampaign.responseMode = AI_AUTO_SEND`.
- [x] `npm test`, `npm run lint`, `npm run build` all pass.

## Phase Summary (running)
- 2026-02-09 — Added AI draft booking conversion analytics server action + UI card + regression test; verified via local test/lint/build. (files: `actions/ai-draft-response-analytics-actions.ts`, `components/dashboard/analytics-view.tsx`, `lib/__tests__/ai-draft-booking-conversion-windowing.test.ts`, `scripts/test-orchestrator.ts`)

## Repo Reality Check (RED TEAM)

- What exists today:
  - `actions/ai-draft-response-analytics-actions.ts` — single export `getAiDraftResponseOutcomeStats` with `draft_send_time` CTE, 10s statement timeout, `AI_AUTO_SEND` email filter
  - `components/dashboard/analytics-view.tsx` — "campaigns" tab with AI Draft Response Outcomes card, fetched via useEffect on `activeWorkspace` + window
  - `prisma/schema.prisma` — Lead model has `appointmentBookedAt`, `ghlAppointmentId`, `calendlyInviteeUri`, `calendlyScheduledEventUri`, `appointmentStatus`, `appointmentProvider`
  - `lib/meeting-booking-provider.ts` — `isMeetingBooked()` canonical helper (checks provider evidence + status)
  - `lib/__tests__/analytics-windowing-stable.test.ts` — existing regression test using `node:test` + `node:assert/strict`
- What the plan assumes:
  - AIDraft.channel supports "linkedin" — CONFIRMED in `lib/ai-drafts.ts:517` (schema comment says `// sms | email` but linkedin values exist in production)
  - All booking evidence fields are on Lead model — CONFIRMED
  - Test framework is Node.js built-in `node:test` — CONFIRMED
- Verified touch points:
  - `resolveClientScope` import from `lib/workspace-access` — exists
  - `resolveWindow` helper function — exists (lines 18-29)
  - `Prisma.sql` / `Prisma.join` usage pattern — confirmed in existing query
  - `emptyCounts()` helper — exists (lines 34-36)

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Lead deduplication mismatch** — existing outcomes counts `distinct d.id` (drafts), but booking conversion must count `distinct l.id` (leads) to avoid inflating rates when a lead has multiple drafts across waves → enforced in 120a step 4
- **Two-layer windowing confusion** — UI date range and 30-day attribution window are independent filters; conflating them produces wrong attribution → explicit dual-filter design in 120a steps 2-3

### Missing or ambiguous requirements
- **BOOKED_NO_TIMESTAMP SQL conditions** — plan said "provider evidence exists" without SQL definition → now defined as: `(l."ghlAppointmentId" IS NOT NULL OR l."calendlyInviteeUri" IS NOT NULL OR l."calendlyScheduledEventUri" IS NOT NULL) AND l."appointmentBookedAt" IS NULL`
- **Booking rate denominator** — was "matured/eligible rows" without definition → now: `eligible = booked + not_booked`, rate = `booked / eligible`, display `—` when eligible = 0

### Repo mismatches (fix the plan)
- AIDraft.channel schema comment says `// sms | email` but linkedin values exist — no action needed (no schema changes in this phase), but noted for awareness

### Performance / timeouts
- New query joins Lead → AIDraft → Message → EmailCampaign with booking field comparisons — must stay within 10s statement timeout → reuse existing timeout pattern, count distinct leads (not drafts) to reduce work

### Testing / validation
- Existing windowing test guards against `d."updatedAt"` drift — new test must include the same anti-pattern assertion → added to 120a step 6

## Subphase Index
* a — Server action + SQL semantics + regression tests
* b — UI card + data fetch wiring
* c — Validation (tests/lint/build) + final QA notes

## Assumptions (Agent)

- `Lead.appointmentBookedAt` is reliably populated for all bookings via reconciliation cron and webhook handlers (confidence ~95%)
  - Mitigation: BOOKED_NO_TIMESTAMP bucket catches cases where provider evidence exists but timestamp is null
- 30-day attribution window is appropriate for sales booking cycles (confidence ~92%)
  - Mitigation: window is parameterized (`attributionWindowDays`) so it can be tuned without code changes
- Phase 111 disposition fixes are deployed to production (confidence ~90%)
  - Mitigation: if not deployed, disposition bucketing will be inaccurate but not broken; documented in Concurrent Phases table
