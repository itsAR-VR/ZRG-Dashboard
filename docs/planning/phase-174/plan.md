# Phase 174 — Scheduled Follow-Up Tasks With Drafts + AI Timing Extraction

## Purpose
Implement AI-based timing extraction so inbound `"Follow Up"` replies with concrete defer intent create draft-backed scheduled tasks, pause sequences, and auto-send safely when due.

## Context
- Product decision lock for this phase:
  - Timing extraction uses a dedicated AI extractor path (fixed model: `gpt-5-mini`) instead of deterministic quarter/date rules.
  - Create timing follow-up tasks only when AI returns a concrete follow-up date.
  - Store draft content on the task (`suggestedMessage`, optional `subject`).
  - Auto-send due tasks only when safe, and only for `email` + `sms`.
- Trigger path:
  - Inbound message is classified with `sentimentTag === "Follow Up"`.
  - Message text is sent to the timing extractor prompt, which returns local datetime semantics + timezone.
- Scheduling semantics:
  - If AI returns date but not time, default to `09:00` local.
  - Timezone priority is `lead timezone -> workspace timezone -> UTC`.
  - Store canonical `dueDate` and `Lead.snoozedUntil` in UTC after local-time resolution.
  - Update `Lead.snoozedUntil`, call `pauseFollowUpsUntil`, and create/update one pending scheduled follow-up task.
- Extraction-miss semantics:
  - If AI cannot provide a concrete date: do not create/update timing task.
  - Send Slack ops alert (deduped) for operator visibility.
- Due-task semantics:
  - Process due scheduled tasks inside follow-ups cron flow.
  - For safe/eligible tasks, send via system draft approval path and mark completed.
  - If blocked/unsupported/fails, flip campaign to manual and keep pending for human handling.
- v1 boundaries:
  - No Prisma schema change expected.
  - LinkedIn/call auto-send is out of scope; remain manual.
- Security note:
  - Any exposed API key observed in local editor context should be treated as compromised and rotated.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 173 | Active | Inbound lead/message post-process surfaces and planning activity in nearby domains | Re-read current inbound post-process files before edits; keep timing-follow-up changes isolated from CRM webhook/scrollability work. |
| Phase 172 | Active | Inngest/cron orchestration conventions and queue-safety expectations | Keep this phase additive to existing dispatch/orchestration contracts; do not alter global scheduler semantics. |
| Phase 171 | Active | `lib/background-jobs/*` post-process behavior and AI/message safety expectations | Preserve stabilization guardrails and existing alerting semantics while adding follow-up scheduling hooks. |
| Phase 169 | Active | Cron dispatch/offload conventions for `/api/cron/followups` | Keep follow-ups route compatible with dispatch-only patterns and existing idempotent cron execution flow. |
| Working tree | Active | Uncommitted `docs/planning/phase-173/*` artifacts | Do not modify concurrent phase docs; create Phase 174 as an isolated planning track. |

## Repo Reality Check (RED TEAM)

- What exists today:
  - Deterministic snooze detection currently lives in `lib/snooze-detection.ts` (month/day focused) with timezone helpers in `lib/timezone-inference.ts`.
  - Inbound processing entry points are `lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/email-inbound-post-process.ts`, `lib/background-jobs/sms-inbound-post-process.ts`, and `lib/background-jobs/linkedin-inbound-post-process.ts`.
  - Follow-ups cron flow runs through `app/api/cron/followups/route.ts` -> `lib/cron/followups.ts` -> `lib/followup-engine.ts`.
  - `FollowUpTask` already includes `dueDate`, `campaignName`, `suggestedMessage`, and `subject` in `prisma/schema.prisma` (no schema expansion required for v1 data shape).
  - Slack ops notification and dedupe patterns already exist in `lib/background-jobs/email-inbound-post-process.ts`.
- Corrected stale references:
  - `lib/background-jobs/pipeline.ts` -> `lib/inbound-post-process/pipeline.ts`
  - `lib/followups.ts` -> `lib/cron/followups.ts` (+ `lib/followup-engine.ts` for due execution)
  - `lib/snooze-detection.test.ts` -> create/extend tests under `lib/__tests__/...`
