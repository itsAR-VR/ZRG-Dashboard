# Phase 112a — Inventory + Unified Context Contract

## Focus
Define a single, explicit “LeadContextBundle/Pack” contract that every AI step (drafting, overseer, evaluator) can consume, so context is aggregated consistently instead of reassembled differently per call.

## Inputs
- Current pipeline implementation:
  - `lib/ai-drafts.ts`
  - `lib/meeting-overseer.ts`
  - `lib/auto-send-evaluator.ts`
  - `lib/auto-send-evaluator-input.ts`
  - `lib/inbound-post-process/pipeline.ts`
- Token budgeting + prompt runner:
  - `lib/ai/prompt-runner/runner.ts`
  - `lib/ai/token-budget.ts`
- Memory/knowledge:
  - `lib/lead-memory-context.ts`
  - `lib/knowledge-asset-context.ts`
- System understanding artifact:
  - `.claude/docs/ai/multi-agent-overseer/10x/session-1.md`

## Work
1. Pre-flight conflict check
   - Run `git status --porcelain` and confirm no unexpected edits to AI pipeline files.
   - Scan the last 10 phases for overlap (`docs/planning/phase-106`..`111`).

2. Inventory current context assembly and identify divergence points
   - Drafting: what “knowledge context” is passed to Step 1/2/3 and where lead memory is attached.
   - Overseer extract vs gate: what inputs they see and what is persisted.
   - Auto-send evaluator: what it sees (thread + verified workspace context) and what it does not see.

3. Define `LeadContextBundle` (typed contract) with explicit budgets and redaction policy
   - Candidate sections:
     - Thread transcript: last N messages (plus subject, channels), with stable formatting.
     - Verified workspace context: serviceDescription, goals, knowledge assets (token-budgeted).
     - Lead memory context: token-budgeted; redaction mode option.
     - Scheduling context: availability options, bookingLink, leadSchedulerLink.
     - Metadata: clientId/leadId/messageId/channel, timing info, token/byte stats.

4. Decide injection format
   - Preferred: structured JSON payload + small system prompt.
   - Alternative: markdown “context pack” for readability.
   - Hard rule: avoid duplicating the same data in multiple formats.

5. Decide “lead memory in evaluator” policy
   - Option A: include redacted memory in evaluator always.
   - Option B: include memory only for drafting/overseer; evaluator remains strict.
   - Document the decision and rationale.

## Output
- A short spec in this subphase doc that includes:
  - `LeadContextBundle` fields
  - budgets (max tokens per section)
  - formatting rules
  - redaction policy
  - which pipelines consume which parts

## RED TEAM Refinements (added 2026-02-05)

### R-1: Use `LeadContextBundle` naming (not `Pack`)
The `ContextPack` name is already used in `lib/insights-chat/` (6+ files: `InsightContextPackSynthesis`, `InsightContextPackStatus`, `contextPackMarkdown`). Use `LeadContextBundle` consistently to avoid confusion.

### R-2: Specify per-section vs universal budgets
The spec must state whether the shared builder uses one universal budget or per-consumer profiles. Current divergence:
- Drafting: ~1250 tokens for knowledge (5 × 1000 chars), 1200 tokens for memory
- Evaluator: 8000 tokens for knowledge (1600/asset), 0 tokens for memory

Recommendation: Define a `LeadContextBundleProfile` enum (`"draft" | "evaluator" | "gate"`) that pre-sets budgets per consumer, so consumers opt into a named profile rather than duplicating budget numbers.

### R-3: Explicitly map bundle sections to prompt template variables
The spec should document which bundle sections map to which prompt template variables:
- `bundle.serviceDescription` → `buildSMSPrompt({ serviceDescription })` / `buildEmailDraftStrategyInstructions({ serviceDescription })`
- `bundle.goals` → `buildSMSPrompt({ aiGoals })` / strategy prompt
- `bundle.knowledgeContext` → `knowledgeContext` parameter in both prompt builders
- `bundle.memoryContext` → appended to `knowledgeContext` (current behavior) or passed separately
- `bundle.availability` → `availability` parameter
- `bundle.bookingLink` → `bookingLink` parameter

This ensures 112b implementer knows exactly where each section injects.

### R-4: Decision point for overseer extraction context
Document whether `runMeetingOverseerExtraction` should receive any bundle sections. Currently it gets only `messageText` + `offeredSlots`. If extraction stays lean, note that explicitly so 112b doesn't accidentally wire it.

## Handoff
Phase 112b implements the shared context builder based on this contract and wires it into `lib/ai-drafts.ts` and `lib/meeting-overseer.ts` first.
