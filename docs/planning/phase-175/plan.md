# Phase 175 — Follow-Up Timing Clarification (Ask-for-Date Flow + Anti-Spam Guards)

## Purpose
Eliminate “Follow-Up Timing Not Scheduled” dead-ends by generating a follow-up timing clarification message (AI draft) whenever a lead defers with no concrete date, while preventing spam and preserving safety controls.

## Context
Recent inbound replies like “maybe in the future” and “not at this time” often contain no concrete follow-up date. Phase 174 added AI timing extraction and scheduled follow-up tasking. The current working tree now already creates timing-clarification tasks/drafts on no-date replies, but there are still gaps around anti-spam attempt control, independent auto-send gating, LinkedIn auto-send support, and Not Interested hard-no suppression.

Key requirements from this thread:
* If there is no concrete date, ask for one (do not pick a date deterministically).
* Drafts should still be created even when follow-up logic routes to a task.
* Handle edge cases safely (soft deferrals vs hard “no”; spam prevention; channel constraints).
* Increase timing extractor output budget to avoid `max_output_tokens` truncation (already applied in working tree).

## Current State (Repo Reality)
This phase builds on existing follow-up timing + routing behavior already in the repo:
* Timing extraction exists in `lib/followup-timing-extractor.ts` (`followup.extract_timing.v1`), with increased output-token budget to avoid `max_output_tokens`.
* Follow-up timing scheduling exists in `lib/followup-timing.ts` (`scheduleFollowUpTimingFromInbound`):
  * If concrete date is detected, it creates/updates a scheduled follow-up task.
  * If no concrete date is detected, it currently creates a timing-clarification FollowUpTask + AIDraft and updates `lead.snoozedUntil` and calls `pauseFollowUpsUntil(...)` (this will be changed).
* Due-task sending exists in `lib/followup-timing.ts` (`processScheduledTimingFollowUpTasksDue`) and currently auto-sends scheduled tasks and timing-clarification tasks for `email`/`sms` only, gated by `FOLLOWUP_TASK_AUTO_SEND_ENABLED`.
* Follow-up tasks create inbox-visible drafts using `triggerMessageId = followup_task:<taskId>` and drafts are marked as completed tasks when sent in `actions/message-actions.ts` (`approveAndSendDraftSystem`, `approveAndSendDraft`).
* LinkedIn system sending exists in `lib/system-sender.ts` (`sendLinkedInMessageSystem`) but `approveAndSendDraftSystem` currently does not support system-sending LinkedIn drafts.
* Inbound timing scheduling is only invoked when sentiment is exactly `Follow Up` in:
  * `lib/inbound-post-process/pipeline.ts`
  * `lib/background-jobs/email-inbound-post-process.ts`
  * `lib/background-jobs/sms-inbound-post-process.ts`
  * `lib/background-jobs/linkedin-inbound-post-process.ts`
* `FOLLOWUP_TIMING_CLARIFY_AUTO_SEND_ENABLED` is not yet present in `.env.example` or `README.md`.

## Repo Reality Check (RED TEAM)
* What exists today:
  * Core timing extraction + scheduler + due-task processor already exist and are wired into inbound post-process flows.
  * Clarifier creation currently writes `lead.snoozedUntil` and calls `pauseFollowUpsUntil(...)`.
  * Due-task sender currently gates all auto-send behavior behind `FOLLOWUP_TASK_AUTO_SEND_ENABLED` and converts non-email/SMS tasks to manual.
  * `approveAndSendDraftSystem` still rejects LinkedIn drafts (`"System send for LinkedIn drafts is not supported"`).
* What this plan assumes:
  * We can add bounded clarify attempt logic without schema changes by encoding attempt metadata in `campaignName` + message history checks.
  * We can create a dedicated clarify auto-send gate that does not alter scheduled follow-up behavior.
  * We can safely integrate Not Interested deferral gating across all inbound paths without changing sentiment classification itself.
