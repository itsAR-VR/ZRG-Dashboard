# Phase 175d — Tests, Validation, and Ops Signals Review (NTTAN)

## Focus
Lock in behavior with tests and run the required AI/message validation suite so we can ship without regressions.

## Inputs
* Phase 175a flag behavior
* Phase 175b attempt policy
* Phase 175c Not Interested gate

## Work
1. Add/extend tests (unit-first; minimal integration where helpful):
* Clarifier creation:
  * No concrete date => creates FollowUpTask `Follow-up timing clarification ... #1` and `AIDraft(triggerMessageId=followup_task:<id>)`.
  * Verify: no writes to `lead.snoozedUntil` for this path.
* Flag behavior:
  * With `FOLLOWUP_TIMING_CLARIFY_AUTO_SEND_ENABLED=0`, clarifier task is manual and due-task processor does not send it.
  * With both auto flags on, clarifier task is auto and due-task processor attempts send (schedule-gated).
* LinkedIn:
  * `approveAndSendDraftSystem` can system-send LinkedIn drafts when Unipile is configured.
* Attempts:
  * Any successful send of attempt #1 (auto or manual approval path) creates attempt #2 with `dueDate = sentAt + 24h`.
  * Any inbound reply cancels attempt #2 task and rejects its draft.
* Not Interested gate:
  * `deferral` => clarifier created.
  * `hard_no` => no clarifier created.
  * `unclear` => no clarifier, no manual-review task, no Slack noise.
* Exhaustion:
  * After attempt #2 send, enroll into “Re-engagement Follow-up” with a delayed start anchor.
  * Delay anchor is 3 days after attempt #2 send.
  * If sequence missing/inactive, create manual task instead.
* LinkedIn disconnect fallback:
  * Unipile disconnected at due-time converts LinkedIn clarify task to manual and keeps the draft pending.
  * Sends warning-level Slack notification with client ID + client name, deduped to once/client/24h.
2. Review Slack/ops signals:
* Confirm the old noisy alert “Follow-Up Timing Not Scheduled” is only emitted when we truly cannot clarify (call-only) or fail to create the task/draft.
* Ensure attempt exhaustion does not spam Slack (we are switching sequences instead).
3. Run required validations (NTTAN):
* `npm run test:ai-drafts`
* Primary (manifest-first):
  * `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-175/replay-case-manifest.json --dry-run`
  * `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-175/replay-case-manifest.json --concurrency 3`
* Fallback when manifest selection is empty:
  * `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
  * `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`
* Replay closeout diagnostics:
  * capture `judgePromptKey` and `judgeSystemPrompt`
  * summarize per-case `failureType`

## Output
* Added targeted regression suite:
  * `lib/__tests__/followup-timing-clarify-phase175.test.ts`
  * Coverage includes:
    * re-engagement delay remains 7 days,
    * hybrid attempt-2 copy behavior (`sms` deterministic, `email/linkedin` AI+fallback),
    * cancel-attempt-2-on-inbound hook in all inbound processors,
    * `Not Interested` soft-deferral routing into timing scheduler,
    * no-date clarify branch task upsert fallback behavior,
    * gate prompt contract key.
* Validation commands executed:
  * `node --conditions=react-server --import tsx --test lib/__tests__/followup-timing-clarify-phase175.test.ts` -> PASS (6/6)
  * `npm run test:ai-drafts` -> PASS
  * Manifest-first replay (initial state): `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-175/replay-case-manifest.json --dry-run` -> FAIL expected (manifest initially had empty thread list; requires `--client-id` fallback path)
  * Fallback replay dry-run: `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20` -> PASS (20 selected)
  * Fallback replay live: `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3` -> PASS
    * Artifact: `.artifacts/ai-replay/run-2026-02-20T07-19-11-333Z.json`
    * Summary: evaluated=17, passed=17, failedJudge=0, critical invariants=0
* Build/lint gates:
  * `npm run lint` -> PASS (warnings only, pre-existing)
  * `npm run build` -> PASS after TypeScript fixes in:
    * `actions/message-actions.ts` (remove non-Prisma promise from transaction array)
    * `lib/inbound-post-process/types.ts` (add new pipeline stage literal)

## Handoff
Phase 175d complete. Replay-hardening and baseline-diff closeout details are captured in `docs/planning/phase-175/e/plan.md`.
