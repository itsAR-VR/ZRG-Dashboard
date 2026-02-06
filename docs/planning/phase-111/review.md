# Phase 111 — Review

## Summary
- Shipped body-based `responseDisposition` computation for email and SMS idempotent send paths.
- Hardened stale-sending recovery metrics by incrementing `recovered` only when an update actually occurred.
- Verification passed: `npm run lint` (warnings only), `npm run build`, and targeted tests via `node --import tsx --test`.

## What Shipped
- `actions/email-actions.ts` — idempotent branches compute disposition from `existingMessage.body` and `afterClaimMessage.body`.
- `lib/email-send.ts` — same fix for the system email sender idempotent branches.
- `actions/message-actions.ts` — derive `dispositionContent` from concatenated sent message bodies (ordered by `aiDraftPartIndex`) when all parts were already sent, and use it for disposition.
- `lib/ai-drafts/stale-sending-recovery.ts` — only increment `recovered` when `updateMany()` updated at least one row.
- `lib/__tests__/response-disposition-idempotent.test.ts` — flipped assertions to enforce body-based disposition; added SMS `dispositionContent` assertion.

## Verification

### Commands
- `npm run lint` — pass (warnings only) (2026-02-05 EST)
- `npm run build` — pass (2026-02-05 EST)
- `npm test` — pass (2026-02-05 EST)
- `node --import tsx --test lib/__tests__/response-disposition-idempotent.test.ts` — pass (2026-02-05 EST)
- `node --import tsx --test lib/__tests__/stale-sending-recovery.test.ts` — pass (2026-02-05 EST)

### Notes
- Working tree contains unrelated, in-progress changes from Phase 110; Phase 111 touched distinct files and validated lint/build against the combined state.

## Success Criteria → Evidence

1. All 4 email idempotent paths pass `existingMessage.body` / `afterClaimMessage.body` as `finalContent`.
   - Evidence: `actions/email-actions.ts`, `lib/email-send.ts`
   - Status: met

2. SMS path derives disposition from concatenated sent bodies when all parts are already sent.
   - Evidence: `actions/message-actions.ts` (`dispositionContent` join + `finalContent: dispositionContent`)
   - Status: met

3. `recoverStaleSendingDrafts` counts recovered based on actual DB update count.
   - Evidence: `lib/ai-drafts/stale-sending-recovery.ts` (`const updated = await ...; if (updated.count > 0) ...`)
   - Status: met

4. `npm run lint` passes.
   - Evidence: `npm run lint` (pass; warnings only)
   - Status: met

5. `npm run build` succeeds.
   - Evidence: `npm run build` (pass)
   - Status: met

6. `node --import tsx --test lib/__tests__/response-disposition-idempotent.test.ts` passes with flipped assertions.
   - Evidence: command pass
   - Status: met

7. `node --import tsx --test lib/__tests__/stale-sending-recovery.test.ts` passes.
   - Evidence: command pass
   - Status: met

## Plan Adherence
- Planned vs implemented deltas:
  - Validation commands in this repo require `node --import tsx` for `.ts` tests (the original plan used `node --test` without a loader).

## Risks / Rollback
- Risk: SMS `sentBodies.join(\"\\n\")` may not exactly match the original `finalContent` formatting.
  - Mitigation: only used for idempotent retries when all parts are already sent; falls back to `finalContent` if no bodies are available.

## Follow-ups
- If `missingMessages` becomes a key metric under concurrent crons, consider counting it only when the draft status update succeeds (similar to `recovered`).
