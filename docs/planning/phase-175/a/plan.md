# Phase 175a — Clarifier Auto-Send Flag (Dedicated Control)

## Focus
Introduce a separate configuration switch for timing-clarification follow-up messages so they can be auto-sent (or not) independently from general follow-up task auto-send behavior. Also enable LinkedIn system send for drafts so cron can auto-send LinkedIn clarifiers when Unipile is connected.

## Inputs
* Phase 174 timing extractor + “no date fails closed” behavior
* Current timing-clarification draft/task routing implementation in `lib/followup-timing.ts`
* Due follow-up task processing in `lib/followup-timing.ts` and `lib/followup-engine.ts`
* Existing env/config patterns for follow-up auto-send gating

## Work
1. Add env var `FOLLOWUP_TIMING_CLARIFY_AUTO_SEND_ENABLED` (default off unless explicitly enabled).
2. Add helper `isFollowUpTimingClarifyAutoSendEnabled()` in `lib/followup-timing.ts` (or a nearby shared config module) to parse the new env var.
3. Update timing-clarification campaign selection in `lib/followup-timing.ts`:
* Clarifier is `(auto)` only when both:
  * `FOLLOWUP_TASK_AUTO_SEND_ENABLED=1`, and
  * `FOLLOWUP_TIMING_CLARIFY_AUTO_SEND_ENABLED=1`.
* Otherwise clarifier is `(manual)`.
4. Update due-task sending in `lib/followup-timing.ts` (`processScheduledTimingFollowUpTasksDue`) so:
* It only processes scheduled follow-up `(auto)` tasks when `FOLLOWUP_TASK_AUTO_SEND_ENABLED=1`.
* It only processes timing-clarification `(auto)` tasks when both flags are enabled.
5. Enable LinkedIn system sending so cron can auto-send LinkedIn tasks:
* Implement LinkedIn handling in `actions/message-actions.ts` (`approveAndSendDraftSystem`) by calling `sendLinkedInMessageSystem` from `lib/system-sender.ts`.
* Ensure LinkedIn system-send:
  * marks the draft `approved`,
  * persists the outbound message (already done in `sendLinkedInMessageSystem`), and
  * completes the linked follow-up task when `triggerMessageId` is `followup_task:<taskId>`.
6. Update `processScheduledTimingFollowUpTasksDue` to allow `task.type === "linkedin"` when:
* Unipile is configured for the client (`client.unipileAccountId` exists), and
* the new clarifier auto-send flag is enabled.
* On due-time LinkedIn clarifier send failure due to Unipile disconnect/unconfigured account:
  * convert the task to manual, and
  * keep the draft pending for setter intervention.
7. Update env docs:
* `.env.example` add `FOLLOWUP_TIMING_CLARIFY_AUTO_SEND_ENABLED`.
* `README.md` update env var docs table if present.

## Output
* Dedicated timing-clarification auto-send flag exists, is documented, and controls sending behavior without affecting other follow-up tasks.
* Cron can auto-send LinkedIn drafts (including timing-clarifiers) when Unipile is configured.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added `FOLLOWUP_TIMING_CLARIFY_AUTO_SEND_ENABLED` env var and threaded it into timing-clarification task campaign selection (auto vs manual).
  - Updated due-task processor to only include timing-clarification auto campaigns when `FOLLOWUP_TIMING_CLARIFY_AUTO_SEND_ENABLED=1`.
  - Enabled LinkedIn system sending in `approveAndSendDraftSystem` by calling `sendLinkedInMessageSystem`, so cron can auto-send LinkedIn drafts and complete the linked follow-up task.
  - Documented the new env var in `.env.example` and `README.md`.
- Commands run:
  - `npm run test:ai-drafts` — pass
  - `npm run test:ai-replay -- --client-id 00000000-0000-0000-0000-000000000000 --dry-run --limit 2` — fail (blocked: DB connectivity). Artifact: `.artifacts/ai-replay/run-2026-02-20T06-32-10-893Z.json`
    - judgePromptKey: `meeting.overseer.gate.v1`
    - failureTypeCounts: infra_error=1 (others 0)
  - `npm run test:ai-replay -- --client-id 00000000-0000-0000-0000-000000000000 --limit 2 --concurrency 3` — fail (blocked: DB connectivity). Artifact: `.artifacts/ai-replay/run-2026-02-20T06-32-33-778Z.json`
    - judgePromptKey: `meeting.overseer.gate.v1`
    - failureTypeCounts: infra_error=2 (others 0)
- Blockers:
  - DB connectivity failure from Prisma (`Can't reach database server at db.pzaptpgrcezknnsfytob.supabase.co`) blocks `test:ai-replay` selection + run.
- Next concrete steps:
  - Implement attempt tracking + throttling and cancel-on-inbound behavior (Phase 175b).
  - After DB connectivity is restored, rerun NTTAN replay commands against a real workspace client ID.

## Handoff
Proceed to Phase 175b to prevent repeated clarifier pings by adding attempt tracking + throttling.
