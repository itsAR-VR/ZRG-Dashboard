# Phase 108f — Multi-Agent Overseer Orchestration (4-agent loop)

## Focus
Orchestrate the Drafting → Memory → Overseer Gate → Finalizer loop so that scheduling-related drafts are reviewed and refined before auto-send/booking, while preserving existing safety gates and channel formatting rules.

## Inputs
- Existing meeting overseer logic:
  - `lib/meeting-overseer.ts` (extract + gate + persistence)
  - `lib/ai/prompt-registry.ts` (overseer prompt templates)
- Draft generation path:
  - `lib/ai-drafts.ts` (post-draft verification + overseer gate)
- Auto-booking and followup logic (coordination only):
  - `lib/followup-engine.ts`
- Phase 106/107 modifications in working tree (overseer + draft gating already touched).

## Work
1. **Define the orchestration contract** (lightweight, server-only):
   - Inputs: `clientId`, `leadId`, `triggerMessageId`, `channel`, `latestInbound`, `draft`, `availability`, `bookingLink`, `leadSchedulerLink`, `memoryContext?`, `timeoutMs`.
   - Outputs: `finalDraft`, plus which stages modified the draft.
2. **Extend overseer gate to accept `memoryContext`** (optional):
   - Include memory context in the gate prompt (if provided).
   - Keep behavior unchanged when memory is empty.
3. **Wire AI drafts to the orchestration path**:
   - Pass `memoryContext` placeholder (Phase 108g will populate).
   - Preserve existing verifier + sanitization steps.
4. **Keep safe defaults**:
   - No change in behavior when memory context is empty.
   - Do not log raw message bodies or memory in console output.

## Validation (RED TEAM)
- Typecheck/compile: `npm run build` (after implementation; may be deferred if other phases’ changes are pending).
- Manual smoke: scheduling-related inbound → draft generated → overseer gate still runs and returns revised draft when needed.

## Output
- Orchestration path exists and is wired from `lib/ai-drafts.ts`.
- Overseer gate accepts `memoryContext` safely (no behavior change when empty).

## Handoff
Phase 108g will supply real lead memory context (Postgres) and tighten the memory stage.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added optional `memoryContext` support to the meeting overseer gate prompt.
  - Wired the AI draft gate call to pass a memory context placeholder (no behavior change when empty).
- Commands run:
  - `rg "meeting overseer|overseer" -n lib app actions prisma` — located overseer touch points
  - `rg "runMeetingOverseerGate" -S` — confirmed call sites
- Blockers:
  - Real lead memory context not yet implemented (Phase 108g) → memory step remains empty for now.
- Coordination notes:
  - Touched files already modified in Phase 106/107 working tree (`lib/meeting-overseer.ts`, `lib/ai-drafts.ts`, `lib/ai/prompt-registry.ts`); re-read before additional edits.
- Next concrete steps:
  - Define lead memory retrieval contract and populate `memoryContext`.
  - Decide whether to add an explicit finalizer pass beyond existing sanitization.
