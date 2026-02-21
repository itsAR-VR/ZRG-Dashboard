# Phase 181c — Reply Generation by Channel (Deferral Copy + Link Policy)

## Focus
Generate policy-compliant deferral replies across channels while maintaining existing tone/safety constraints.

## Inputs
- Output from Phase 181b.
- Existing message generation paths:
  - `actions/message-actions.ts`
  - `lib/ai-drafts.ts`
  - channel-specific post-process flows.

## Work
1. Implement channel split:
   - SMS: deterministic short template.
   - Email/LinkedIn: AI-generated with hard constraints/invariants.
2. Enforce required content for deferral replies:
   - unavailable yet for requested future window,
   - commitment to follow up one week before,
   - booking link included (where channel policy permits).
3. Handle coordinator mentions (for example, "Karla to coordinate") without suppression: same deferral contract + lead-facing response.
4. Add invariant checks to block accidental slot-offering in deferral mode.

## Output
- Stable reply-generation behavior for deferral mode with channel-appropriate formatting and required messaging.

## Handoff
Phase 181d wires deferred task lifecycle so promised follow-up actually occurs automatically.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented channel split for deferral reply generation:
    - SMS: deterministic template with required policy content.
    - Email/LinkedIn: AI generation via `followup.future_window_deferral.v1` with deterministic fallback.
  - Enforced required copy constraints in generation path:
    - explicitly not available yet for requested window,
    - one-week-prior follow-up commitment,
    - booking link inclusion when available.
  - Added deterministic recontact copy builder used by due-task refresh logic.
- Commands run:
  - Code implementation pass in `lib/followup-timing.ts`.
- Blockers:
  - none
- Next concrete steps:
  - Replay and fixture checks for copy invariants in phase 181f.
