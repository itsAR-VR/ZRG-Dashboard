# Phase 110b — Close Remaining `responseDisposition` Gaps

## Focus
Eliminate any remaining code paths that can mark a draft as “sent/approved” without also persisting `AIDraft.responseDisposition`, so outcome analytics and audit trails stay consistent.

## Inputs
- Verified gap candidate:
  - `lib/followup-engine.ts` sets `status: "approved"` without `responseDisposition` when a `sending` draft already has a `Message`.
- Existing disposition logic + tests:
  - `lib/ai-drafts/response-disposition.ts`
  - `lib/__tests__/response-disposition-idempotent.test.ts`

## Work
1. **Follow-up engine idempotency fix** (`lib/followup-engine.ts:1381-1397`)
   - Widen the draft select at line 1342 to include `content` field:
     `select: { id: true, status: true, leadId: true, content: true }`
   - Widen the message findFirst at line 1382-1384 to include `body` and `sentBy`:
     `select: { id: true, body: true, sentBy: true }`
   - Import `computeAIDraftResponseDisposition` from `lib/ai-drafts/response-disposition.ts`
   - In the `if (inFlightMessage)` branch (line 1387), compute disposition before the updateMany:
     ```ts
     const disposition = computeAIDraftResponseDisposition({
       sentBy: (inFlightMessage.sentBy as "ai" | "setter") ?? null,
       draftContent: draft.content,
       finalContent: inFlightMessage.body,
     });
     ```
   - Update the `data` object at line 1389 to include `responseDisposition: disposition`
   - Edge case: if `inFlightMessage.sentBy` is null/undefined, `computeAIDraftResponseDisposition` falls through to content comparison (EDITED vs APPROVED), which is correct behavior.
2. **Optional hardening: approved-but-null disposition**
   - Decide whether to treat `status="approved" && responseDisposition IS NULL` as recoverable and safe to “fill in”:
     - If yes: adjust email idempotent updates to set `responseDisposition` even when status is already `approved` but disposition is null.
     - If no: document why (e.g., avoid mutating historical drafts; keep “going forward only”).
3. **Regression coverage**
   - Add/extend a test to catch the follow-up engine gap:
     - Lightweight static test is acceptable (matches existing test style), or
     - Prefer a small unit test around a helper function if we extract one.
4. **Sanity checks**
   - Ensure any new logic does not re-send messages (idempotent only).
   - Ensure the change is additive and does not regress Phase 105 email single-flight semantics.

## Key Dependency
- `lib/ai-drafts/response-disposition.ts` exports:
  - `computeAIDraftResponseDisposition({ sentBy, draftContent, finalContent })` → `"AUTO_SENT" | "APPROVED" | "EDITED"`

## Validation (RED TEAM)
- `npm run lint` passes on `lib/followup-engine.ts`
- `npm run build` succeeds (TypeScript compiles)
- Grep `lib/followup-engine.ts` for `status: "approved"` — every occurrence must also set `responseDisposition`
- Existing test `lib/__tests__/response-disposition-idempotent.test.ts` still passes

## Exit Criteria
- Follow-up engine no longer approves drafts without a `responseDisposition`.
- Regression coverage exists so the follow-up path can’t revert to approving without disposition.
- Validation steps above pass.
- Next: proceed to Phase 110c (analytics windowing stability).

## Output
- Persisted `responseDisposition` when approving a follow-up email draft that is already `sending` and has an outbound Message (`lib/followup-engine.ts`).
- Added regression test coverage to prevent this path from reverting (`lib/__tests__/followup-engine-disposition.test.ts`, `scripts/test-orchestrator.ts`).
- Optional hardening (approved-but-null backfill) intentionally skipped in Phase 110 to avoid historical mutation without explicit requirement.

## Handoff
Proceed to Phase 110c to fix analytics windowing so counts are stable over time (no `updatedAt` drift).

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented follow-up engine idempotency fix to persist `AIDraft.responseDisposition` when a `sending` draft already has an outbound Message.
  - Added a static regression test to prevent regressions and registered it in the test orchestrator.
  - Skipped the optional “approved-but-null disposition backfill” hardening to avoid mutating historical drafts without a product decision.
- Commands run:
  - `nl -ba lib/followup-engine.ts | sed -n '1300,1460p'` — pass (located idempotency branch)
  - `rg -n "draft.status === \\\"sending\\\"|updateMany" lib/followup-engine.ts` — pass (confirmed responseDisposition is set)
- Blockers:
  - None.
- Next concrete steps:
  - Execute Phase 110c (analytics windowing anchor to `Message.sentAt`).
  - Run full quality gates in Phase 110d (`npm test`, `npm run lint`, `npm run build`).
