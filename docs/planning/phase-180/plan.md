# Phase 180 — Restrict “Intentional Routing” to Follow-Up (Fix Meeting Requested Draft Suppression)

## Purpose
Fix the production regression where inbound **Meeting Requested** replies end up with a low-quality “routed” draft (or no usable draft) because normal inbound draft generation is intentionally skipped.

Lock routing behavior to the policy below:
- “Intentional routing” suppression is only for **Follow Up** timing/sequence purposes.
- **Call Requested (Booking Process 4)** never auto-sends.
  - With phone on file: draft/manual-send flow remains allowed.
  - Without phone on file: notify/task handoff only (no draft), per lock from this thread.
- **External scheduler link (Booking Process 5)** continues lead-calendar booking/task flow and is not blocked by Process 4 no-phone policy.

## Context
Observed symptom (Founders Club):
- Slack ops alert: `⚠️ AI Draft Routed (Intentional Routing)` with reason text: “Scheduling flow created a follow-up task (with a pending draft), so the normal inbound draft-generation step was intentionally skipped.”
- Inbox compose shows a generic clarification (for example, “Before we schedule, can you confirm the key booking detail you want us to use?”) instead of a proper response to the lead’s scheduling window request.

Root cause (current behavior):
- In inbound post-process (email/SMS/LinkedIn + shared pipeline), `schedulingHandled` is computed as:
  - `autoBook.context.followUpTaskCreated || timingFollowUpScheduled`
- `processMessageForAutoBooking(...)` can create a `FollowUpTask` and a pending `AIDraft` with `triggerMessageId = followup_task:<taskId>`.
- When `schedulingHandled=true`, inbound processors skip `generateResponseDraft(...)` and (in email) emit the “Intentional Routing” Slack alert.

Workspace in scope:
- Founders Club (`clientId=ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`)

## Repo Reality Check (RED TEAM)
What exists today:
- Suppression predicate in all inbound processors:
  - `lib/background-jobs/email-inbound-post-process.ts`
  - `lib/background-jobs/sms-inbound-post-process.ts`
  - `lib/background-jobs/linkedin-inbound-post-process.ts`
  - `lib/inbound-post-process/pipeline.ts`
- Booking flow task/draft creation in:
  - `lib/followup-engine.ts` (`processMessageForAutoBooking`)
- FollowUpTask draft backfill in:
  - `lib/followup-task-drafts.ts`
  - called from inbound processors + `lib/background-jobs/maintenance.ts`
- Auto-send call-skip gate in:
  - `lib/auto-send/orchestrator.ts`
- Compose draft ordering risk:
  - `actions/message-actions.ts` fetches pending drafts newest-first.
  - `components/dashboard/action-station.tsx` uses the first returned draft.

Implication:
- Any broad `followup_task:*` draft creation/backfill can hijack compose with routed drafts unless eligibility is narrowed and suppression is explicit.

## Concurrent Phases
Working tree is dirty and overlaps active phase tracks in this domain.

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 179 | Active (untracked) | Follow-up timing + booking + auto-send reliability; inbound processors | Preserve Phase 179 timing policies while narrowing suppression/backfill scope. |
| Phase 178 | Active (untracked) | Booking Process 4/5 routing + notifications/tasking | Keep Process 4/5 semantics aligned with this thread lock. |
| Phase 177 | Active (untracked) | Same as 178 (earlier variant) | Avoid reintroducing stale router assumptions. |
| Phase 176 | Active (untracked) | Intentional routing + task-draft backfill | Narrow the Phase 176 broad backfill behavior to intended follow-up purposes only. |
| Phase 175 | Active (tracked/untracked) | Follow-up timing clarification tasks/drafts | Preserve timing-clarify flow and attempt semantics. |

## Locked Policy Decisions
- Process 4 (`Call Requested`) no-phone policy: **notify/task only**, no draft creation, no auto-send.
- Process 4 (`Call Requested`) with phone on file: draft/manual-send allowed; auto-send always skipped.
- Process 5 (lead external scheduler link): continue scheduler-link task/manual booking handoff; do not let Process 4 no-phone policy suppress Process 5 handling.
- Meeting Requested must not suppress normal inbound draft generation due to generic follow-up-task side effects.

## Objectives
* [x] Verify exact suppression triggers and draft selection behavior for Meeting Requested threads.
* [x] Update inbound post-process routing so Meeting Requested never suppresses normal inbound draft generation.
* [x] Ensure meeting/booking clarification logic does not create generic `followup_task:*` drafts that hijack compose for Meeting Requested.
* [x] Ensure Process 4 Call Requested never auto-sends, and honors the locked no-phone notify-only policy.
* [x] Narrow FollowUpTask→AIDraft backfill to intended follow-up purposes (sequence/timing-clarify) and exclude ad-hoc booking/manual tasks.
* [x] Add regression tests, replay coverage, and required NTTAN validation gates.

## Constraints
- Surgical changes only; touch only files required for routing/draft generation behavior.
- No Prisma schema changes expected in this phase.
- No PII in docs/artifacts (IDs only, no message body dumps).
- Keep `phase-180/a` through `phase-180/d` immutable in this RED TEAM pass (already completed).
- Add new plan hardening in appended subphase `phase-180/e`.

## Success Criteria
- Meeting Requested inbound messages produce normal inbound AI drafts in compose (not generic routed `followup_task:*` drafts).
- `⚠️ AI Draft Routed (Intentional Routing)` no longer fires for Meeting Requested flows.
- Follow Up timing/sequence routing suppression continues to work where explicitly intended.
- Process 4 Call Requested:
  - with phone: draft/manual-send path exists; auto-send is skipped,
  - without phone: no draft; notify/task path only.
