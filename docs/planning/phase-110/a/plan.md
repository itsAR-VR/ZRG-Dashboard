# Phase 110a — Audit & De-dupe (Findings → Code/Phases)

## Focus
Turn the user-provided issue list into a verified status map (fixed/partial/open), anchored to current code and existing phase plans, so we only plan new work where it’s still needed.

## Inputs
- User issue list (disposition gaps, `send_outcome_unknown`, analytics window drift, Monday item IDs).
- Phase plans/reviews:
  - `docs/planning/phase-101/`
  - `docs/planning/phase-105/`
  - `docs/planning/phase-106/`
  - `docs/planning/phase-107/`
  - `docs/planning/phase-108/`
  - `docs/planning/phase-109/` (untracked)
- Current code touchpoints:
  - `actions/email-actions.ts`
  - `lib/email-send.ts`
  - `actions/message-actions.ts`
  - `lib/followup-engine.ts`
  - `actions/ai-draft-response-analytics-actions.ts`

## Work
1. Confirm repo state:
   - `git status --porcelain` (identify uncommitted/untracked work that may be “active”).
   - List last 10 phases by mtime and scan Purpose/Subphase Index for overlaps.
2. For each finding, produce a “status + evidence” record:
   - Missing disposition on idempotent send paths:
     - Verify email idempotent paths set `responseDisposition`.
     - Verify SMS idempotent paths set `responseDisposition` even when no parts pending.
     - Identify any remaining `approved` transitions that omit `responseDisposition` (notably follow-up engine).
   - `send_outcome_unknown`:
     - Verify draft transitions away from `sending` on `send_outcome_unknown`.
     - Verify stale-sending recovery is invoked from cron.
   - Analytics window drift:
     - Confirm current analytics action filters by `AIDraft.updatedAt`.
     - Confirm there is no alternative action already shipped that uses `Message.sentAt` or a dedicated disposition timestamp.
   - Monday item mapping:
     - Map each provided item ID to the phase(s) that planned/implemented it.
     - Note any “live-only verification pending” items (e.g., EmailBison threading, evaluator behavior).
3. Write the status matrix into the Phase 110 root plan context if anything changes from the initial snapshot.

## Output
- A verified status map (issue → fixed/partial/open) with file/plan references.
- A scoped list of remaining implementation tasks to execute in Phase 110b/110c.

## Handoff
If any residual disposition gaps remain, proceed to Phase 110b with exact file/line targets and a decision on how disposition should be computed in idempotent “message already exists” cases.

