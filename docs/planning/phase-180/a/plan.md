# Phase 180a — Investigation + Contract Lock

## Focus
Confirm exactly why Meeting Requested threads are being “routed” away from normal inbound draft generation, then lock the routing/draft contract so implementation is unambiguous and minimal.

## Inputs
- Screenshot + report from this thread: Meeting Requested → Slack `AI Draft Routed (Intentional Routing)` → compose shows a generic clarification.
- Current code:
  - `lib/background-jobs/email-inbound-post-process.ts`
  - `lib/background-jobs/sms-inbound-post-process.ts`
  - `lib/background-jobs/linkedin-inbound-post-process.ts`
  - `lib/inbound-post-process/pipeline.ts`
  - `lib/followup-engine.ts` (`processMessageForAutoBooking`)
  - `lib/followup-task-drafts.ts`
  - `lib/auto-send/orchestrator.ts`
- Overlapping phases for semantics (do not fork behavior silently):
  - Phase 176, 178, 179

## Work
1. Pre-flight conflict check:
   - Run `git status --porcelain` and list the exact overlapping modified files.
   - Re-read the latest versions of the files in scope (do not rely on cached assumptions).
2. Confirm suppression trigger:
   - Trace the current `schedulingHandled` / intentional routing logic in each inbound processor.
   - Confirm which fields cause suppression for Meeting Requested:
     - `autoBook.context.followUpTaskCreated`
     - `timingFollowUpScheduled`
     - presence of pending `AIDraft.triggerMessageId startsWith "followup_task:"`
3. Confirm compose draft selection risk:
   - Identify how the UI selects the “active” draft when multiple pending drafts exist (normal draft vs `followup_task:*` draft).
   - Lock the requirement: Meeting Requested must not result in multiple competing pending drafts.
4. Capture stable replay IDs (no PII):
   - Using DB/admin access, find at least one affected thread and record:
     - `clientId`, `leadId`, and the inbound `messageId` that triggered the routed alert.
   - Create `docs/planning/phase-180/replay-case-manifest.json` with the thread/message IDs (IDs only).

## Output
- Written contract for Phase 180 implementation:
  - Meeting Requested: never suppress inbound draft generation; never create booking `followup_task:*` drafts.
  - Follow Up: intentional routing allowed only for timing/sequence tasks.
  - Call Requested: draft yes; auto-send no.
- `docs/planning/phase-180/replay-case-manifest.json` (IDs only).

## Handoff
Proceed to Phase 180b to implement the routing suppression changes across inbound processors.

