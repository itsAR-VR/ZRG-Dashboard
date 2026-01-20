# Phase 46 — Fix “Double Send” in Founders Club + Booking-Context Draft Fidelity

## Purpose
Stop the Founders Club (FC) workspace from producing “double” outbound messages (real sends and/or duplicate Message rows), and ensure AI draft generation/regeneration consistently uses the full booking-process context (stages/waves, booking link, suggested times, qualifying questions) across all setter workflows.

## Context
Jam `d7811703-1d14-4aa8-8c96-c670ebbde5c2` (recorded 2026-01-20) shows the user reviewing Founders Club threads and calling out a “double set” of outbound emails (two outbound messages appearing back-to-back in a thread).

Key repo findings that plausibly explain “double sends” in FC:

1) **EmailBison reply send + immediate thread sync can create duplicate outbound Message rows**
   - `actions/email-actions.ts:sendEmailReply(...)` and `sendEmailReplyForLead(...)` create an outbound `Message` row **without** `emailBisonReplyId`.
   - For EmailBison, those send paths then trigger `lib/conversation-sync.ts:syncEmailConversationHistorySystem(...)`.
   - The sync imports EmailBison “replies” (including outbound items) and attempts to “heal” an existing message by fuzzy content match when `emailBisonReplyId` is null; if matching fails, it inserts a second outbound `Message` row.
   - Net effect: the UI can show two outbound messages for one send (“double set”), and operators can interpret it as the system sending twice.

2) **There are multiple outbound producers in this system**
   - Inboxxia/EmailBison campaign outbound: `app/api/webhooks/email/route.ts:handleEmailSent()` writes `Message.source="inboxxia_campaign"` (deduped by `Message.inboxxiaScheduledEmailId`).
   - Follow-up cron outbound: `app/api/cron/followups/route.ts` → `lib/followup-engine.ts` can send email/SMS.
   - AI auto-send outbound (email): `lib/background-jobs/email-inbound-post-process.ts` may call `approveAndSendDraftSystem(...)`.
   - A correct fix must make “one user action / one automation event” map to **exactly one send** and **one Message row**, with idempotency across sync/webhooks/jobs.

3) **Booking context must be present in drafts everywhere setters generate/regenerate**
   - Booking-process prompt injection exists (`lib/ai-drafts.ts` → `lib/booking-process-instructions.ts`), but we need to confirm setter-facing flows (manual regenerate, approval/send, and any “setter manage” flows) always pass enough conversation context and always hit the same booking-process logic, so the draft reflects the right stage/wave, link, times, and questions.

## Repo Reality Check (RED TEAM)

- What exists today:
  - Email replies sent via the dashboard (EmailBison provider) are persisted as outbound `Message` rows **without** `Message.emailBisonReplyId`, then immediately trigger `syncEmailConversationHistorySystem(...)` which imports EmailBison “replies” and can create a second outbound row if it can’t heal-match the existing row.
  - The EmailBison send payload uses `inject_previous_email_body: true`, so provider-side bodies can include quoted thread content and differ from the locally persisted `Message.body` (increasing heal-match failure odds).
  - `syncEmailConversationHistorySystem(...)` “heals” by fuzzy matching (subject and/or `body.substring(0, 100)`), and its email body normalizer truncates aggressively (currently 500 chars), which can cause mismatches.
  - UI message mapping in `actions/lead-actions.ts` collapses all outbound messages to `sender: "ai"`, which can make “two different outbound sources” look like a mysterious AI double-send.
- What the plan assumes:
  - The dominant FC symptom is **duplicate outbound Message rows** (not two provider sends), most commonly in the EmailBison reply + sync loop.
  - Booking-process instructions already exist in the draft pipeline, but regeneration/transcript quality and any alternate setter tooling paths may be insufficient/inconsistent.