- Process 5 scheduler-link flow continues creating correct handoff tasks independently of Process 4 no-phone behavior.

## RED TEAM Findings (Gaps / Weak Spots)
### Highest-risk failure modes
- Broad task-draft backfill creates competing pending drafts and hijacks compose selection.
  - Mitigation: restrict backfill eligibility to sequence and timing-clarify task classes only.
- Suppression predicate couples to `followUpTaskCreated` too broadly.
  - Mitigation: suppression contract must be explicit for Follow Up timing/sequence only.
- Call-requested semantics diverge between sentiment and action-signal paths.
  - Mitigation: lock Process 4 decision matrix and assert in tests.

### Missing or ambiguous requirements (fixed by this plan update)
- Manifest-first replay requirement was not enforced at root level.
- Replay diagnostics (`judgePromptKey`, `judgeSystemPrompt`, `failureType`) were not required in closeout.
- Multi-agent conflict procedure was implied but not codified as execution gates.

## Multi-Agent Coordination (Required)
Before any implementation edit in shared files:
1. Run `git status --porcelain`.
2. Re-scan recent phases: `ls -dt docs/planning/phase-* | head -10`.
3. Re-read live file state for every target file immediately before edit.
4. If overlap exists, merge semantically and log the conflict resolution in phase outputs.

Conflict log template (must be used in implementation output):
- Issue:
- Overlap phase(s):
- File(s):
- Resolution:
- Residual risk:

## NTTAN Validation Contract
Required validation (manifest-first):
- `npm run test:ai-drafts`
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-180/replay-case-manifest.json --dry-run`
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-180/replay-case-manifest.json --concurrency 3`

Fallback only if manifest cannot be created in 180a:
- `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20`
- `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3`

Baseline compare (required when prior artifacts exist):
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-180/replay-case-manifest.json --baseline .artifacts/ai-replay/<prior-run>.json`

## Replay Diagnostics Review (Required)
Closeout/review must include:
- `judgePromptKey`
- `judgeSystemPrompt`
- per-case `failureType` classification summary
- explicit callout of any `slot_mismatch`, `date_mismatch`, `fabricated_link`, `empty_draft`, `non_logistics_reply`

## Subphase Index
* a — Investigation + Contract Lock (why suppression triggers; what must change)
* b — Fix Inbound Routing Suppression (email/SMS/LinkedIn + shared pipeline)
* c — Fix Booking/Call Draft Semantics (no booking followup_task drafts; call requested no auto-send; narrow backfills)
* d — Tests + Replay Coverage + NTTAN Gates + Phase Review
* e — RED TEAM Hardening Addendum (decision matrix, overlap controls, replay diagnostics contract)

## Phase Summary (running)
- 2026-02-21 — Coordinated overlap check before final validation:
  - `git status --porcelain`
  - `ls -dt docs/planning/phase-* | head -10`
  - Current neighbors include `phase-175` through `phase-181`; phase-176/177/178/179 remain the primary shared-file overlap set.
- 2026-02-21 — Confirmed routing suppression is Follow Up-only and gated by eligible pending routed drafts in:
  - `lib/background-jobs/email-inbound-post-process.ts`
  - `lib/background-jobs/sms-inbound-post-process.ts`
  - `lib/background-jobs/linkedin-inbound-post-process.ts`
  - `lib/inbound-post-process/pipeline.ts`
- 2026-02-21 — Confirmed booking clarification flow no longer emits booking `followup_task:*` draft sources and call auto-send skip covers both action-signal and sentiment paths.
- 2026-02-21 — Completed regression + NTTAN fallback validation and baseline compare:
  - `npm run test:ai-drafts` (pass)
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20`
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3`
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3 --baseline .artifacts/ai-replay/run-2026-02-21T01-49-06-109Z.json`
- 2026-02-21 — Added phase-local replay manifest for subsequent manifest-first runs:
  - `docs/planning/phase-180/replay-case-manifest.json`
- 2026-02-21 — Executed manifest-first replay gates + manifest baseline compare:
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-180/replay-case-manifest.json --dry-run`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-180/replay-case-manifest.json --concurrency 3`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-180/replay-case-manifest.json --concurrency 3 --ab-mode overseer --baseline .artifacts/ai-replay/run-2026-02-21T02-12-05-282Z.json`
- 2026-02-21 — Final cleanup rerun:
  - `npm run test:ai-drafts` (pass)
  - `npm test` (pass)
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-180/replay-case-manifest.json --dry-run --ab-mode overseer` (selected=20)
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-180/replay-case-manifest.json --concurrency 3 --ab-mode overseer` (evaluated=9, passed=8, failedJudge=1, zero critical invariant misses)

## Conflict Log (This Turn)
- Issue: Concurrent edits in same inbound/booking domains across active phases.
- Overlap phase(s): 176, 177, 178, 179.
- File(s): `lib/background-jobs/email-inbound-post-process.ts`, `lib/background-jobs/sms-inbound-post-process.ts`, `lib/background-jobs/linkedin-inbound-post-process.ts`, `lib/inbound-post-process/pipeline.ts`, `lib/followup-engine.ts`, `lib/followup-task-drafts.ts`, `lib/auto-send/orchestrator.ts`.
- Resolution: Preserved booking-process router semantics and narrowed only suppression/backfill eligibility and call auto-send skip gates to the locked Phase 180 policy.
- Residual risk: Future changes that broaden Follow Up timing scheduling criteria can widen suppression scope unless eligibility tests stay green.
