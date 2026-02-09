# Phase 121c — Auto-Book Gating Hardening (Generic Acceptance + Proposed-Time Trigger)

## Focus
Prevent auto-booking from misinterpreting inbound emails as acceptance when they are not scheduling-related. Keep generic acceptance enabled but constrain it to low-risk cases. Tighten proposed-time trigger heuristics to avoid parsing on common business phrases.

## Inputs
- Root context: `docs/planning/phase-121/plan.md`
- Booking logic: `lib/followup-engine.ts:processMessageForAutoBooking()` at line 3180
- Meeting overseer extraction: `lib/meeting-overseer.ts` (intent + acceptance specificity)
- Generic acceptance branch: `lib/followup-engine.ts` line 3342 (`overseerDecision?.acceptance_specificity === "generic"`)
- Scenario 3 time proposal: `lib/followup-engine.ts` line 3638-3644 (`looksLikeTimeProposal`)
- OfferedSlot interface: `lib/booking.ts` line 26 (includes `offeredAt: string`)

## Work
1. Generic acceptance constraints in `lib/followup-engine.ts` (around line 3342):
   - Current code:
     ```typescript
     if (!acceptedSlot && overseerDecision?.acceptance_specificity === "generic") {
       acceptedSlot = offeredSlots[0] ?? null;
     }
     ```
   - Replace with guarded version. Extract a pure helper for testability:
     ```typescript
     export function isLowRiskGenericAcceptance(opts: {
       messageTrimmed: string;
       offeredSlots: OfferedSlot[];
       overseerDecision: MeetingOverseerExtractDecision;
     }): boolean {
       const { messageTrimmed, offeredSlots, overseerDecision } = opts;
       // Must be scheduling-related
       if (!overseerDecision.is_scheduling_related) return false;
       // Must have offered slots
       if (offeredSlots.length === 0) return false;
       // Offered slots must be fresh (within 7 days)
       const freshCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
       const hasFreshSlot = offeredSlots.some(s => Date.parse(s.offeredAt) > freshCutoff);
       if (!hasFreshSlot) return false;
       // Message must be short (acknowledgement-like)
       const words = messageTrimmed.split(/\s+/).filter(Boolean);
       if (words.length > 15) return false;
       if (messageTrimmed.length > 200) return false;
       // Must not contain hard negatives
       const hardNegative = /\b(not interested|no thanks|stop|unsubscribe|remove|decline|pass|not looking|cancel)\b/i;
       if (hardNegative.test(messageTrimmed)) return false;
       return true;
     }
     ```
   - At line 3342, replace with:
     ```typescript
     if (!acceptedSlot && overseerDecision?.acceptance_specificity === "generic") {
       if (isLowRiskGenericAcceptance({ messageTrimmed, offeredSlots, overseerDecision })) {
         acceptedSlot = offeredSlots[0] ?? null;
       }
     }
     ```
2. Tighten Scenario 3 `looksLikeTimeProposal` (line 3641):
   - Current: `/\b(tomorrow|today|next week|next)\b/i` — bare `\bnext\b` matches "next steps", "next quarter", etc.
   - Replace with: `/\b(tomorrow|today|next week)\b/i` — remove bare `next`.
   - The weekday regex on line 3640 already catches "next Monday" etc. via the day names.
3. Unit tests for `isLowRiskGenericAcceptance`:
   - "Yes" with fresh offered slots → true
   - "Yes" with stale offered slots (8+ days old) → false
   - "Not interested, but thanks" with fresh slots → false (hard negative)
   - Long paragraph (>15 words) with fresh slots → false
   - "Sounds good" with `is_scheduling_related: false` → false
   - "next steps to finalize the deal" → `looksLikeTimeProposal` is false (bare `next` removed)
   - "next week works" → `looksLikeTimeProposal` is true (`next week` still matches)

## Validation (RED TEAM)
- `npx jest` — new gating tests pass.
- Verify: generic "Yes" after 8-day-old offered slots does NOT auto-book.
- Verify: "next steps" does NOT trigger Scenario 3 time proposal parsing.
- Verify: short "Sounds good" after fresh offered slots still auto-books (happy path preserved).

## Output
- Auto-booking cannot be triggered by long/non-scheduling inbound replies.
- Generic acceptance still works in the narrow "short yes to recent offered slots" case.
- Proposed-time parsing is not invoked for generic "next" business language.

## Handoff
Proceed to Phase 121d to apply defense-in-depth in the inbound post-process pipeline by re-stripping quoted sections right before auto-booking, and run validation.
