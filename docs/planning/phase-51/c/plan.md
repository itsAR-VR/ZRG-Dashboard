# Phase 51c — Email Send Pipeline Unification (Shared Internal Kernel)

## Focus

Eliminate drift risk between the "manual send" and "AI draft approval send" email reply paths by routing both through a single internal implementation that handles provider selection, safety gates, sending, and DB persistence consistently.

## Inputs

- Group B findings in `docs/audits/structural-duplication-2026-01-22.md`
- Phase 51a invariants for email send safety gates
- Existing send entrypoints: `actions/email-actions.ts:sendEmailReply`, `actions/email-actions.ts:sendEmailReplyForLead`
- Provider clients:
  - `lib/emailbison-api.ts:sendEmailBisonReply`
  - `lib/smartlead-api.ts:sendSmartLeadReplyToThread`
  - `lib/instantly-api.ts:sendInstantlyReply`
- CC resolution helper: `resolveOutboundCc()` (Phase 50)

## Pre-Flight (RED TEAM)

- [x] Confirmed working tree is not clean (Phase 48–50 deltas present); proceeded with semantic refactor (no public signature changes).
- [x] Verified Phase 50 CC semantics (`resolveOutboundCc()` + `sanitizeCcList`) are present and preserved.
- [x] Verified `lib/email-participants.ts:sanitizeCcList` is used via `resolveOutboundCc()` for both send paths.

## Work

1. **Identify the true shared spine**:
   - Both `sendEmailReply` and `sendEmailReplyForLead` follow this sequence:
     1. Load lead + client + provider configuration
     2. Find latest inbound email thread handle (provider-specific `emailBisonReplyId` prefix rules)
     3. Resolve CC (custom override vs inherited from inbound)
     4. EmailGuard validation + opt-out/blacklist safety checks
     5. Send via provider API (EmailBison, SmartLead, or Instantly)
     6. Persist outbound `Message` row (including CC, participant metadata)
     7. Post-send hooks: bump rollups, auto-start follow-ups, record booking progress, background sync

2. **Extract a shared internal implementation**:
   - Create a private internal helper: `sendEmailReplyInternal(params: InternalSendParams): Promise<SendEmailResult>`.
   - Move all shared logic into this helper.
   - Keep the exported `sendEmailReply` and `sendEmailReplyForLead` signatures stable.
   - `sendEmailReply` loads the draft, validates it, then calls internal helper with `{ aiDraftId }`.
   - `sendEmailReplyForLead` validates inputs, then calls internal helper with `{ aiDraftId: undefined }`.

3. **Normalize safety + correctness**:
   - Ensure the following are applied consistently in the internal helper:
     - CC resolution via `resolveOutboundCc()` with validation errors returned immediately.
     - Opt-out check: `isOptOutText(latestInboundText)` → blacklist lead + reject all pending drafts.
     - EmailGuard validation: `validateWithEmailGuard(emailGuardTarget)` → blacklist on failure.
     - Provider-specific retry logic (EmailBison invalid sender → pick fallback sender).
   - Ensure idempotency:
     - `sendEmailReply` already checks for existing message with `aiDraftId` before sending.
     - Keep this check in the draft-approval wrapper, not in the internal helper.

4. **Preserve provider-specific logic**:
   - Keep all provider branching (EmailBison, SmartLead, Instantly) inside the internal helper.
   - Keep thread handle decoding per provider (`decodeSmartLeadReplyHandle`, `decodeInstantlyReplyHandle`).
   - Keep EmailBison HTML conversion (`emailBisonHtmlFromPlainText`).

5. **Add targeted regression tests**:
   - Create `actions/__tests__/email-actions.test.ts`:
     - Test CC override vs passthrough behavior for each provider.
     - Test manual send vs draft-approval send produce equivalent Message rows.
     - Test opt-out detection leads to blacklist + draft rejection.
     - Test EmailBison invalid sender retry logic.

## Validation (RED TEAM)

- `npm run lint` — no errors.
- `npm run build` — no type errors.
- `npm run test` — all tests pass.
- Manual smoke test: approve AI draft email → verify Message row has correct CC, `sentBy`, and `aiDraftId`.
- Manual smoke test: send manual email reply → verify Message row has correct CC, `sentBy` (should be `null` or user-specified), and no `aiDraftId`.
- Verify both paths use `resolveOutboundCc()` identically.

## Output

- Implemented a shared internal send pipeline in `actions/email-actions.ts` (`sendEmailReplyInternal(...)`) and routed:
  - `sendEmailReply(...)` (draft approval) → internal helper + draft status update
  - `sendEmailReplyForLead(...)` (manual) → internal helper
- Preserved Phase 50 CC behavior: override vs inherited CC, invalid CC handling, and inbound-thread invalid CC sanitization warnings.
- Unified post-send hooks to reduce drift:
  - `bumpLeadMessageRollup(...)`, `revalidatePath("/")`, `autoStartNoResponseSequenceOnOutbound(...)`
  - `recordOutboundForBookingProgress(...)` is now applied consistently (manual + draft sends)
  - EmailBison background thread sync remains EmailBison-only.
- Deferred: full regression tests for email send equivalence (to Phase 51e).

## Handoff

Subphase d standardizes the LLM JSON-schema call pattern via a shared prompt runner and migrates the highest-value call sites.

## Coordination Notes

- This change intentionally keeps the exported action signatures stable while reducing drift-prone duplication inside `actions/email-actions.ts`.

## Assumptions / Open Questions (RED TEAM)

- Assumption: The only difference between `sendEmailReply` and `sendEmailReplyForLead` is draft handling (idempotency check, status update) (confidence ~90%).
  - Mitigation check: diff the two functions before refactoring.
- Assumption: Provider-specific logic can remain inline in the internal helper without further extraction (confidence ~85%).
  - Mitigation check: if provider logic diverges significantly, consider per-provider internal helpers.
- Open question: Should the internal helper also handle booking progress recording?
  - Current default: Yes — keep all post-send hooks in one place for consistency.
