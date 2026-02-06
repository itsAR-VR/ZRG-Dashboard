# Phase 111 — Fix Idempotent responseDisposition Accuracy

## Purpose
Fix email and SMS idempotent send paths to compute `responseDisposition` from the **content that was actually sent** (`existingMessage.body`) instead of the **caller's current edit** (`messageContent`), and harden `recoverStaleSendingDrafts` against concurrent cron invocations.

## Context
Phases 101/105/106 introduced `responseDisposition` (AUTO_SENT / APPROVED / EDITED) and idempotent send logic. The stale-sending recovery (`lib/ai-drafts/stale-sending-recovery.ts:45`) and Phase 110b's follow-up engine fix both correctly use the stored message body for disposition. However, the main email/SMS paths still use the caller's current edit — creating an inconsistency that produces inaccurate dispositions when retries carry different content than what was originally sent.

The existing regression test (`lib/__tests__/response-disposition-idempotent.test.ts`) actively enforces the current (incorrect) behavior and must be flipped.

### Affected Code Sites (4 email + 1 SMS + 1 stale-recovery)

| # | File | Lines | Current behavior | Fix |
|---|------|-------|-----------------|-----|
| 1 | `actions/email-actions.ts` | 88-91 | `finalContent: messageContent` | `finalContent: existingMessage.body` |
| 2 | `actions/email-actions.ts` | 156-159 | `finalContent: messageContent` | `finalContent: afterClaimMessage.body` |
| 3 | `lib/email-send.ts` | 687-690 | `finalContent: messageContent` | `finalContent: existingMessage.body` |
| 4 | `lib/email-send.ts` | 755-758 | `finalContent: messageContent` | `finalContent: afterClaimMessage.body` |
| 5 | `actions/message-actions.ts` | 1190-1232 | `finalContent` (caller's edit) | Derive from concatenated sent bodies when all parts sent |
| 6 | `lib/ai-drafts/stale-sending-recovery.ts` | 50-53 | Unconditional `recovered++` | Count based on `updateMany` result |

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| 110b | Planned | Follow-up engine disposition (same helper) | Independent — 110b uses `inFlightMessage.body` already |
| 110 | In progress | Uncommitted changes exist (unrelated files) | No code overlap with Phase 111 touchpoints |
| 106 | Shipped | Introduced current disposition logic + tests | Phase 111 intentionally reverses the Phase 106 design decision; must update 106's tests |

## Objectives
* [x] Fix 4 email idempotent disposition sites to use stored message body
* [x] Fix SMS idempotent disposition to derive from concatenated sent parts
* [x] Harden stale-recovery against concurrent cron invocations
* [x] Update regression tests to enforce body-based disposition
* [x] Lint + build + test pass

## Constraints
- No schema changes required
- No fallback needed for email idempotent paths: `Message.body` is non-null in the schema and selected in these branches (if that changes, add a defensive fallback)
- Partial SMS sends (some parts pending) keep using caller's `finalContent`
- Test changes and code changes must be committed atomically

## Success Criteria
1. All 4 email idempotent paths pass `existingMessage.body` / `afterClaimMessage.body` as `finalContent`
2. SMS path derives disposition from concatenated sent bodies when all parts are already sent
3. `recoverStaleSendingDrafts` counts recovered based on actual DB update count
4. `npm run lint` passes
5. `npm run build` succeeds
6. `node --import tsx --test lib/__tests__/response-disposition-idempotent.test.ts` passes with flipped assertions
7. `node --import tsx --test lib/__tests__/stale-sending-recovery.test.ts` passes

## Success Criteria Status (Review)
- [x] (1) Email idempotent paths compute disposition from stored sent body (`actions/email-actions.ts`, `lib/email-send.ts`)
- [x] (2) SMS idempotent path derives disposition from concatenated sent bodies when all parts already sent (`actions/message-actions.ts`)
- [x] (3) Stale-sending recovery counts `recovered` based on actual `updateMany` results (`lib/ai-drafts/stale-sending-recovery.ts`)
- [x] (4) `npm run lint` passes (warnings only)
- [x] (5) `npm run build` succeeds
- [x] (6) `node --import tsx --test lib/__tests__/response-disposition-idempotent.test.ts` passes
- [x] (7) `node --import tsx --test lib/__tests__/stale-sending-recovery.test.ts` passes

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Email `Message.body` unexpectedly empty** — disposition may be inaccurate (APPROVED vs EDITED). Likelihood: very low; schema is non-null and these branches select `body`. Mitigation: if we ever allow null/empty bodies, add a defensive fallback to `messageContent`.
- **SMS `join("\n")` doesn't reconstruct original draft format** — multi-part drafts stored as JSON/XML will be classified as EDITED after join. This is acceptable: multi-part sends that went through are correctly "different" from the raw draft format. Mitigation: document this behavior.
- **Test regression breaks CI for other branches** — flipped assertions are incompatible with old code. Mitigation: commit test + code changes atomically.

### Repo mismatches
- Email `existingMessage`/`afterClaimMessage` queries already select `body` — no query changes needed
- SMS query at `message-actions.ts:1191` does NOT select `body` — must be widened (subphase b)

### Performance / timeouts
- No new queries; email paths already fetch `body`
- SMS path adds `body` to existing `findMany` — negligible overhead
- Stale-recovery change is logic-only

### Security / permissions
- No new endpoints or auth changes
- No PII logging changes

## Assumptions (Agent, >= 90% confidence)
- `existingMessage.body` is always non-null for email Messages (confidence ~95%). Mitigation: if that assumption changes, add a defensive fallback to `messageContent`.
- `aiDraftPartIndex` ordering is stable for SMS reconstruction (confidence ~95%). Mitigation: explicit sort before concatenation.
- `join("\n")` separator for SMS reconstruction is acceptable for disposition comparison (confidence ~90%). Mitigation: EDITED classification for multi-part drafts is correct behavior.

## Subphase Index
* a — Fix email idempotent disposition (4 code sites in 2 files)
* b — Fix SMS idempotent disposition (1 code site, query widening)
* c — Harden stale-recovery concurrency
* d — Test updates + validation

## Phase Summary
- Shipped:
  - Body-based disposition for email idempotent paths (`actions/email-actions.ts`, `lib/email-send.ts`).
  - Sent-body-based disposition for SMS idempotent paths (`actions/message-actions.ts`).
  - Stale-sending recovery `recovered` count hardened against concurrent invocations (`lib/ai-drafts/stale-sending-recovery.ts`).
  - Regression test flipped to enforce the above (`lib/__tests__/response-disposition-idempotent.test.ts`).
- Verified:
  - `npm run lint`: pass (warnings only)
  - `npm run build`: pass
  - `npm test`: pass
  - `node --import tsx --test lib/__tests__/response-disposition-idempotent.test.ts`: pass
  - `node --import tsx --test lib/__tests__/stale-sending-recovery.test.ts`: pass
- Notes:
  - Review artifact: `docs/planning/phase-111/review.md`
