# Phase 66a — Deprecate "No Response" Auto-Start (Keep Outbound-Touch Scheduling)

## Focus
Disable **auto-starting new** "No Response Day 2/5/7" instances while preserving the existing outbound-touch behavior that:
- resets follow-up timing on human outbound touches (so cron doesn’t overlap with manual nurturing), and
- resumes eligible paused instances on outbound touches (per existing policy).

This subphase must not “blanket no-op” `autoStartNoResponseSequenceOnOutbound()` because the function currently does more than start no-response sequences.

## Inputs
- Current implementation in `lib/followup-automation.ts`: `autoStartNoResponseSequenceOnOutbound()` (contains outbound-touch logic + new-instance creation)
- Call sites (verify with `rg`): `autoStartNoResponseSequenceOnOutbound` is invoked from multiple outbound entrypoints (dashboard sends + webhooks + backfills)
- Phase 66 decision: No Response is deprecated; no new instances should ever auto-start again

## Work

### Step 1: Split “outbound-touch scheduling” from “no-response auto-start”
In `lib/followup-automation.ts`, extract the scheduling/reset/resume logic into a new exported function:

```ts
export async function handleOutboundTouchForFollowUps(opts: {
  leadId: string;
  outboundAt?: Date;
}): Promise<{ updated: boolean; reason?: string; resetCount?: number; resumedCount?: number }>;
```

Implementation guidance:
- Move the existing logic that:
  - detects active instances and resets `nextStepDue` on *human* outbound
  - resumes paused instances when policy allows
- Ensure `shouldTreatAsOutreachSequence(...)` continues to exclude response-driven sequences (Meeting Requested / Post-Booking / meeting_selected).

### Step 2: Make `autoStartNoResponseSequenceOnOutbound()` a safe wrapper (no new instance creation)
Update `autoStartNoResponseSequenceOnOutbound()` so it:
1) calls `handleOutboundTouchForFollowUps(...)`, and then
2) **does not** create any new no-response instance.

Example return shape:

```typescript
export async function autoStartNoResponseSequenceOnOutbound(opts: {
  leadId: string;
  outboundAt?: Date;
}): Promise<{ started: boolean; reason?: string }> {
  await handleOutboundTouchForFollowUps({ leadId: opts.leadId, outboundAt: opts.outboundAt }).catch(() => undefined);
  return { started: false, reason: "auto_start_disabled" };
}
```

### Step 3: Keep call sites (optional cleanup later)
Do **not** remove call sites in this phase. They are still needed for outbound-touch scheduling behavior.

Instead, rely on the new behavior of `autoStartNoResponseSequenceOnOutbound()` (wrapper + no new instance creation).
Optionally, in later cleanup, rename call sites to `handleOutboundTouchForFollowUps()` for clarity.

### Step 4: Repo-wide verification
Run:
- `rg -n "autoStartNoResponseSequenceOnOutbound" -S .`

Confirm:
- calls remain, but no code path creates a new no-response instance (that creation block is removed/disabled)
- outbound-touch schedule reset/resume behavior remains intact for existing sequences

## Output
- Implemented in working tree (uncommitted):
  - Extracted outbound-touch scheduling into `handleOutboundTouchForFollowUps()` and updated `autoStartNoResponseSequenceOnOutbound()` to never create new No Response instances.
  - Extended `startSequenceInstance(..., { startedAt })` to support reply-timestamp-anchored scheduling (used by Phase 66c).
  - Added `MEETING_REQUESTED_SEQUENCE_NAME` constant for shared lookup.
- Evidence: `docs/planning/phase-66/review.md`

## Handoff
Phase 66b removes sentiment-based Meeting Requested auto-start (all inbound entrypoints).
