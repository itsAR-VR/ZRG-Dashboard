# Phase 110 — Review

Date: 2026-02-05

## Summary
- Completed full Monday reconciliation matrix (46 items) and posted minimal evidence updates to a focused subset of open items.
- Re-checked two “should already be fixed” items and updated the matrix + Monday notes accordingly:
  - `11196938130` — shipped via Phase 109 (manual sentiment draft generation + compose UI refetch)
  - `11195846714` — shipped via Phase 106r (reactivation prereq surfacing; prevent silent failures)
- Fixed two correctness gaps:
  - Follow-up engine now persists `AIDraft.responseDisposition` in the idempotent “sending + message exists” branch.
  - AI draft outcome analytics windowing now anchors to derived send time (`min(Message.sentAt)`), not `AIDraft.updatedAt`.
- Improved disposition correctness for idempotent retries: disposition is now derived from the stored sent message bodies when available (email + SMS).
- Added static regression tests for the correctness fixes and registered them in the test orchestrator.

## Evidence

### Monday Board Reconciliation
- Matrix: `docs/planning/phase-110/monday-reconciliation.md`
- Phase notes: `docs/planning/phase-110/e/plan.md` (reclassified `11196938130`, `11195846714`)
- Monday item updates posted (no Status changes):
  - `11174440376`, `11183404766`, `11185162432`, `11188016134` — "Shipped in repo (Phase 106). Pending production verification."
  - `11177342525` — "Shipped in repo (Phase 101). Pending production verification."
  - `11195846714` — Phase 106r evidence (prereq surfacing; prevent silent failures). Pending production verification.
  - `11196938130` — Phase 109 evidence (manual sentiment draft generation + UI refetch). Pending production verification.

### Code Changes
- `lib/followup-engine.ts` — persist `responseDisposition` when approving a draft from the idempotent in-flight branch.
- `actions/ai-draft-response-analytics-actions.ts` — replace `AIDraft.updatedAt` window filter with derived send-time anchor via CTE.
- Idempotent retry disposition accuracy:
  - `actions/email-actions.ts` and `lib/email-send.ts` now prefer stored message body when computing `responseDisposition` in idempotent “message already exists” branches.
  - `actions/message-actions.ts` now derives disposition from already-sent SMS part bodies when all parts were previously sent.
- Safety/metrics:
  - `lib/ai-drafts/stale-sending-recovery.ts` now only increments `recovered` when the DB update succeeds (count > 0).
- Tests:
  - `lib/__tests__/response-disposition-idempotent.test.ts` (updated expectations)
  - `lib/__tests__/followup-engine-disposition.test.ts`
  - `lib/__tests__/analytics-windowing-stable.test.ts`
  - Orchestrator: `scripts/test-orchestrator.ts`

## Quality Gates

### `npm test`
- Pass (176 tests, 0 failures).

### `npm run lint`
- Pass with warnings (0 errors, 22 warnings).
- Notable warning: `baseline-browser-mapping` package data is out of date (advisory).

### `npm run build`
- Pass.
- Notable warnings:
  - `baseline-browser-mapping` out of date (advisory).
  - Next.js warning: middleware file convention deprecated (“middleware” → “proxy”).
  - CSS optimizer warnings (3) for unexpected tokens in generated CSS.

### Prisma / DB
- No Prisma schema changes in Phase 110 → `npm run db:push` not required.
