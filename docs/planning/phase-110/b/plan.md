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
1. **Follow-up engine idempotency fix**
   - Update the “draft is `sending` and a message already exists” branch to also persist `responseDisposition`.
   - Compute disposition from **what was actually sent**:
     - `sentBy` from the outbound message (`ai|setter` fallback null).
     - `finalContent` from the message body (or other persisted send body).
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

## Output
- Follow-up engine no longer approves drafts without a `responseDisposition`.
- Tests fail if the follow-up path reverts to approving without disposition.

## Handoff
Proceed to Phase 110c to fix analytics windowing so counts are stable over time (no `updatedAt` drift).

