# Phase 106s — Fix: Missing ResponseDisposition in Idempotent Paths

## Focus
Ensure successful idempotent send paths persist `AIDraft.responseDisposition` so analytics do not show null outcomes.

## Inputs
- Email send (server action): `actions/email-actions.ts`
- Email send (system/CLI): `lib/email-send.ts`
- SMS draft send (system): `actions/message-actions.ts`
- Disposition helper: `lib/ai-drafts/response-disposition.ts`

## Work
1. When a draft already has a message, compute and persist `responseDisposition` alongside `status="approved"`.
2. For SMS drafts, always persist `responseDisposition` even when there are no pending parts.
3. Add tests/assertions to prevent regression (static or unit).

## Output
- Email idempotent paths now compute and persist `responseDisposition` (`actions/email-actions.ts`, `lib/email-send.ts`).
- SMS draft approvals always persist `responseDisposition` even when no parts were pending (`actions/message-actions.ts`).
- Added regression test for idempotent disposition paths and registered it (`lib/__tests__/response-disposition-idempotent.test.ts`, `scripts/test-orchestrator.ts`).
- Coordination: Phase 101/105/107 previously modified these send paths; changes are additive and re-read before edits.

## Handoff
Proceed to Phase 106t (send_outcome_unknown recovery + stale sending backstop).

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added responseDisposition persistence to email idempotent paths and SMS approvals.
  - Added a regression test and registered it in the orchestrator.
- Commands run:
  - `nl -ba actions/message-actions.ts | sed -n '1120,1260p'` — review SMS send flow (pass)
  - `rg -n "existingMessage" actions/email-actions.ts lib/email-send.ts` — locate idempotent paths (pass)
- Blockers:
  - None.
- Next concrete steps:
  - Implement send_outcome_unknown recovery + stale sending backstop (Phase 106t).