* Verified touch points:
  * `lib/followup-timing.ts`
  * `lib/followup-timing-extractor.ts`
  * `actions/message-actions.ts`
  * `lib/system-sender.ts`
  * `lib/inbound-post-process/pipeline.ts`
  * `lib/background-jobs/email-inbound-post-process.ts`
  * `lib/background-jobs/sms-inbound-post-process.ts`
  * `lib/background-jobs/linkedin-inbound-post-process.ts`
  * `.env.example`
  * `README.md`

## Concurrent Phases
This work overlaps directly with recently modified timing/inbound files and should be treated as high-conflict.

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 174 | Recent (same domain) | `lib/followup-timing*.ts`, inbound post-process files, follow-ups cron | Re-read live file state immediately before each edit and merge semantically with existing Phase 174 behavior. |
| Phase 173 | Recent (adjacent domain) | Inbound post-process orchestration + CRM hooks | Preserve existing lead assignment/CRM update/draft generation sequencing while adding timing gate logic. |
| Phase 172 / 171 | Active/recent (adjacent infra) | Background-job + cron orchestration conventions | Keep cron/auth/idempotency contracts intact; avoid unrelated edits in shared runner/dispatch files. |
| Working tree | Active | Uncommitted changes already present in target files | Run conflict checks before each slice; do not overwrite in-flight edits. |

## Pre-Flight Conflict Check (RED TEAM)
* [ ] Run `git status --porcelain` and confirm expected overlap set before each implementation slice.
* [ ] Re-read current versions of every target file immediately before editing (no cached assumptions).
* [ ] If target files changed since planning, append a conflict note to the executing subphase Output:
  * `Issue`, `Cause`, `Resolution`, `Files affected`.
* [ ] Keep Phase 175 edits scoped to timing clarify + gating; avoid opportunistic edits in shared cron/background systems.

## Decisions Locked (From This Thread)
* If no concrete follow-up date is detected, ask for one (do not fabricate or choose a date).
* Timing-clarification sending is `Auto-send w/ flag`:
  * Auto-send only when both `FOLLOWUP_TASK_AUTO_SEND_ENABLED=1` and `FOLLOWUP_TIMING_CLARIFY_AUTO_SEND_ENABLED=1`.
  * Still schedule-gated by the workspace auto-send schedule.
  * Attempt `#1` and attempt `#2` should both run via auto-send when enabled by flags + schedule (no special manual-only branch for attempts).
* Eligible auto-send channels for clarifier: `email`, `sms`, and `linkedin` if Unipile is connected/configured.
* Anti-spam attempt policy:
  * Max 2 clarification attempts.
  * Attempt #2 is created after any successful send of attempt #1 (auto-send or manual approval path), then due 24 hours later.
  * Attempt #2 is auto-sent by cron (when due and within schedule).
* Cancellation rule: any inbound reply cancels pending attempt #2.
* Not Interested handling: add an AI gate to separate soft deferral vs hard “no”:
  * Soft deferrals may trigger timing clarify.
  * Hard “no” should not.
  * `unclear` fails closed silently (no clarify send, no manual review task, no Slack spam).
* Do not pause/snooze follow-up sequences as a side-effect of creating timing-clarification tasks/drafts (no `lead.snoozedUntil` writes and no `pauseFollowUpsUntil(...)` calls in the clarify path).
* After exhausting the 2 attempts with no reply, switch to the Re-engagement follow-up sequence if it is not already completed, with a 3-day delayed anchor after attempt #2 send (details in Phase 175b).
* LinkedIn clarify due-task fallback when Unipile is disconnected:
  * Convert the task to manual and keep the pending draft.
  * Emit a Slack warning (not incident) that includes client ID + client name and disconnection context.
  * Dedupe this warning to max 1 alert per client per 24 hours.
* Keep existing “outbound touch resumes paused follow-up instances” behavior (no special-casing clarifier sends).
* Replay validation merge gate is manifest-first with fallback:
  * Prefer `--thread-ids-file docs/planning/phase-175/replay-case-manifest.json`.
  * Allow `--client-id <clientId>` fallback if manifest selection is empty.

## RED TEAM Findings (Gaps / Weak Spots)
### Highest-risk failure modes
* Clarifier spam loop due to missing bounded attempts and spacing enforcement -> add explicit `#1/#2` policy and cancel-on-inbound.
* LinkedIn clarify auto-send requested but system path currently unsupported -> extend `approveAndSendDraftSystem` with LinkedIn path via `sendLinkedInMessageSystem`.
* Multi-agent overwrite risk on already-modified timing/inbound files -> require pre-flight conflict checks + explicit conflict logs.

