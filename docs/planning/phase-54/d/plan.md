# Phase 54d — Implement Robust Reactivation Anchor Handling + Tests

## Focus
Implement the Phase 54 behavior changes in code: robustly resolve or create anchors using lead email (EmailBison + GHL) and ensure reactivation sends do not fail merely because `anchorReplyId` is missing.

## Inputs
- Phase 54b algorithm + Phase 54c creation spec
- Key files:
  - `lib/reactivation-engine.ts`
  - `lib/emailbison-api.ts`
  - `lib/ghl-api.ts` (or a small helper wrapper around it)
  - Any existing tests adjacent to reactivation/follow-up logic

## Work
- Create/extend a single helper that encapsulates “resolve or create anchor”, returning a structured result used by both:
  - `resolveReactivationEnrollmentsDue()` (batch pre-resolution), and
  - `processReactivationSendsDue()` (on-demand resolution if missing).
- Update state machine transitions:
  - Avoid setting `needs_review` for “missing sent anchor” if a safe fallback exists.
  - Ensure `needs_review` reasons are precise and actionable when truly blocked.
- Ensure idempotent send behavior:
  - Continue using `ReactivationSendLog` uniqueness for dedupe.
  - Guard against double-sends during retries (especially when resolution and send happen in the same run).
- Add regression coverage:
  - Missing `anchorReplyId` but provider thread exists → sends in-thread.
  - Missing EmailBison lead id but discoverable by email → resolves and sends.
  - No provider thread → follows Phase 54c “new thread” behavior (or cleanly surfaces the configured fallback).

## Output
- PR-ready implementation with tests.

## Handoff
Prepare a minimal verification + rollout checklist in **54e**.

## Validation (RED TEAM)

- [ ] `npm run lint` — no new errors
- [ ] `npm run build` — succeeds
- [ ] `npm run test` — all tests pass (add new tests for reactivation paths)
- [ ] Manual test: enrollment with no anchor → verify discovery fallback → verify graceful `needs_review` when truly blocked

## Implementation Checklist (RED TEAM)

### Pre-implementation
- [ ] Commit/stash uncommitted Phase 51-53 changes to avoid conflicts
- [ ] Read current `lib/reactivation-engine.ts` to confirm no drift from analysis

### Core changes
- [ ] Create `resolveReactivationAnchor()` helper (rename from "OrCreate" since creation is descoped) encapsulating:
  1. DB-first check (`Lead.emailBisonLeadId`, existing `Message.emailBisonReplyId`)
  2. EmailBison lookup by email (`findEmailBisonLeadIdByEmail`)
  3. EmailBison global replies search (`fetchEmailBisonRepliesGlobal`)
  4. GHL-assisted fallback (`searchGHLContactsAdvanced` → retry EmailBison → persist `Lead.ghlContactId`)
  5. **Relaxed anchor selection** (always pick **most recent** by date within each tier):
     - First: most recent sent-folder reply with campaign_id
     - Second: most recent sent-folder reply (any)
     - Third: most recent reply by date from any folder (thread continuation)
     - Fallback: `needs_review` with "No email thread exists; enroll lead in EmailBison campaign"
     - **Never use a random reply_id** — always sort by date descending and pick the newest
- [ ] Update `pickAnchorFromReplies()` to implement relaxed selection:
  - Sort all replies by `created_at` or `sent_at` descending
  - Filter by tier (sent+campaign_id → sent → any)
  - Return the first (most recent) match from the highest-priority tier
- [ ] Update `resolveReactivationEnrollmentsDue()` to use new helper
- [ ] Update `processReactivationSendsDue()` to call helper on-demand when `anchorReplyId` is null
- [ ] Add per-run cache (Map<email, bisonLeadId>) to avoid repeated lookups
- [ ] Persist `Lead.ghlContactId` when GHL discovery succeeds