- Verified touch points:
  - `actions/email-actions.ts` (`sendEmailReply`, `sendEmailReplyForLead`) calls `syncEmailConversationHistorySystem(...)` after EmailBison sends.
  - `lib/conversation-sync.ts` (`syncEmailConversationHistorySystem`) imports replies and can create outbound `Message` rows from provider data.
  - `app/api/webhooks/email/route.ts` (`handleEmailSent`) persists campaign outbound sends (`source="inboxxia_campaign"`) and is deduped by `inboxxiaScheduledEmailId`.
  - `lib/ai-drafts.ts` (`generateResponseDraft`) injects booking-process instructions via `getBookingProcessInstructions(...)`.
  - `actions/message-actions.ts` (`regenerateDraft`, `approveAndSendDraftSystem`) is the primary setter-facing draft create/regenerate/send surface.
  - `actions/lead-actions.ts` is the server-to-UI message mapping boundary (attribution fixes live here).

## Concurrent Phases

Working tree has uncommitted/untracked Phase artifacts that overlap with this phase’s code surface:

| Phase | Status | Overlap | Coordination |
|------:|--------|---------|--------------|
| Phase 45 | Uncommitted (working tree) | `lib/ai-drafts.ts`, `lib/booking-process-instructions.ts`, `actions/message-actions.ts`, `components/dashboard/settings-view.tsx` | Phase 46 must build on (or explicitly replace) these changes; commit/stash before implementation. |
| Phase 40 | Uncommitted (working tree) | `scripts/crawl4ai/*` | Independent; avoid mixing deploy infra changes with messaging fixes. |
| Phase 36 | Complete (reference) | Booking process semantics | Do not break wave/stage semantics and freeze rules; reuse existing builders/utilities. |
| Phase 42 | Complete (reference) | Idempotency/background jobs | Keep changes consistent with job idempotency patterns and avoid new dedupe races. |

## Pre-Flight Conflict Check

- [ ] Run `git status --porcelain` and ensure Phase 40/45 work is committed or stashed (do not mix deploy infra + messaging fixes in one branch).
- [ ] Re-read current versions of the files we’ll touch (avoid stale cached assumptions):
  - `actions/email-actions.ts`
  - `lib/conversation-sync.ts`
  - `lib/emailbison-api.ts`
  - `actions/lead-actions.ts`
  - `lib/ai-drafts.ts`
  - `actions/message-actions.ts`
- [ ] If a Prisma schema change becomes necessary, pause and explicitly coordinate, then run `npm run db:push`.

## Objectives
* [x] Reproduce and conclusively attribute the “double set” behavior (duplicate send vs duplicate Message rows)
* [x] Remove the root cause(s) (EmailBison send/sync duplication and any multi-sender overlap)
* [x] Ensure all AI draft generation/regeneration uses booking-process context correctly (including setter workflows)
* [x] Add guardrails + observability so future “double send” issues are diagnosable quickly

## Constraints
- Do not log or store secrets (EmailBison keys, webhook secrets, auth tokens).
- Do not add a brand-new test runner/framework for this phase (repo has no Jest/Vitest harness today); prefer `tsx` scripts + manual/SQL verification.
- Preserve webhook/job idempotency: safe to retry, safe under concurrency.
- Prefer using existing booking-process and draft utilities rather than inventing a parallel system.
- Avoid schema changes unless absolutely necessary; if schema changes are required, run `npm run db:push` and update relevant planning/docs.
- Avoid committing PII into planning docs (use leadId, not emails/names).

## Success Criteria
- [ ] Sending an EmailBison reply (manual or AI draft approval) results in **one** outbound email sent and **one** outbound `Message` row (no “double set” in the inbox UI). (Pending FC manual verification; fix implemented.)
- [ ] `syncEmailConversationHistorySystem(...)` no longer creates duplicate outbound `Message` rows for messages we already stored during send. (Pending FC manual verification; fix implemented.)
- [ ] AI drafts (create + regenerate) reliably include correct booking-process context (stage/wave, booking link behavior, suggested times, qualifying questions), including setter-facing workflows. (Pending FC manual verification; regeneration transcript improved.)
- [x] Lint/build pass (`npm run lint`, `npm run build`) and a written verification runbook exists for FC.

