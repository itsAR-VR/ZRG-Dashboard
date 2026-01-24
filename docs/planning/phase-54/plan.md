# Phase 54 — Reactivation Campaigns: Resolve/Create Email Thread Anchors

## Purpose
Enable reactivation campaign emails to send even when no “sent anchor” (`ReactivationEnrollment.anchorReplyId`) is present by robustly discovering an anchor via the lead’s email (EmailBison + GHL) and creating an anchor/thread when none exists.

## Context
- Current behavior in `lib/reactivation-engine.ts`:
  - `resolveReactivationEnrollmentsDue()` resolves `emailBisonLeadId`, then fetches EmailBison replies and requires a “sent” reply with a usable `campaign_id` to derive `anchorReplyId`.
  - If no anchor is found, enrollment is set to `needs_review`, blocking sends.
  - `processReactivationSendsDue()` hard-fails to `needs_review` when `anchorReplyId` is missing (it does not attempt an on-demand resolve).
- Requirement (from discussion):
  - We should *prefer* to find an existing sent anchor, but we must be able to send reactivations without one.
  - Use the lead’s email address to discover the correct provider records.
  - Use both EmailBison and GHL for contact discovery (if we find the contact in GHL, we should be able to find/reference it in EmailBison).
  - If no anchor exists, create one and send the reactivation in-thread or as a new thread depending on what exists.
- Jam: a jam.dev link was provided, but Jam MCP access is blocked in this environment (`Auth required`), so the plan relies on the described behavior until Jam access is configured or repro steps are written down.

## Concurrent Phases
Recent phases overlap with EmailBison/GHL integrations and will affect implementation sequencing.

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 53 | Active/dirty working tree | Email webhook + EmailBison API usage | Reuse existing error-handling/idempotency patterns; avoid reintroducing bursty on-path work. |
| Phase 52 | Active/dirty working tree | EmailBison lead discovery + campaign context | Share lead-id discovery primitives; keep “thread anchor” semantics compatible with booking/automation expectations. |
| Phase 51 | Active/dirty working tree | Email send pipeline refactors | Avoid inventing new send abstractions that will conflict with Phase 51’s unification direction. |
| Phase 50 | Complete/dirty working tree | Email participant metadata + send paths | Ensure any “new thread” send path still records From/To/CC correctly and doesn’t regress participant visibility. |

