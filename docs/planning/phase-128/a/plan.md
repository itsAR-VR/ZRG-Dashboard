# Phase 128a — Booking Escalation: Fail-Open Drafting + Suppress Booking Instructions

## Focus
Remove the user-facing failure mode where **Compose with AI** (and auto-draft generation) returns `Human review required: max_booking_attempts_exceeded`, while keeping booking escalation as an internal “stop proposing times/links” signal.

## Inputs
- Root context + evidence: `docs/planning/phase-128/plan.md`
- monday.com item: `AI Bugs + Feature Requests` → `Inconsistent Cost Suggesstions` (`11211767137`)
- Jam repro: `https://jam.dev/c/4451d3ca-8102-48d6-b287-c85e2b16358b`
- Current code paths:
  - UI: `components/dashboard/action-station.tsx` (`Compose with AI` → `regenerateDraft(...)`)
  - Server action: `actions/message-actions.ts:regenerateDraft(...)`
  - Draft generator: `lib/ai-drafts.ts:generateResponseDraft(...)`
  - Booking injection: `lib/booking-process-instructions.ts:getBookingProcessInstructions(...)`

## Work

### Pre-flight (RED TEAM)
- Re-read `lib/ai-drafts.ts` before editing — Phase 123 has uncommitted changes adding `runId` return field and `DraftPipelineRun` artifact persistence. **Do not remove or regress Phase 123 fields/logic.**
- Confirm `DraftGenerationResult` type includes `runId?: string | null` (Phase 123 addition). Preserve it.

### Step 1 — Flip booking escalation from hard block to soft signal
In `lib/booking-process-instructions.ts:110-116`, change the `shouldEscalate` return:
```typescript
// BEFORE (blocks drafting):
return { instructions: null, requiresHumanReview: true, escalationReason: "max_booking_attempts_exceeded" };

// AFTER (soft signal, drafting continues):
return { instructions: null, requiresHumanReview: false, escalationReason: "max_booking_attempts_exceeded" };
```
One-line change: `requiresHumanReview: true` → `requiresHumanReview: false`.

### Step 2 — Handle escalation reason in `generateResponseDraft()`
In `lib/ai-drafts.ts:1688-1696`, replace the early-return error block:
```typescript
// BEFORE:
if (bookingResult.requiresHumanReview) {
  console.log(`[AI Drafts] Lead ${leadId} requires human review: ${bookingResult.escalationReason}`);
  return { success: false, error: `Human review required: ${bookingResult.escalationReason}` };
}

// AFTER:
if (bookingResult.escalationReason) {
  console.log(`[AI Drafts] Booking escalation active; suppressing booking instructions`, {
    leadId, channel, escalationReason: bookingResult.escalationReason,
  });
  bookingProcessInstructions = null;
  availability = [];  // Suppress time slot lists from prompt
  // bookingLink suppression handled below in prompt assembly
}
```

### Step 3 — Inject "manual scheduling only" instruction in prompt assembly
At the prompt assembly points (email ~line 2293, SMS equivalent, LinkedIn equivalent), when `bookingResult.escalationReason` is set, append:
```
SCHEDULING: Do not propose meeting times or booking links. If the lead asks about scheduling, ask for their preferred times and let the human rep handle it.
```
This replaces booking process instructions (which are already `null` from Step 2).

### Step 4 — Verify all callers benefit automatically
Since the fix is inside `generateResponseDraft()` and `getBookingProcessInstructions()`, all callers get the fix:
- Manual compose: `actions/message-actions.ts:regenerateDraft(...)` → calls `generateResponseDraft()` ✓
- Inbound pipeline: `lib/inbound-post-process/pipeline.ts:329` → calls `generateResponseDraft()` ✓
- Background jobs (email/sms/linkedin post-process) → call `generateResponseDraft()` ✓
No per-caller changes needed.

### Step 5 — Confirm auto-send is unaffected
- Auto-send evaluator in `lib/auto-send/orchestrator.ts` continues to run based only on confidence/threshold.
- Phase 123's 3-iteration revision loop is unaffected because booking escalation only suppresses prompt content, not evaluation confidence.
- No new gating, no hard block codes introduced.

## Validation (RED TEAM)
- `getBookingProcessInstructions()` returns `{ requiresHumanReview: false, escalationReason: "max_booking_attempts_exceeded" }` when max waves exceeded (not `requiresHumanReview: true`)
- `generateResponseDraft()` returns `{ success: true, draftId, content, runId }` when escalation is active (not `{ success: false, error: ... }`)
- Draft content does NOT contain time slots or booking links when escalation is active
- Phase 123's `DraftPipelineRun` artifact persistence still works correctly
- Auto-send evaluator in orchestrator is unaffected (no new hard block codes)

## Expected Output
- Compose-with-AI no longer errors with `Human review required: max_booking_attempts_exceeded`.
- Draft generation succeeds even when booking escalation is active, but booking suggestions (times/link) are suppressed.

## Expected Handoff
Proceed to Phase 128b to fix pricing consistency by ensuring the model always has a merged `serviceDescription` (persona + workspace settings) and is instructed to avoid price placeholders.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Flipped booking escalation from a hard drafting block to a soft signal by returning `requiresHumanReview: false` for `max_booking_attempts_exceeded`.
  - Made `generateResponseDraft()` fail-open when booking escalation is active:
    - No longer returns `{ success:false, error: "Human review required: ..." }`.
    - Suppresses booking nudges by clearing `availability` and forcing `bookingLink=null`.
    - Adds a prompt appendix instructing the model not to propose times/booking links (unless lead explicitly provided their own scheduler link, which already has its own override).
- Commands run:
  - `rg -n "Human review required|max_booking_attempts_exceeded|requiresHumanReview" ...` — located the blocking early return and escalation site
  - `sed -n ... lib/booking-process-instructions.ts` / `lib/ai-drafts.ts` — verified exact edit locations
- Blockers:
  - None
- Next concrete steps:
  - Execute Phase 128b (serviceDescription merge + pricing placeholder sanitization).

## Output
- Code changes:
  - `lib/booking-process-instructions.ts` — changed `max_booking_attempts_exceeded` path to return `requiresHumanReview: false` (keeps `escalationReason`).
  - `lib/ai-drafts.ts` — removed the early return that blocked drafting; introduced `bookingEscalationReason` handling that suppresses availability + booking link and appends explicit “no times/links” instructions to prompts.
- Coordination notes:
  - Preserved Phase 123 working-tree additions in `lib/ai-drafts.ts` (e.g., `runId` return field + `DraftPipelineRun` artifact persistence). No schema/workflow changes introduced by Phase 128a.

## Handoff
Proceed to `docs/planning/phase-128/b/plan.md` to implement pricing consistency:
- Always merge `serviceDescription` from persona + workspace settings (at call site in `generateResponseDraft`).
- Add placeholder pricing suppression in `sanitizeDraftContent()`.