## Subphase Index
* a — Repro + root-cause attribution (DB + logs + Jam mapping)
* b — Fix EmailBison outbound dedupe (send ↔ sync ↔ webhook)
* c — Booking-context fidelity in AI drafts (create/regenerate + setter workflows)
* d — Guardrails + observability (source/sentBy clarity, debug signals)
* e — Verification + rollout checklist (FC-focused)
* f — Backfill/cleanup + validation harness (FC)

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **False-positive “healing” merges two distinct emails** → only heal when there is high confidence (same lead, outbound, near-time window, same subject, and a single best match) and log “heal vs insert” counts.
- **EmailBison API does not return a reliable outbound reply id on send** → plan must not depend on it; implement time-window-based healing in sync as the default, and only use provider ids when available.
- **Fix only UI attribution** and miss true duplicates → must verify in DB/provider that the system is not sending twice and is not inserting duplicate rows.
- **Multi-sender overlap causes real double sends** (AI auto-send + setter manual send + follow-up cron) → Phase 46a must classify each “double” using `source`, `sentBy`, `aiDraftId`, and timestamps; Phase 46d must surface this so operators can differentiate expected vs buggy behavior.

### Missing or ambiguous requirements
- Whether we should **backfill/clean existing duplicates** already in FC threads (recommended to avoid “bug still visible” confusion).
- Whether it is acceptable to **temporarily reduce** or delay post-send email thread sync (as a rollback lever) if dedupe cannot be made reliable quickly.

### Repo mismatches (fix the plan)
- There is **no dedicated unit-test runner** in `package.json`; any “unit test” language should be interpreted as a lightweight `tsx` validation script + manual SQL checks.

### Performance / timeouts
- Avoid adding additional synchronous EmailBison API calls in the send path; prefer background sync/job-based reconciliation if extra calls are needed.

### Security / permissions
- Any backfill/cleanup tool must be admin-gated and must not print lead PII; prefer counts + ids.

### Testing / validation
- Define exact SQL/Prisma queries and expected invariants (e.g., “no two outbound `email` Messages for the same lead within 2 minutes where one has `emailBisonReplyId` and the other is null”).

## Assumptions / Defaults (Proceeding Unless Told Otherwise)

- We will **backfill/cleanup existing FC duplicates** so the UI no longer shows legacy “double sets” after the fix (Subphase f). (confidence ~80%)
- We will treat the FC incident as **primarily UI/DB duplication** until 46a proves a true double provider send. (confidence ~80%)
- Keep `inject_previous_email_body: true` and make sync healing robust to formatting/quoting differences (do not rely on exact body equality). (confidence ~80%)
- Fixing FC outbound “double sets” is primarily a **send↔sync reconciliation** problem, not a booking-process send trigger. (confidence ~90%)
  - Verification: in 46a/46e, confirm provider-side send count is 1 for a test send.

## Phase Summary
- Shipped:
  - Root cause confirmed (46a): FC “double sets” are primarily duplicate outbound email `Message` rows created by the EmailBison reply sync path (send row w/ `emailBisonReplyId = NULL` + sync-import row w/ `emailBisonReplyId != NULL`).
  - Core fix (46b): `lib/conversation-sync.ts` now heals outbound EmailBison replies onto the existing send-created message row (time-window + subject preference), preventing new duplicates.
  - Draft fidelity (46c): `actions/message-actions.ts` draft regeneration now uses `buildSentimentTranscriptFromMessages(...)` + a larger recent-message window and gates email drafts with `shouldGenerateDraft(sentimentTag, lead.email)`.
  - Guardrails (46d): conversation UI now distinguishes human vs AI outbound messages; Chat UI renders AI messages with a Bot label/icon.
  - Cleanup harness (46f): added `scripts/dedupe-fc-emailbison-outbound.ts` (dry-run by default) to detect/merge legacy duplicates by IDs only.
- Verified:
  - `npm run lint`: pass (Tue Jan 20 23:41:13 +03 2026; warnings only)
  - `npm run build`: pass (Tue Jan 20 23:41:28 +03 2026)
  - `npm run db:push`: skipped (no `prisma/schema.prisma` changes detected)
- Notes:
  - FC manual verification is still required for “one provider send / one message row” (see `docs/planning/phase-46/e/plan.md`).
  - Working tree is not clean (Phase 40/45 artifacts present); merge/review should consider the combined change set.
