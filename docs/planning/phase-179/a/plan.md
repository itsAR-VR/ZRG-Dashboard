# Phase 179a — Investigation: Slack Signals vs Auto-Send Gates

## Focus
Determine why Slack notifications are firing for follow-up/scheduling related items, but outbound auto-sends are not happening (or are low quality), and produce a concrete repro set (IDs + replay manifest) for Founders Club.

## Inputs
- `docs/planning/phase-179/plan.md` (root context + constraints)
- Existing phases: `docs/planning/phase-175/`, `docs/planning/phase-176/`, `docs/planning/phase-177/`, `docs/planning/phase-178/`
- Slack alert sources:
  - `⚠️ Follow-Up Timing Not Scheduled` emitter in `lib/followup-timing.ts`
  - `⚠️ AI Draft Routed (Intentional Routing)` emitter in `lib/background-jobs/email-inbound-post-process.ts`

## Work
1. Build a “signal-to-action” map for FC:
   - Slack alert kind -> what should have happened:
     - timing miss vs intentional routing vs sentiment change
   - Identify which alerts are ops-only vs imply a missing system action.
2. Using Supabase MCP (or Prisma queries), pull a small repro set:
   - pending FollowUpTasks where `campaignName` indicates auto-send and `dueDate <= now` but status remains pending/manual.
   - AIDrafts tied to `followup_task:<id>` with statuses `pending/rejected` and any send failure logs.
   - Leads with sentiment `Meeting Booked` but no Appointment record.
3. Determine primary blockers:
   - env flags off (`FOLLOWUP_TASK_AUTO_SEND_ENABLED`, `FOLLOWUP_TIMING_CLARIFY_AUTO_SEND_ENABLED`)
   - schedule window gating in due processor
   - “recent conversation activity” gate self-blocking due to timing/race
   - campaign response mode mismatch (non-AI campaign but auto-send attempted)
   - `max_output_tokens` truncation causing downstream parse/route failures
4. Produce an explicit replay manifest:
   - 10–20 thread IDs covering each failure mode
   - ensure inclusion of: timing deferral w/out date, scheduling window request, lead-provided calendar link, false meeting booked

## Output
- Signal-to-action map (FC)
  - `⚠️ Follow-Up Timing Not Scheduled`:
    - Should create a timing-clarifier follow-up task + inbox-visible draft that asks for a concrete timeframe.
    - If auto-send is enabled, should auto-send Attempt #1 (timeframe-only) and later Attempt #2 (includes booking link).
  - `⚠️ AI Draft Routed (Intentional Routing)`:
    - Currently implies inbound draft generation was skipped because a scheduling flow created a follow-up task/draft.
    - This is valid only for true Follow Up timing/sequence routing; it is a regression when it suppresses Meeting Requested drafts (Phase 180 overlap).
- Root-cause matrix (primary blockers + evidence)
  - False `Meeting Booked` without provider evidence:
    - Evidence: Founders Club has many `Meeting Booked` leads with null provider IDs and zero `Appointment` rows (Supabase spot checks); screenshots show “reach out after 2:30 tomorrow” tagged as booked.
    - Fix: provider-evidence-only gate (Phase 179e) + prompt alignment (Phase 179e).
  - Meeting Requested draft suppression (“intentional routing”):
    - Evidence: `NotificationSendLog.kind='draft_skip'` entries exist for `sentiment_tag='Meeting Requested'` with dedupe keys including the inbound `messageId` (routed via `scheduling_followup_task`); compose can show low-quality `followup_task:*` drafts instead of normal inbound drafts.
    - Fix: restrict suppression to Follow Up only (Phase 180 dependency; coordinate during Phase 179 implementation to avoid conflicting behavior).
  - Follow-up timing due processor self-blocking:
    - Evidence: due-task logic can convert to manual due to “recent conversation activity” immediately after task creation (post-process/backfill messages count as activity).
    - Fix: grace-window + ignore AI/system activity (Phase 179f).
  - Auto-send for non-AI campaigns:
    - Evidence: setter reports of auto-replies in non-AI campaigns; existing gates appear inconsistent across follow-up-task sender vs inbound auto-send.
    - Fix: enforce `AI_AUTO_SEND` campaign response mode requirement in follow-up-task sender + centralized auto-send evaluator (Phase 179b/179f).
  - `max_output_tokens` truncation in post-process:
    - Evidence: Slack “Post-process error: hit max_output_tokens” observed in FC.
    - Fix: 3x budget/retry for in-scope extractors/drafts (Phase 179c).
- Repro IDs + replay manifest (for Phase 179d validation)
  - Manifest: `docs/planning/phase-179/replay-case-manifest.json`

## Handoff
Phase 179b should implement fixes targeting the top 2–3 blockers first (highest frequency + highest harm), using the repro set to validate. Coordinate with Phase 180 specifically for the Meeting Requested “intentional routing” suppression regression.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Determined Phase 179 subphases have plan-only content (no execution progress logged yet).
  - Created Phase 179 replay manifest by combining prior phase repro threads with newly observed FC failure-mode thread IDs (IDs only; no PII).
  - Captured an initial root-cause matrix and highlighted Phase 180 dependency (Meeting Requested draft suppression).
- Commands run:
  - `git status --porcelain` — noted dirty working tree with overlapping scheduling/auto-send changes
  - `ls -dt docs/planning/phase-* | head -10` — identified Phase 176–180 overlap set
- Blockers:
  - None for this subphase.
- Next concrete steps:
  - Execute Phase 179b/179e invariants first (provider-evidence-only Meeting Booked; Process 5 manual-only auto-send block; campaign gating).
  - Then execute Phase 179f reliability (grace-window; attempt #2 link policy) and Phase 179c token budget changes.
