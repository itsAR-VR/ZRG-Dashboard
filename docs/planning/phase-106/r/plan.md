# Phase 106r — Bug 11195846714: Reactivation SMS/LinkedIn Not Sending

## Focus
Ensure reactivation campaigns that start follow-up sequences surface missing SMS/LinkedIn prerequisites and do not silently fail when required integrations are missing.

## Inputs
- Reactivation engine: `lib/reactivation-engine.ts`
- Follow-up sequence model: `prisma/schema.prisma`
- Follow-up send logic (channel prerequisites): `lib/followup-engine.ts`
- Reactivations UI: `components/dashboard/reactivations-view.tsx`

## Work
1. Add a helper to evaluate missing prerequisites for follow-up sequence channels (SMS requires phone + GHL creds; LinkedIn requires LinkedIn URL + Unipile account).
2. Wire the helper into `processReactivationSendsDue` so enrollments move to `needs_review` with a clear reason when prerequisites are missing.
3. Ensure the enrollment send path logs and persists the reason; do not start the follow-up sequence when prerequisites fail.
4. Add unit tests for prerequisite evaluation and enrollment status transitions.

## Output
- Added reactivation prerequisite helper to surface missing SMS/LinkedIn requirements (`lib/reactivation-sequence-prereqs.ts`).
- Reactivation send path now marks enrollments `needs_review` with clear reasons when follow-up prerequisites are missing (`lib/reactivation-engine.ts`).
- Added unit tests for prerequisite evaluation and registered in test orchestrator (`lib/__tests__/reactivation-sequence-prereqs.test.ts`, `scripts/test-orchestrator.ts`).
- Coordination: Phase 107 and Phase 105 previously touched `lib/reactivation-engine.ts`/`scripts/test-orchestrator.ts`; changes here are additive and re-read before edit.

## Handoff
Proceed to Phase 106s (responseDisposition idempotent gaps) and update email/SMS send paths.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added a reactivation prerequisite helper and wired it into the reactivation send path.
  - Marked enrollments `needs_review` when SMS/LinkedIn prerequisites are missing.
  - Added tests and registered them in the test orchestrator.
- Commands run:
  - `rg -n "reactivationEnrollment.findMany" lib/reactivation-engine.ts` — locate send path (pass)
  - `nl -ba lib/reactivation-engine.ts | sed -n '720,1260p'` — review send flow (pass)
- Blockers:
  - None.
- Next concrete steps:
  - Fix idempotent responseDisposition gaps (Phase 106s).
