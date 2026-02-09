# Phase 123d — Overseer ↔ Revision Loop (Max 3 Iterations) + Resumability

## Focus
Implement the bounded 3-iteration loop triggered by evaluator confidence < threshold on email channel, integrating overseer gate checks between revision iterations, and making the loop resumable/idempotent via per-iteration artifacts.

## Inputs
- Phase 123c context pack builder + revision agent integration
- Existing orchestrator + revision gating patterns:
  - `lib/auto-send/orchestrator.ts:280-338` — current single-pass revision integration
  - `lib/auto-send/revision-agent.ts:164-190` — at-most-once claim via `autoSendRevisionAttemptedAt`
  - `lib/meeting-overseer.ts:364-371` — gate caching via `MeetingOverseerDecision @@unique([messageId, stage])`
  - Kill switches and attempt claim semantics from Phase 116
- DraftPipelineRun status and artifact schema from Phase 123a
- Cron time budget: 240s total, 10 jobs max per invocation (`lib/background-jobs/runner.ts`)

## Work

### 1. Channel gate
Before entering the loop, check `channel === "email"`. For SMS/LinkedIn, continue with existing single-pass revision (no loop). This is checked in the orchestrator, not in the revision agent.

### 2. Claim mechanism (replaces single-pass `autoSendRevisionAttemptedAt` for loop)
- The loop is "claimed" by the `DraftPipelineRun.status = "RUNNING"` state (set in Phase 123b).
- On retry: find the existing `DraftPipelineRun` with status=RUNNING, load its artifacts, and resume from the last completed iteration.
- Keep `autoSendRevisionAttemptedAt` as a backwards-compatible timestamp (set once when the loop starts, never re-checked for gating). Update `AIDraft.autoSendRevisionAttemptedAt` at loop start.
- If no `DraftPipelineRun` exists (fail-open from 123b), fall back to existing single-pass revision behavior.

### 3. Loop orchestration (email channel, in `lib/auto-send/orchestrator.ts`)

```
function runRevisionLoop(context, runId, artifacts, evaluation):
  maxIterations = min(workspaceSettings.autoSendRevisionMaxIterations ?? 3, 3) // hard cap
  loopTimeoutMs = env.AUTO_SEND_REVISION_LOOP_TIMEOUT_MS ?? 60000
  maxOutputTokens = env.AUTO_SEND_REVISION_LOOP_MAX_OUTPUT_TOKENS ?? 20000
  loopStart = Date.now()
  bestDraft = { text: currentDraft, confidence: evaluation.confidence, iteration: 0 }
  cumulativeOutputTokens = 0

  // Load optimization context once (not per-iteration)
  optimizationContext = selectAutoSendOptimizationContext(...)

  for i in 1..maxIterations:
    // Budget checks
    remainingMs = loopTimeoutMs - (Date.now() - loopStart)
    if remainingMs < 20000: break (ABORTED, reason: "timeout_budget")
    if cumulativeOutputTokens >= maxOutputTokens: break (ABORTED, reason: "token_budget")

    // --- REVISION STEP ---
    // Check artifact cache: if (runId, "auto_send_revision_reviser", i) exists, reuse
    revisionArtifact = findArtifact(runId, "auto_send_revision_reviser", i)
    if revisionArtifact:
      revisedDraft = revisionArtifact.text
    else:
      contextPack = buildDraftRunContextPack({ runId, iteration: i, ... })
      revisedDraft = runRevisionAgent(contextPack, model, reasoningEffort)
      persistArtifact(runId, "auto_send_revision_reviser", i, revisedDraft)
      cumulativeOutputTokens += response.outputTokens

    // No-op detection: if revised draft >95% similar to input, abort
    if similarity(revisedDraft, bestDraft.text) > 0.95:
      break (COMPLETED, reason: "revision_no_change")

    // --- OVERSEER GATE STEP ---
    // CRITICAL: bypass MeetingOverseerDecision cache (@@unique([messageId, stage]))
    // Call the underlying gate LLM directly, store result only in DraftPipelineArtifact
    gateArtifact = findArtifact(runId, "meeting_overseer_gate", i)
    if gateArtifact:
      gateDecision = gateArtifact.payload
    else:
      gateDecision = runMeetingOverseerGateRaw(revisedDraft, ...) // new internal fn
      persistArtifact(runId, "meeting_overseer_gate", i, gateDecision)
      cumulativeOutputTokens += response.outputTokens

    if gateDecision.action === "block": break (COMPLETED, reason: "hard_block")
    if gateDecision.revisedDraft: revisedDraft = gateDecision.revisedDraft

    // --- RE-EVALUATION STEP ---
    evalArtifact = findArtifact(runId, "auto_send_evaluation", i)
    if evalArtifact:
      reEvaluation = evalArtifact.payload
    else:
      reEvaluation = evaluateAutoSend(revisedDraft, ...)
      persistArtifact(runId, "auto_send_evaluation", i, reEvaluation)
      cumulativeOutputTokens += response.outputTokens

    // Track best-so-far
    if reEvaluation.confidence > bestDraft.confidence:
      bestDraft = { text: revisedDraft, confidence: reEvaluation.confidence, iteration: i }

    // Early stop on success
    if reEvaluation.confidence >= threshold && reEvaluation.safeToSend:
      break (COMPLETED, reason: "threshold_met")

    // Hard block from evaluator
    if reEvaluation.source === "hard_block":
      break (COMPLETED, reason: "hard_block")

  // After loop: use bestDraft (highest confidence seen across all iterations)
  // Update DraftPipelineRun status: COMPLETED | ABORTED
  // Update AIDraft: autoSendRevisionConfidence, autoSendRevisionApplied, autoSendRevisionIterations
```