- Verified touch points:
  - `pauseFollowUpsUntil` and `processFollowUpsDue` in `lib/followup-engine.ts`
  - `runFollowupsCron` in `lib/cron/followups.ts`
  - `resolveAutoSendScheduleConfig` / `isWithinAutoSendSchedule` in `lib/auto-send-schedule.ts`
  - `approveAndSendDraftSystem` in `actions/message-actions.ts`
  - existing fixed `gpt-5-mini` model usage patterns in AI extraction/gating paths (`lib/followup-engine.ts`, `lib/timezone-inference.ts`)

## Decision Locks (2026-02-19)

- Use AI extractor for defer-date interpretation (no deterministic quarter/date parser for this scheduling decision path).
- Fixed extractor model is `gpt-5-mini`.
- Extractor output contract is local date/time + timezone semantics; server resolves to UTC.
- No numeric confidence threshold; accept/reject based on extractor validity contract.
- If extractor misses concrete date: no timing task + send Slack ops alert.
- Dedupe policy is single pending scheduled task upsert per lead/campaign family.
- Timezone priority is `lead -> workspace -> UTC`.
- User override lock: NTTAN replay gates are explicitly waived for this phase execution (`2026-02-19`).

## Objectives
* [x] Add AI timing extractor module and prompt contract for follow-up defer-date interpretation.
* [x] Create a shared timing-follow-up helper that updates `Lead.snoozedUntil`, pauses sequences, and upserts a pending scheduled follow-up task with stored draft content.
* [x] Integrate scheduling behavior across inbound classification paths (`pipeline`, email, SMS, LinkedIn post-process flows).
* [x] Add extraction-miss Slack ops notification path (deduped and auditable).
* [x] Add due-task processing in follow-ups cron for safe email/SMS auto-send with manual fallback behavior.
* [x] Add tests and validation coverage (extractor contract + task flow + lint/build/full test run).

## Constraints
- Do not create scheduled tasks when AI does not return a concrete follow-up date.
- Do not use deterministic quarter/date parsing as fallback for this new timing-task scheduling path.
- Keep task dedupe/upsert behavior idempotent for repeated defer messages.
- Keep existing month/day snooze behavior backward compatible for legacy paths that still use `detectSnoozedUntilUtcFromMessage`.
- Auto-send is limited to `email` and `sms`; unsupported channels remain manual.
- Preserve lead opt-out/blacklist protections and schedule-window safety checks before send.
- Keep implementation behind env flag control for auto-send activation.
- Keep follow-ups route dispatch compatibility intact (`CRON_FOLLOWUPS_USE_INNGEST` must continue to work with no behavior regression).
- No Prisma schema changes for v1 unless implementation reality proves otherwise.
- If schema changes become necessary, run `npm run db:push` and document why v1 scope expanded.

## Success Criteria
- AI timing extraction correctly identifies concrete defer dates for representative follow-up phrasing (including quarter/fiscal-like language) and resolves to expected UTC due dates via timezone fallback chain.
- Follow-up sentiment with detected defer date creates/updates exactly one pending scheduled task per lead campaign family and stores draft content on task fields.
- `Lead.snoozedUntil` and sequence pause state are updated consistently with extracted deferral date.
- If extractor returns no concrete date:
  - no timing task is created/updated,
  - Slack ops notification is emitted with dedupe and traceable context.
- Due-task processor in follow-ups cron:
  - auto-sends eligible email/SMS tasks when all safety gates pass,
  - reschedules to next allowed window when outside schedule,
  - converts blocked/unsupported/failed sends to manual pending tasks.
- Validation gates pass for this execution:
  - `npm run lint`
  - `npm run build`
  - `npm test`
- NTTAN replay validation is waived for this phase by explicit user directive.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- AI returns malformed/ambiguous timing output and scheduler still creates tasks.
  - Mitigation: strict output schema + validity checks; no-date path must fail closed (no task).
- Duplicate scheduled tasks for a single defer request when multiple inbound processors run close together.
  - Mitigation: transactional pending-task lookup/update keyed by lead + campaign family before creating new rows; assert idempotency in tests.
- Cron integration accidentally bypasses dispatch-only mode or breaks lock behavior.
  - Mitigation: integrate due-task processing through `runFollowupsCron`/`processFollowUpsDue` flow without changing existing auth, lock, or dispatch contracts.

### Missing or ambiguous requirements (resolved)
- Dedupe contract locked to single pending task upsert.
- No-date behavior locked to no task + Slack ops alert.
- Extractor model locked to fixed `gpt-5-mini`.

