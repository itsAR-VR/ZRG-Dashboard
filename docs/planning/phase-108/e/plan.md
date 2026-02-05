# Phase 108e — Self-Learning Loop (Human-Approved Recommendations → Prompt/Asset Updates)

## Focus
Create a safe “self-learning” loop that uses the Message Performance findings to propose improvements, without automatic prompt mutation:
- suggestions derived from outcomes (setter vs AI; booked vs not)
- reviewed/approved by humans
- applied as prompt/asset changes with auditability

## Inputs
- Phase 108c synthesis recommendations (structured output).
- Existing editable surfaces:
  - Prompt overrides (`PromptOverride`, `PromptSnippetOverride`)
  - AI Personality fields (service description, goals, etc.)
  - Knowledge Assets (workspace-scoped)

## Work
1. **Define what can change automatically vs what must be reviewed:**
   - Default: everything is “proposal only” until a human approves.
2. **Convert recommendations into concrete proposals:**
   - Prompt snippet proposals (e.g., “use X CTA pattern in SMS”).
   - Knowledge Asset proposals (e.g., “add verified pricing phrasing guidelines”).
   - Confidence gate proposals (e.g., “treat pattern Y as safe-to-send if verified context exists”).
3. **Implement a human-review workflow:**
   - UI to accept/reject proposals.
   - Audit log of changes applied (who/when/what).
4. **Add measurement:**
   - Tie applied proposals to a time window for follow-up measurement.
   - Compare booking rates before/after for the affected segment.

## Output
- Proposal queue + approval/apply actions (`actions/message-performance-proposals.ts`).
- Proposal UI with approve/reject/apply in Message Performance panel.
- Proposal application writes prompt/asset revisions and retains audit trail.

## Handoff
Phase 108j adds history/rollback across prompt overrides + knowledge assets; Phase 108i validates end-to-end.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added proposal model + actions for approve/reject/apply (super admin only).
  - Wired proposal queue into Message Performance panel.
  - Proposal application writes prompt/snippet/asset revisions for auditability.
- Commands run:
  - `rg -n "MessagePerformanceProposal" prisma/schema.prisma` — verified schema additions.
- Blockers:
  - None.
- Next concrete steps:
  - Ensure rollback + history UI covers prompts and knowledge assets (Phase 108j).