### Missing or ambiguous requirements
* No explicit replay manifest contract for phase-specific NTTAN validation -> add `docs/planning/phase-175/replay-case-manifest.json` and manifest-first replay commands.
* No requirement to capture replay diagnostic metadata -> require `judgePromptKey`, `judgeSystemPrompt`, and per-case `failureType` review in closeout notes.
* LinkedIn disconnect handling lacked explicit operator behavior -> lock fallback to manual + retained draft + deduped Slack warning.

### Repo mismatches (fix the plan)
* Prior context stated no-date path fails closed only; current code already creates clarify tasks/drafts and pauses follow-ups -> plan now treats anti-spam and side-effect removal as hardening of existing behavior.

### Performance / timeouts
* Added extraction budget in `lib/followup-timing-extractor.ts`, but replay requirements lacked manifest-driven sampling -> add manifest dry/live replay gates and optional baseline compare.

### Security / permissions
* Cron/webhook auth gates are out of scope for direct edits, but shared files are touched -> preserve existing secret checks and avoid widening route access semantics.

### Testing / validation
* Missing manifest-first NTTAN flow and missing diagnostics review checklist -> added as required validation outcomes.

## Objectives
* [x] Add a dedicated auto-send flag for timing-clarification follow-ups.
* [x] Implement attempt tracking and throttling for “ask for date” clarifiers (max attempts, min spacing).
* [x] Add an AI “soft deferral vs hard no” gate for Not Interested classification so we do not pester true hard-nos.
* [x] Add targeted tests and run NTTAN validation for AI/message/follow-up behavior changes.

## Constraints
* Do not fabricate a specific follow-up date when none is provided by the lead.
* The clarification message must explicitly ask for a timeframe (month/quarter/date) and be short enough for SMS constraints when applicable.
* Respect opt-outs and “do not contact” signals, and avoid repeated pings (attempt limits + throttling).
* Preserve channel safety and capability constraints (auto-send only where supported).
* Do not add Prisma schema changes for this phase; use existing `FollowUpTask` and `AIDraft` fields.

## Non-Goals
* Do not redesign sentiment taxonomy or replace the primary classifier.
* Do not refactor unrelated background-job/cron orchestration code.
* Do not introduce new FollowUpTask schema fields in this phase.
* Do not broaden admin or cron auth behavior.

## Success Criteria
* For follow-up-deferral replies with no concrete date, the system creates:
  * a timing-clarification follow-up task, and
  * an inbox-visible pending `AIDraft` that asks the lead for a concrete timeframe.
* Timing-clarification auto-send can be independently enabled/disabled via a dedicated flag.
* Clarification attempts are limited and throttled (no repeated pings in short windows).
* Attempt #2 is created after any successful send of attempt #1 and is scheduled with a 24-hour minimum spacing.
* Soft “Not Interested” deferrals can trigger the clarify flow, but hard-nos do not.
* `Not Interested` gate result `unclear` fails closed silently (no clarify send and no manual review task).
* Timing-clarification does not pause/snooze follow-up sequences (no `snoozedUntil` writes for clarify tasks).
* LinkedIn timing-clarifiers can be auto-sent when Unipile is configured and connected.
* If Unipile is disconnected at LinkedIn clarify send time, task converts to manual, draft remains pending, and one warning-level Slack alert is sent per client per 24h with client ID/name.
* No `max_output_tokens` truncation errors in timing extraction at typical volumes.
* Slack “Follow-Up Timing Not Scheduled” only fires for true exceptions:
  * cannot clarify by channel (call-only), or
  * unexpected failure creating the task/draft.