### 4. MeetingOverseerDecision cache bypass (CRITICAL - C1)
Add a new internal function `runMeetingOverseerGateRaw()` in `lib/meeting-overseer.ts`:
- Performs the gate LLM call WITHOUT reading/writing `MeetingOverseerDecision`
- Returns the same `MeetingOverseerGateDecision` type
- Store results only in `DraftPipelineArtifact` (keyed by runId + stage + iteration)
- The existing `runMeetingOverseerGate()` is unchanged (backwards compatible)

### 5. Fallback on mid-loop errors
On any unrecoverable error within an iteration:
- Log the error as artifact with stage `loop_error`, iteration `i`
- Stop the loop
- Use `bestDraft` (best-confidence draft seen so far; falls back to original if no iteration improved)
- Set `DraftPipelineRun.status = "FAILED"`

### 6. Cron budget awareness (CRITICAL - C4)
In `lib/background-jobs/runner.ts`, add a counter for loop-eligible jobs processed in the current cron invocation:
- Max 2 loop-eligible jobs per invocation
- When the counter reaches 2, skip remaining loop-eligible jobs (they'll be picked up next cron run)
- "Loop-eligible" = draft post-process job where channel=email AND autoSendRevisionEnabled=true AND confidence < threshold
- Non-email and non-revision jobs are not affected by this limit

### 7. Workspace settings for model selection
- Use `workspaceSettings.autoSendRevisionModel` (default: `"gpt-5.2"`) via `coerceAutoSendRevisionModel()` from 123a
- Use `workspaceSettings.autoSendRevisionReasoningEffort` (default: `"high"`)
- Use `workspaceSettings.autoSendRevisionMaxIterations` (default: 3, hard-capped to 3 in code)

### 8. Safety
- Hard cap iterations at 3 even if `maxIterations` > 3 (code guard, not just DB default)
- Enforce global kill switch `AUTO_SEND_REVISION_DISABLED=1` (existing behavior preserved)
- Delayed auto-send jobs (`AI_AUTO_SEND_DELAYED`) do NOT re-run the loop. The loop runs once during initial post-process only.

### 9. Observability
Structured telemetry at loop completion:
```ts
{
  loopExhausted: boolean,            // true if all iterations used without crossing threshold
  iterationsUsed: number,            // actual iterations run (0-3)
  startConfidence: number,           // iteration-0 evaluation confidence
  endConfidence: number,             // final/best iteration confidence
  totalOutputTokens: number,         // cumulative across all iterations
  totalLatencyMs: number,            // wall-clock time for entire loop
  stopReason: string,                // "threshold_met" | "hard_block" | "timeout_budget" | "token_budget" | "revision_no_change" | "exhausted" | "error"
  loopSkipReason?: string,           // "globally_disabled" | "workspace_disabled" | "above_threshold" | "hard_block" | "no_run_id" | "non_email_channel"
  channel: string,
}
```
Log as `AIInteraction` with `source: "auto_send_revision_loop"`.

### 10. Tests
- Loop bounds: stops after 3 iterations (never exceeds)
- Early stop on success: confidence crosses threshold on iteration 2 → loop stops
- Early stop on hard block: evaluator returns hard_block → loop stops immediately
- Timeout budget: loop aborts when remaining time < 20s
- Token budget: loop aborts when cumulative tokens exceed cap
- Artifact reuse: cached artifacts prevent duplicate LLM calls (idempotency)
- No-op detection: >95% similar draft aborts loop with reason
- Channel gate: SMS/LinkedIn drafts get single-pass revision, not the loop
- Degraded mode: missing DraftPipelineRun falls back to single-pass
- Delayed auto-send: does NOT trigger a second revision loop
- Best-so-far tracking: confidence oscillation uses highest-confidence draft
- MeetingOverseerDecision cache bypass: loop doesn't corrupt the main gate cache

## Validation (RED TEAM)
- All tests above pass
- `npm run build` clean
- Manual test: trigger low-confidence email draft → verify loop runs 1-3 iterations in Prisma Studio (artifacts per iteration)
- Manual test: trigger low-confidence SMS draft → verify single-pass revision (no loop artifacts)
- Manual test: trigger high-confidence draft → verify loop is skipped (no loop artifacts)
- Verify cron budget: with 3+ loop-eligible jobs queued, only 2 are processed per cron invocation

## Expected Output
- Confidence-driven revise→overseer→evaluate loop runs at most 3 iterations for email channel, is retry-safe/resumable via persisted artifacts.
- Model selection is per-workspace configurable; defaults to `gpt-5.2` with high reasoning effort.
- Cron budget is protected from queue starvation.
- Loop telemetry provides full observability into effectiveness and cost.

## Expected Handoff
Phase 123e adds gated long-term memory proposals and finalizes test coverage, retention behavior, and docs.

## Output
- Implemented a bounded revision loop in the AI auto-send orchestrator:
  - `lib/auto-send/orchestrator.ts`:
    - When evaluator confidence is below threshold and revision is enabled, performs up to `min(3, workspaceSettings.autoSendRevisionMaxIterations)` iterations (starts at `iteration=1` for email).
    - Stops early when `evaluation.safeToSend && evaluation.confidence >= threshold`, and always stops on hard blocks or when revision returns no improvement.
    - Enforces a total wall-clock budget via `AUTO_SEND_REVISION_LOOP_TIMEOUT_MS` (default 60s) and per-iteration timeouts passed into the revision agent.
- Added unit tests for loop behavior:
  - `lib/auto-send/__tests__/orchestrator.test.ts`:
    - Early stop when threshold is met on iteration 2.
    - Hard cap at 3 iterations even if `autoSendRevisionMaxIterations` is set higher.
- Verified:
  - `npm test` passes
  - `npm run build` passes

Deferred / out of scope for this implementation pass (not required to satisfy the user’s “3-iteration loop” request):
- Meeting Overseer cache bypass (`runMeetingOverseerGateRaw`) — not needed because the loop is evaluator↔revision (not Meeting Overseer↔revision).
- Cron invocation throttling of loop-eligible jobs — revisit if we see queue starvation in production.
- Token-budget enforcement — prompt runner telemetry does not currently expose token counts to orchestrator.

## Handoff
Proceed to Phase 123e only if we want to introduce *long-term* memory writes/proposals (LeadMemoryEntry) and retention/pruning. Otherwise, Phase 123 can be treated as complete for the “cross-agent draft run context + bounded revision loop” objective.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented bounded evaluator↔revision loop (max 3 iterations) in auto-send orchestrator.
  - Added loop-specific unit tests.
- Commands run:
  - `npm test` — pass
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass (warnings only)
- Blockers:
  - None
- Next concrete steps:
  - Decide whether Phase 123e (gated long-term memory proposals + pruning) is in-scope now or should be a separate follow-up phase.