### Repo mismatches (fixed in this plan)
- `lib/background-jobs/pipeline.ts` -> `lib/inbound-post-process/pipeline.ts`
- `lib/followups.ts` -> `lib/cron/followups.ts` (+ `lib/followup-engine.ts` for due execution)
- `lib/snooze-detection.test.ts` -> create/extend tests under `lib/__tests__/...`

### Performance / timeouts
- Due-task sending inside follow-ups cron can exceed runtime budgets during bursts.
  - Mitigation: keep per-run limits (`FOLLOWUP_TASK_AUTO_SEND_LIMIT`), process in bounded batches, and leave overflow tasks pending for next cycle.

### Security / permissions
- Any change in cron execution path can accidentally weaken auth or secret checks.
  - Mitigation: preserve `Authorization: Bearer ${CRON_SECRET}` checks and never log secrets or raw key material.

### Testing / validation
- AI/message replay gates are intentionally skipped in this run due explicit user directive.
  - Mitigation: full `npm test` + lint/build were run; if user later requests replay assurance, append an execution subphase to run NTTAN gates.

### Multi-agent coordination gaps
- Overlap risk with Phase 173 on inbound post-process files.
  - Mitigation: perform pre-flight conflict checks before editing shared files and document merge semantics in subphase output.
- Dependency risk with Phases 169/171/172 on follow-ups cron/background execution conventions.
  - Mitigation: treat route lock/dispatch behavior as fixed contracts and keep changes additive inside existing execution boundaries.

## Multi-Agent Pre-Flight Conflict Check

- [x] Ran `git status --short` and confirmed overlap with active Phase 173 CRM edits.
- [x] Scanned recent phases via `ls -dt docs/planning/phase-* | head -10` and re-read overlap phases (`173`, `172`, `171`, `169`) before shared-file edits.
- [x] Re-read current versions of `lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/*-inbound-post-process.ts`, `app/api/cron/followups/route.ts`, `lib/cron/followups.ts`, and `lib/followup-engine.ts` immediately before editing.
- [x] Kept Phase 174 file edits scoped to follow-up/timing paths and left active CRM work untouched.

## Assumptions (Agent)

- The follow-up task data model in `prisma/schema.prisma` is sufficient for v1 scheduling + draft storage without schema changes.
  - Mitigation check: if deterministic dedupe cannot be guaranteed without a DB constraint, append a schema-change subphase and run `npm run db:push`.
- Workspace Slack settings (`slackAlerts` + notification channel IDs + bot token) are available for ops notifications where configured.
  - Mitigation check: if workspace Slack is unavailable, still record structured server logs so extraction misses remain observable.

## Subphase Index
* a — AI Timing Extraction Contract + Prompt + Normalization
* b — Timing Follow-Up Task Upsert Helper + Inbound Integration
* c — Due Task Auto-Send Processor in Follow-Ups Cron
* d — AI Extractor/Flow Tests + NTTAN Replay Validation
* e — Rollout Flags, Ops Checklist, and Security Closeout
* f — Manifest + Coordination Hardening and Validation Evidence Capture

## Phase Summary (running)
- 2026-02-19T00:00:00Z — Implemented scheduled follow-up timing extraction + upsert helper + due-task cron processor with manual fallback, wired across inbound post-process paths and follow-ups cron (files: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/followup-timing-extractor.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/followup-timing.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/inbound-post-process/pipeline.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/email-inbound-post-process.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/sms-inbound-post-process.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/linkedin-inbound-post-process.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/cron/followups.ts`).
- 2026-02-19T00:00:00Z — Extended legacy deterministic snooze parsing with quarter support (`Q3`, `Q3 2027`, `2026 Q4`, `FY26 Q1`) while keeping legacy month/day behavior intact (file: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/snooze-detection.ts`).
- 2026-02-19T00:00:00Z — Added focused tests and rollout docs for timing follow-up behavior + env flags (files: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/__tests__/snooze-detection.test.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/__tests__/followup-timing.test.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/.env.example`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/README.md`).
- 2026-02-19T00:00:00Z — Validation completed: `npm run lint`, `npm run build`, `npm test` (NTTAN gates skipped per explicit user directive).
- 2026-02-19T21:41:00Z — Completed subphase evidence appendices (`a`-`f`) and closeout review preparation with conflict-check notes + NTTAN waiver traceability.
- 2026-02-19T21:43:04Z — Wrote closeout review artifact at `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-174/review.md`; reran `lint`/`build`/`test` and `db:push` on the combined worktree.
