# Phase 106t — Fix: send_outcome_unknown Recovery + Stale "sending" Backstop

## Focus
Prevent drafts from being stuck in `sending` when the email provider outcome is uncertain by marking them approved and adding a cron backstop for stale drafts.

## Inputs
- Email send (server action): `actions/email-actions.ts`
- Email send (system/CLI): `lib/email-send.ts`
- Background jobs cron: `app/api/cron/background-jobs/route.ts`
- Draft schema: `prisma/schema.prisma`

## Work
1. On `send_outcome_unknown`, mark the draft `approved` and persist `responseDisposition` (do not re-send).
2. Add a stale-draft recovery helper to mark `sending` drafts as approved after a timeout and reconcile disposition if a message exists.
3. Wire the recovery helper into the background-jobs cron path.
4. Add tests/assertions to prevent regression.

## Output
- `send_outcome_unknown` now marks drafts approved with `responseDisposition` (email server action + system send).
- Added stale draft recovery helper and wired it into background-jobs cron (`lib/ai-drafts/stale-sending-recovery.ts`, `app/api/cron/background-jobs/route.ts`).
- Added regression tests for unknown-outcome handling and cron wiring; registered in test orchestrator (`lib/__tests__/send-outcome-unknown-recovery.test.ts`, `lib/__tests__/stale-sending-recovery.test.ts`, `scripts/test-orchestrator.ts`).
- Coordination: Phase 105/107 touched email send paths and background jobs; changes are additive and re-read before edits.

## Handoff
Proceed to Phase 106u (admin-auth helper/test gap from Phase 99).

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added draft recovery on `send_outcome_unknown` and introduced a stale-sending backstop in cron.
  - Added regression tests and registered them in the test orchestrator.
- Commands run:
  - `rg -n "send_outcome_unknown" actions/email-actions.ts lib/email-send.ts` — locate error handling blocks (pass)
  - `sed -n '1,220p' app/api/cron/background-jobs/route.ts` — review cron path (pass)
- Blockers:
  - None.
- Next concrete steps:
  - Implement Phase 106u admin-auth helper/test gap fixes.
