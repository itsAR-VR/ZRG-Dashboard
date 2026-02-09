# Phase 120 — Review

## Summary
- Added booking conversion analytics for AI drafts (channel + disposition breakdown).
- Added an Analytics UI card: **AI Draft Booking Conversion**.
- Added regression coverage and wired it into `npm test`.
- Verification: `npm test`, `npm run lint`, `npm run build` all pass (warnings only).
- Booked counts exclude canceled appointments (`appointmentStatus="canceled"` or `appointmentCanceledAt` set).

## What Shipped
- Server action + types:
  - `actions/ai-draft-response-analytics-actions.ts` (`getAiDraftBookingConversionStats`, `AiDraftBookingConversionStats`)
- Analytics UI:
  - `components/dashboard/analytics-view.tsx` (new fetch + card)
- Tests:
  - `lib/__tests__/ai-draft-booking-conversion-windowing.test.ts`
  - `scripts/test-orchestrator.ts` (includes the new test file)

## Verification

### Commands
- `npm test` — pass (2026-02-09)
- `npm run lint` — pass (warnings only) (2026-02-09)
- `npm run build` — pass (warnings only) (2026-02-09)
- `npm run db:push` — skip (no Prisma schema changes in this phase)

### Notes
- Working tree contained unrelated changes while verifying:
  - `lib/auto-send/revision-agent.ts` modified (default model changed).
  - Untracked planning folder: `docs/planning/phase-121/`
  - Untracked file: `image (12).png`
  These are not part of Phase 120’s intended scope.

## Success Criteria → Evidence

1. Analytics page shows a new card under Campaigns: **AI Draft Booking Conversion**.
   - Evidence: `components/dashboard/analytics-view.tsx`
   - Status: met

2. Card shows 9 buckets (3 channels x 3 dispositions) with booked/not-booked/pending/no-timestamp and eligible + booking rate.
   - Evidence: `components/dashboard/analytics-view.tsx`, `actions/ai-draft-response-analytics-actions.ts`
   - Status: met

3. Email rows are filtered to `EmailCampaign.responseMode = AI_AUTO_SEND`.
   - Evidence: `actions/ai-draft-response-analytics-actions.ts` (SQL filter on `ec."responseMode"`)
   - Status: met

4. Query anchors the UI window to derived send-time (`min(Message.sentAt)` per draft) and dedupes by lead.
   - Evidence: `actions/ai-draft-response-analytics-actions.ts` (`draft_send_time` + `lead_bucket` + `count(distinct lead_id)`)
   - Status: met

5. `npm test`, `npm run lint`, `npm run build` all pass.
   - Evidence: command runs recorded above
   - Status: met

## Plan Adherence
- Planned vs implemented deltas (if any):
  - Added `scripts/test-orchestrator.ts` entry for the new regression test so `npm test` executes it → improves enforcement; no behavior change.

## Risks / Rollback
- Risk: Metrics are only as accurate as booking timestamps (`Lead.appointmentBookedAt`) and cancellation state (`appointmentStatus` / `appointmentCanceledAt`).
- Rollback: revert the Phase 120 code changes (no migrations).

## Follow-ups
- None required for Phase 120.
