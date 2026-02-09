# Phase 123c — Weighted Revision Context Pack + Revision-Agent Integration

## Focus
Implement a deterministic context builder that assembles the highest-signal artifacts into a weighted "revision context pack", then inject that pack into the revision agent so it can reliably fix the "why confidence is low" issue first.

## Inputs
- Phase 123b persisted artifacts (iteration=0 baseline)
- `getArtifactsForRun()` from `lib/draft-pipeline/queries.ts`
- Existing context sources:
  - `LeadContextBundle` (`lib/lead-context-bundle.ts`) — profiles + token budgets
  - Auto-send evaluation output format (`lib/auto-send-evaluator.ts`)
  - Optimization context selector (`lib/auto-send/optimization-context.ts`)
- Existing revision agent (`lib/auto-send/revision-agent.ts`)

## Work

### 1. Add "revision" LeadContextBundle profile
In `lib/lead-context-bundle.ts`, add profile:
```ts
revision: { knowledge: { maxTokens: 3000 }, memory: { maxTokens: 800 } }
```
This keeps the bundle cheap while providing sufficient knowledge/memory context for revision.

### 2. Implement `buildDraftRunContextPack()`
New file: `lib/draft-pipeline/context-pack.ts`

Function signature:
```ts
buildDraftRunContextPack({
  runId: string,
  iteration: number,
  profile: "revision",
  evaluationResult: AutoSendEvaluation,
  leadContextBundle: LeadContextBundle,
  optimizationContext?: AutoSendOptimizationSelection | null,
}): DraftRunContextPack
```

#### Token budget allocation (total ~10,000 tokens):
- **Primary (60%, ~6000 tokens):** Highest weight, first in prompt
  - Current draft text to revise
  - Evaluator confidence score + threshold + reason codes
  - Hard-block codes (when present)
  - Most recent overseer gate decision and rationale (if it revised the draft)
- **Secondary (30%, ~3000 tokens):**
  - Step 1 strategy distilled summary (intent/CTA/constraints/archetype id)
  - Knowledge context from bundle (token-bounded)
  - Redacted lead memory context from bundle (token-bounded)
  - Optimization context (`what_to_apply`, `what_to_avoid`) — loaded once at loop start, reused across iterations
- **Tertiary (10%, ~1000 tokens):**
  - Prompt keys + model ids + archetype id
  - Run metadata (runId, iteration number)

#### Truncation rules:
- If total exceeds budget, truncate tertiary first, then secondary, then primary
- Primary section is never truncated below evaluator reason + draft text
- Return `stats: { primaryTokens, secondaryTokens, tertiaryTokens, totalTokens }` for telemetry

### 3. Optimization context selector integration
`selectAutoSendOptimizationContext()` is called **once** at the start of the loop (before iteration 1) and its output is included in the context pack's secondary section for all iterations. It is NOT called per-iteration (too expensive + results don't change within a single loop).

### 4. Evaluate overseer gate prompt for revision context
Check whether the existing `meeting.overseer.gate.v1` prompt works correctly when given a mid-loop revised draft (vs the original post-generation draft it was designed for).
- If it works: reuse existing prompt key
- If it doesn't: add a new `meeting.overseer.revision_gate.v1` prompt key with revision-aware instructions
- Document the decision in this plan's Output section

### 5. Revision agent prompt changes
In `lib/auto-send/revision-agent.ts`:
- Accept `runId: string | null` and `iteration: number` as new parameters
- When `runId` is present, replace ad-hoc inputs with the weighted context pack sections (explicit ordering: primary → secondary → tertiary)
- When `runId` is null (fail-open/degraded mode), fall back to existing behavior (ad-hoc inputs)
- Ensure telemetry metadata remains stats-only (no raw text in `AIInteraction.metadata`)

### 6. Unit tests
- Pack ordering: primary section always includes evaluator reason + draft text when available
- Truncation: verify tertiary drops first, primary is never empty
- Budget: total tokens within 10% of target budget
- Degraded mode: revision agent works correctly when `runId` is null

## Validation (RED TEAM)
- Unit tests pass for pack building and truncation
- Existing revision agent tests still pass (no regression)
- `npm run build` passes (new types are compatible)
- Manual check: create a draft with low confidence, verify the context pack includes all expected sections in correct order

## Expected Output
- Revision agent receives a consistent, high-signal context pack that emphasizes low-confidence reasons + current draft content.
- Context pack builder is deterministic and bounded (no unbounded prompt growth).
- `LeadContextBundle` has a new "revision" profile.
- Decision documented: whether existing overseer gate prompt works for revision context or a new prompt key was needed.

## Expected Handoff
Phase 123d uses this pack and adds the 3-iteration overseer ↔ revision loop with resumable/idempotent iteration artifacts.

## Output
- Added a dedicated LeadContextBundle profile for revision:
  - `lib/lead-context-bundle.ts` — new `revision` profile (knowledge + redacted memory budgets tuned for revision).
- Added a deterministic draft-run context pack builder for revision prompts:
  - `lib/draft-pipeline/context-pack.ts` — `buildDraftRunContextPack()` + `renderDraftRunContextPackMarkdown()`
  - Primary emphasis: evaluator feedback + current draft; secondary: Step 1 strategy + knowledge + redacted memory; tertiary: run metadata.
- Threaded `draftPipelineRunId` through auto-send context so the revision agent can load draft-run artifacts:
  - `lib/auto-send/types.ts` — `draftPipelineRunId?: string | null`
  - `lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/email-inbound-post-process.ts`, `lib/background-jobs/sms-inbound-post-process.ts` — pass `draftResult.runId ?? null`
- Integrated the context pack into the revision agent and aligned it with loop semantics:
  - `lib/auto-send/revision-agent.ts`:
    - Supports `iteration` and (when runId is present) injects `context_pack_markdown` into the reviser prompt input.
    - Uses per-workspace `autoSendRevisionModel` + `autoSendRevisionReasoningEffort` (best-effort load; falls back safely).
    - Loop-mode retry-safety: persists per-iteration artifacts (`auto_send_evaluation`, `auto_send_revision_selector`, `auto_send_revision_reviser`, `loop_error`) and reuses cached iteration results to avoid duplicate LLM calls on background job retries.
- Verified:
  - `npm test` passes
  - `npm run build` passes

## Handoff
Proceed to Phase 123d to orchestrate the bounded 3-iteration evaluator↔revision loop in `lib/auto-send/orchestrator.ts` (email channel path), using `iteration=1..3` and stopping early when confidence crosses the threshold.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented the revision context pack and wired it into the revision agent (with per-iteration artifact persistence and cache reuse when runId is available).
  - Threaded `draftPipelineRunId` through auto-send execution context so revision can load artifacts reliably.
- Commands run:
  - `npm test` — pass
  - `npm run build` — pass
- Blockers:
  - None
- Next concrete steps:
  - Replace the single-pass revision call in `lib/auto-send/orchestrator.ts` with the bounded 3-iteration loop (email-only), and add orchestrator unit tests for loop behavior.