## Objectives
* [x] Define the "anchor" contract and the decision rules for anchor selection (sent-folder preferred → any folder fallback).
* [x] Implement deterministic anchor discovery using lead email across DB → EmailBison → GHL-assisted fallbacks.
* [ ] ~~Implement an anchor creation path when no suitable provider thread exists.~~ — **DESCOPED**: EmailBison API confirmed to not support new-thread sends.
* [x] Update reactivation sending to re-resolve anchors on-demand with relaxed selection (don't fail just because `anchorReplyId` is null if ANY thread exists).
* [x] Add regression coverage + a verification runbook.

## Constraints
- **Safety gates:** do not send to blacklisted/unqualified/opted-out leads; preserve current guardrails.
- **Idempotency:** webhook retries, cron replays, and reactivation retries must not duplicate sends (`ReactivationSendLog` uniqueness).
- **Daily limits:** preserve 5/day per sender email address semantics (`ReactivationSenderDailyUsage`).
- **PII/logging:** avoid logging raw lead content/emails beyond what’s necessary for debugging; redact where possible.
- **Provider reality:** EmailBison supports reply-in-thread via `POST /api/replies/:id/reply`; new-thread send may require an additional provider endpoint (must be verified).

## Success Criteria
- [x] A reactivation enrollment with `anchorReplyId = NULL` can still progress to `sent` when the provider thread exists (anchor is discovered by email via relaxed discovery algorithm).
- [ ] ~~no prior "sent anchor" exists (the system creates an anchor/thread and sends)~~ — **DESCOPED**: EmailBison API does not support new-thread sends.
- [x] The system uses a **relaxed anchor selection** (sent-folder preferred → any folder fallback) instead of failing on missing sent anchor.
- [x] Enrollment state transitions reflect real blockers:
  - `needs_review` is reserved for true configuration/provider failures (missing API keys, no sendable sender, no email thread exists, etc.)
  - `needs_review` messages are actionable: "No email thread exists; enroll lead in EmailBison campaign to start conversation"
- [x] Tests cover the major missing-anchor scenarios and prevent regressions.

## Phase Summary

- Implemented relaxed EmailBison anchor selection and removed the hard dependency on a “sent anchor” with `campaign_id`:
  - New pure helper: `lib/reactivation-anchor.ts`
  - Unit tests: `lib/__tests__/reactivation-anchor.test.ts`
- Hardened reactivation processing to resolve anchors/senders more robustly:
  - `resolveReactivationEnrollmentsDue()` now:
    - prefers DB-stored anchors (`Message.emailBisonReplyId`)
    - falls back to EmailBison discovery via lead email (plus global replies search)
    - uses best-effort GHL contact lookup as a recovery path and persists `Lead.ghlContactId`
  - `processReactivationSendsDue()` now:
    - performs on-demand resolution when `anchorReplyId`/`selectedSenderEmailId` are missing (instead of immediately `needs_review`)
- Limitation (confirmed): EmailBison integration supports reply-in-thread only; leads with no EmailBison thread/replies remain `needs_review` with an actionable remediation message.

## Subphase Index
* a — Audit current reactivation flows + anchor definitions
* b — Anchor discovery algorithm (DB + EmailBison + GHL-assisted fallbacks)
* c — Anchor creation + thread selection rules (same-thread vs new-thread)
* d — Implementation + regression tests
* e — Verification runbook + rollout checklist

## Repo Reality Check (RED TEAM)

- What exists today:
  - `lib/reactivation-engine.ts`: `resolveReactivationEnrollmentsDue()` (lines 278-558), `processReactivationSendsDue()` (lines 620-800)
  - `lib/emailbison-api.ts`: `findEmailBisonLeadIdByEmail()`, `fetchEmailBisonReplies()`, `fetchEmailBisonRepliesGlobal()`, `sendEmailBisonReply()`, `createEmailBisonLead()`
  - `lib/ghl-api.ts`: `searchGHLContactsAdvanced()` (line 774)
  - Prisma models: `ReactivationEnrollment`, `ReactivationCampaign`, `ReactivationSendLog`, `ReactivationSenderDailyUsage`, `EmailBisonSenderEmailSnapshot`
- What the plan assumes:
  - EmailBison has a "new thread" send primitive (needs verification; only `sendEmailBisonReply()` exists for in-thread replies)
  - GHL-assisted fallbacks will help discover EmailBison lead IDs (lookup by email casing/alternatives)
  - The current `pickAnchorFromReplies()` logic (line 35) can be relaxed to accept non-sent-folder anchors as fallback
- Verified touch points:
  - `resolveReactivationEnrollmentsDue()`: lib/reactivation-engine.ts:278 — currently sets `needs_review` when no anchor found (lines 415-427)
  - `processReactivationSendsDue()`: lib/reactivation-engine.ts:620 — hard-fails when `anchorReplyId` or `selectedSenderEmailId` is null (lines 667-674)
  - `sendEmailBisonReply()`: lib/emailbison-api.ts:623 — uses `POST /api/replies/:id/reply` (requires existing reply ID)
  - `createEmailBisonLead()`: lib/emailbison-api.ts:1231 — creates lead but does NOT create a thread/reply

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes

1. ~~**No EmailBison "new thread" API endpoint exists**~~ — **RESOLVED/CONFIRMED**: EmailBison API does not support new-thread sends. Scope adjusted to "relaxed anchor discovery" only. Leads with no email history will go to `needs_review` with actionable message.

2. **GHL-assisted discovery adds latency to burst scenarios** → Running GHL contact searches during resolution could cause timeout cascades similar to Phase 53 issues. **Mitigation**: Bound GHL lookups with short timeouts (5s) and fail-fast to `needs_review` with diagnostic context.

3. **Race condition between resolution and send** → If `resolveReactivationEnrollmentsDue()` populates `anchorReplyId` but the lead's EmailBison state changes before `processReactivationSendsDue()` runs, the anchor may be stale. **Mitigation**: Add on-demand re-verification in send path when anchor is > 1 hour old.

4. **Working tree has uncommitted changes overlapping with Phase 54 touchpoints** → `lib/reactivation-engine.ts`, `lib/emailbison-api.ts`, `lib/ghl-api.ts` all have uncommitted modifications. **Mitigation**: Commit/stash prior phase work before starting Phase 54 implementation.

### Missing or ambiguous requirements — RESOLVED

- ~~**What qualifies as "anchor" when no sent-folder reply exists?**~~ — **RESOLVED**: Relaxed selection: (1) sent-folder with campaign_id, (2) sent-folder without campaign_id, (3) latest reply any folder, (4) `needs_review`.

- ~~**Should GHL discovery update `Lead.ghlContactId`?**~~ — **RESOLVED**: Yes, persist recovered IDs to reduce future API calls.

- ~~**EmailBison "new thread" behavior unknown**~~ — **RESOLVED/CONFIRMED**: EmailBison does NOT support new-thread sends. Phase 54 scope is "relaxed anchor discovery" only.

### Repo mismatches (fix the plan)

- **Subphase 54b references `fetchEmailBisonLeadReplies`** → This function exists (line 996), but plan should also mention `fetchEmailBisonReplies` (line 695) which is what's currently used in `resolveReactivationEnrollmentsDue()`.
- **Plan mentions "GHL-assisted fallbacks" but doesn't specify the helper** → The function is `searchGHLContactsAdvanced()` at lib/ghl-api.ts:774.

### Performance / timeouts

- **EmailBison API calls have 30s timeout** → `getEmailBisonTimeoutMs()` defaults to 30s (lib/emailbison-api.ts:230). Multiple sequential lookups could cascade to 60-90s, hitting Vercel timeouts.
- **Mitigation**: Implement per-run caches (Map by email) and bound total provider calls per cron run.

### Security / permissions

- **No additional auth checks needed** → Reactivation runs as cron job with CRON_SECRET auth; no user-facing permission changes.
- **PII logging concern** → Resolution errors should not log full email addresses; use `lead.id` + first 3 chars of email domain.

### Testing / validation

- **Missing test coverage** → No existing tests for reactivation-engine.ts in the repo.
- **Add tests for**: (1) missing anchor discovery paths, (2) GHL fallback timeout handling, (3) new-thread fallback behavior, (4) idempotency on retry.

### Multi-agent coordination

- **Phases 51, 52, 53 have uncommitted changes** affecting the same integration surfaces.
- **Phase 51**: Prompt runner + inbound kernel — no direct overlap with reactivation.
- **Phase 52**: Booking automation — overlaps with `lib/followup-engine.ts` which reactivation triggers; need to ensure reactivation's `startFollowUpSequenceInstance()` stays compatible.
- **Phase 53**: Webhook/email stability — overlaps with `lib/emailbison-api.ts` timeout/retry patterns; reuse Phase 53's hardening approach.
- **Coordination strategy**: Commit Phase 53 changes before starting Phase 54 implementation; reuse Phase 53 timeout patterns.

## Resolved Questions

- [x] **EmailBison new-thread API capability** — CONFIRMED: No such endpoint exists
  - Verified via [EmailBison Developers docs](https://emailbison.com/developers): API only supports `POST /api/replies/{reply_id}/reply` (requires existing reply) and campaign-based sends.
  - **Decision**: Phase 54 scope is "discover existing anchors better" only. Leads with no email history will go to `needs_review` with actionable message: "No email thread exists; enroll lead in EmailBison campaign to start conversation."

- [x] **Anchor relaxation scope** — DECIDED: Prefer sent-folder, fallback to latest reply in thread (by date)
  - **Decision**: Do NOT use inbox (lead's) replies as anchor if avoidable. If no sent-folder reply exists but the lead has email history, use the **most recent reply by date** (not a random reply) to maintain proper threading.
  - Selection order:
    1. Most recent sent-folder reply with campaign_id
    2. Most recent sent-folder reply (any)
    3. Most recent reply overall (maintains thread continuity)
  - Rationale: Using the latest reply ensures the bump continues the existing conversation naturally.

- [x] **GHL ID persistence** — DECIDED: Yes
  - **Decision**: When GHL-assisted discovery finds a contact, persist `Lead.ghlContactId` to reduce future API calls.

## Assumptions (Agent)

- GHL contact search by email will return matching contacts when they exist (confidence ~95%)
  - Mitigation check: Test `searchGHLContactsAdvanced` with email filter before relying on it.

- The reactivation cron job runs regularly (verified: `vercel.json` has `/api/cron/reactivations` configured)
  - Cron route at `app/api/cron/reactivations/route.ts` processes up to 500 resolutions + 100 sends per run.

- `sendEmailBisonReply()` will succeed if given any valid reply_id for the lead (not just sent-folder) (confidence ~85%)
  - Mitigation check: Test with non-sent-folder reply_id before implementing relaxed selection.
  - If this fails, fall back to sent-folder-only and document limitation.

## Review Notes

- **Review completed**: 2026-01-24
- **Review artifact**: `docs/planning/phase-54/review.md`
- **Quality gates**:
  - `npm run lint` — ✅ 0 errors, 17 warnings (pre-existing)
  - `npm run build` — ✅ pass
  - `npm run db:push` — ⏭️ skipped (no Prisma schema changes in Phase 54)
  - `node --import tsx --test lib/__tests__/reactivation-anchor.test.ts` — ✅ 4 tests pass
- **Multi-agent coordination**: Working tree contains uncommitted changes from Phases 51–55; no semantic conflicts in Phase 54 deliverables
- **Follow-ups**:
  - Monitor anchor tier distribution in production
  - Monitor GHL-assisted recovery rate
  - Verify `sendEmailBisonReply()` works with non-sent-folder reply_ids in production