* NTTAN validation gates pass (required because AI drafts + message sending + cron follow-ups are in scope):
  * `npm run test:ai-drafts`
  * Primary (manifest-driven):
    * `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-175/replay-case-manifest.json --dry-run`
    * `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-175/replay-case-manifest.json --concurrency 3`
  * Fallback when manifest has no usable thread IDs:
    * `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
    * `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`
  * Replay closeout notes include:
    * `judgePromptKey`
    * `judgeSystemPrompt`
    * per-case `failureType` summary
  * If prior replay artifact exists, run baseline comparison:
    * `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-175/replay-case-manifest.json --baseline .artifacts/ai-replay/<prior-run>.json`

## Subphase Index
* a — Add `FOLLOWUP_TIMING_CLARIFY_AUTO_SEND_ENABLED`, enable LinkedIn system sending, and gate due-task sending appropriately
* b — Add attempt tracking + throttling, cancel-on-inbound behavior, remove clarify snoozing, and enroll into Re-engagement on exhaustion
* c — Add AI gate for Not Interested deferrals (soft deferral vs hard no) and integrate into inbound processing
* d — Tests, validation, and ops-signals review (including NTTAN)

## Phase Summary (running)
- 2026-02-20 — Subphase 175a implemented clarifier auto-send flag + LinkedIn system send + due-task gating, with ai-drafts validation; replay blocked by DB connectivity (files: `lib/followup-timing.ts`, `actions/message-actions.ts`, `.env.example`, `README.md`, `docs/planning/phase-175/a/plan.md`)
- 2026-02-20 — Subphases 175b/175c: cancel pending timing-clarifier attempt `#2` on any inbound reply; harden clarify attempt `#1` task upsert to avoid rare write failures; add Not Interested soft-deferral gate and route `Not Interested` deferrals into timing scheduling (files: `lib/followup-timing.ts`, `lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/email-inbound-post-process.ts`, `lib/background-jobs/sms-inbound-post-process.ts`, `lib/background-jobs/linkedin-inbound-post-process.ts`, `docs/planning/phase-175/b/plan.md`, `docs/planning/phase-175/c/plan.md`)
- 2026-02-20 — Product decisions locked: keep re-engagement delay at `7` days, keep `Objection` out of timing-reengage gate, and use hybrid attempt-2 copy (`sms` deterministic, `email`/`linkedin` AI with fallback) (files: `actions/message-actions.ts`, `docs/planning/phase-175/b/plan.md`, `docs/planning/phase-175/c/plan.md`)
- 2026-02-20 — Subphases 175d/175e complete: added targeted clarify regression tests, executed manifest-first and fallback NTTAN replay validations, captured replay prompt/failure diagnostics, executed baseline comparison (`improved=3, regressed=4`), and closed build/lint gates after TypeScript fixes (files: `lib/__tests__/followup-timing-clarify-phase175.test.ts`, `docs/planning/phase-175/d/plan.md`, `docs/planning/phase-175/e/plan.md`, `actions/message-actions.ts`, `lib/inbound-post-process/types.ts`)
- 2026-02-20 — Hardening pass from live Slack/Jam incidents: tripled follow-up timing prompt token budgets to reduce `max_output_tokens`; clarifier draft is now upserted/updated (prevents stale/duplicate drafts); and meeting-request availability selection now treats explicit timing windows (e.g. “second week of March”, explicit dates, time windows) as hard constraints and always excludes previously offered slots to avoid repeating times the lead already rejected (files: `lib/followup-timing-extractor.ts`, `lib/followup-timing.ts`, `lib/ai-drafts.ts`, `lib/__tests__/ai-drafts-clarification-guards.test.ts`).
* e — Manifest-driven replay hardening + conflict-log closeout requirements

## Assumptions (Agent)
* We can represent attempt lineage using `campaignName` suffixes (`#1`, `#2`) plus message/task history without adding schema fields. (confidence ~95%)
  * Mitigation check: if idempotency becomes fragile in implementation, add a follow-up phase for explicit attempt metadata fields.
* Not Interested deferral gating can run after sentiment classification in existing inbound processors without changing core classifier outputs. (confidence ~92%)
  * Mitigation check: if gate volume is high-latency, batch through existing background-job paths instead of inline calls.
* LinkedIn clarify auto-send eligibility should require both account presence and system-send success path parity with email/SMS task completion rules. (confidence ~93%)
  * Mitigation check: if LinkedIn provider instability rises, downgrade clarify LinkedIn tasks to manual by default.
