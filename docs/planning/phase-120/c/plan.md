# Phase 120c — Validation + QA

## Focus
Verify the new analytics metrics are stable, performant, and shippable.

## Inputs
- Phase 120a outputs (server action + tests)
- Phase 120b outputs (UI card)
- Existing repo quality checklist: `AGENTS.md` (lint/build/test expectations)

## Work
1. Run local checks:
   - `npm test` — must pass including new `lib/__tests__/ai-draft-booking-conversion-windowing.test.ts`
   - `npm run lint` — no errors
   - `npm run build` — succeeds (verifies type-safety of new action + UI integration)
2. Sanity-check analytics behavior in dev:
   - Switching date presets updates both outcomes + booking conversion cards.
   - Empty state behaves correctly when no tracked outcomes in the selected window.
   - Card description shows correct attribution window (30d) and pending buffer (7d).
3. Validate semantics quickly against known data invariants:
   - Pending buffer excludes most recent 7 days from booking rate denominator.
   - `No Timestamp` is excluded from booking rate denominator.
   - Booking rate = `booked / (booked + notBooked)`, displays `—` when denominator is 0.
   - No `AIDraft.updatedAt` usage in booking conversion windowing.
   - **(RED TEAM)** Deduplication: query uses `count(distinct l.id)`, NOT `count(distinct d.id)`.
4. Performance validation **(RED TEAM)**:
   - Verify the booking conversion query completes within the 10s statement timeout.
   - If slow: check that indexes on `Lead.clientId`, `AIDraft.responseDisposition`, `Lead.appointmentBookedAt` are being used (`EXPLAIN ANALYZE` in Prisma Studio or psql).
   - Fallback: reduce join scope or add a covering index on `Lead(clientId, appointmentBookedAt)` if needed.
   - Document any mitigations needed before production.

## Output
- Quality gates passed (warnings only):
  - `npm test` — pass
  - `npm run lint` — pass (warnings)
  - `npm run build` — pass (warnings)

## Handoff
Phase 120 is ready for commit/review. If you want to ship separately from other working tree changes, stage only the Phase 120 files.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Ran full local test/lint/build to verify the new server action + UI integration compiles and passes CI-equivalent checks.
- Commands run:
  - `npm test` — pass
  - `npm run lint` — pass (0 errors, warnings pre-existing)
  - `npm run build` — pass
- Blockers:
  - None.
- Next concrete steps:
  - Write `docs/planning/phase-120/review.md` and update root plan success criteria.