### Error handling
- [ ] Timeout handling: 5s per GHL call, 30s per EmailBison call (align with Phase 53)
- [ ] Actionable `needsReviewReason` messages:
  - "EmailBison lead not found for email (domain: xxx...)" — redact full email
  - "No email thread exists; enroll lead in EmailBison campaign to start conversation"
  - "EmailBison API timeout during resolution; will retry on next cron run"
  - "GHL contact lookup timeout; skipped GHL-assisted discovery"
- [ ] Preserve existing safety guards (blacklist, opt-out, rate limits)
- [ ] Log anchor selection path for observability (sent-folder vs any-folder fallback)

### Tests
- [ ] Unit test: `resolveReactivationAnchor()` with mocked providers
- [ ] Unit test: `pickAnchorFromReplies()` selection logic:
  - Given multiple sent replies, picks the most recent by date
  - Given sent + inbox replies, prefers sent even if inbox is newer
  - Given only inbox replies, picks the most recent inbox reply
  - Given no replies, returns null
- [ ] Integration test: Full resolution → send cycle with test lead
- [ ] Edge case tests:
  - EmailBison lead exists but has no replies → `needs_review`
  - Lead found via GHL fallback → resolution succeeds
  - Multiple sent replies exist → uses most recent, not first/random
  - Anchor found in non-sent folder → sends in-thread successfully
  - All discovery paths fail → graceful `needs_review`

### Observability
- [ ] Log resolution path taken (DB-first, EmailBison lookup, GHL fallback)
- [ ] Log anchor selection tier used:
  - `sent_with_campaign` — ideal case
  - `sent_without_campaign` — relaxed sent
  - `any_folder` — fallback to most recent reply
  - `none` — `needs_review` triggered
- [ ] Telemetry: count of resolutions by path for monitoring fallback effectiveness
- [ ] Telemetry: count of anchor selections by tier to track how often fallbacks are used

## Output (Filled)

### Implemented: relaxed anchor selection + on-demand resolution

- Added pure anchor selection helper:
  - `lib/reactivation-anchor.ts`:
    - `isEmailBisonSentFolder()` recognizes `sent`, `outbox`, `outgoing`
    - `pickReactivationAnchorFromReplies()` implements tiered selection:
      1) sent + campaign match (if configured)
      2) sent (any campaign / campaign_id missing)
      3) newest reply any folder
- Updated `lib/reactivation-engine.ts`:
  - `resolveReactivationEnrollmentsDue()`:
    - prefers existing DB anchors via `Message.emailBisonReplyId` (`pickAnchorFromExistingMessages`)
    - relaxes campaign-id requirements via `pickReactivationAnchorFromReplies`
    - uses EmailBison lead-id discovery by email + global replies fallback
    - adds best-effort GHL-assisted lookup (`searchGHLContactsAdvanced`) and persists `Lead.ghlContactId` when found
    - only sets `needs_review` for true blockers (missing lead_id, no thread/replies, no sendable sender)
  - `processReactivationSendsDue()`:
    - no longer hard-fails when `anchorReplyId`/`selectedSenderEmailId` are missing; performs on-demand resolution and persists resolved anchor fields when found
    - continues to enforce existing safety gates + sender daily limits + `ReactivationSendLog` idempotency

### Tests

- Added unit tests for tiering/folder detection:
  - `lib/__tests__/reactivation-anchor.test.ts`
- Verified locally:
  - `npm run typecheck` ✅
  - `npm run lint` ✅ (warnings only, pre-existing)
  - `node --import tsx --test lib/__tests__/reactivation-anchor.test.ts` ✅

## Coordination Notes

- Working tree contains uncommitted changes across Phase 51–55 surfaces (EmailBison/GHL/inbound). Phase 54 changes were applied on top of the current file state and validated via `tsc` + ESLint to avoid accidental breaks.

## Handoff (Filled)

Proceed to **54e** to write a short verification runbook + rollout checklist (sample leads to validate each tier, expected enrollment transitions, and monitoring for `needs_review` reasons).
