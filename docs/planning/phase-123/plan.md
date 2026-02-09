# Phase 123 — Cross-Agent Draft Run Memory + Overseer/Revision Loop (3 Iterations)

## Purpose
Make context work reliably across the multi-agent draft pipeline (draft generation Step 1/2/3, Meeting Overseer gate, auto-send evaluator, revision agent) by persisting a run-scoped "draft run" artifact log and adding a bounded overseer ↔ revision loop (max 3 iterations) to raise evaluator confidence above threshold using a strong reasoning model.

## Context
Today the system already has the key agent stages, but their context is not unified as a single "run snapshot":

- Email draft generation is multi-step in `lib/ai-drafts.ts` (Step 1 strategy JSON → Step 2 generation text → Step 3 verification/minimal corrections).
- Meeting Overseer can extract scheduling intent and can gate/revise a draft (`lib/meeting-overseer.ts`, persisted in `MeetingOverseerDecision` keyed by `messageId + stage`).
- Auto-send evaluation decides whether it is safe to send and produces a confidence/threshold comparison; a bounded revision agent exists, but is currently designed as a single attempt and does not loop with overseer.
- Lead + knowledge context already exists via `LeadContextBundle` (`lib/lead-context-bundle.ts`) and persistent `LeadMemoryEntry` (`prisma/schema.prisma`).

User intent (locked from conversation):
- Cross-agent context must be consistent within a single pipeline run (all agents read the same snapshot).
- When confidence is below threshold, route to the revision agent which prioritizes "why confidence is low" as primary context and uses the final draft + prompts/knowledge assets as primary sources for revision.
- Introduce a bounded overseer ↔ revision loop with max **3 iterations** total, using a "good reasoning model".
- Long-term memory writes should be gated: LLM proposes, overseer approves (do not silently persist unreviewed facts).
- Memory scope: Lead + Workspace layers (Lead facts vs workspace playbooks/policies).

## Repo Reality Check (RED TEAM)

### What exists today (verified):
- `lib/auto-send/revision-agent.ts` — Single-pass `maybeReviseAutoSendDraft()` with at-most-once claim via `autoSendRevisionAttemptedAt IS NULL`. Uses `gpt-5.2`.
- `lib/auto-send/orchestrator.ts:280-338` — Integrates revision when confidence < threshold AND `autoSendRevisionEnabled=true`
- `lib/auto-send/optimization-context.ts` — `selectAutoSendOptimizationContext()` from `MessagePerformanceSynthesis` + `InsightContextPackSynthesis`
- `lib/auto-send/types.ts:66-73` — `AutoSendContext.workspaceSettings` only carries: timezone, workStartTime, workEndTime, autoSendScheduleMode, autoSendCustomSchedule, autoSendRevisionEnabled
- `lib/meeting-overseer.ts:364-371` — `runMeetingOverseerGate()` caches via `MeetingOverseerDecision` with `@@unique([messageId, stage])` — **reuses cached result for same messageId**
- `lib/lead-context-bundle.ts` — Profiles: "draft", "auto_send_evaluator", "meeting_overseer_gate", "followup_parse", "followup_booking_gate"
- `lib/inbound-post-process/pipeline.ts:102-111` — Prisma select for workspace settings (must be updated for new fields)
- `prisma/schema.prisma:370` — `autoSendRevisionEnabled Boolean @default(false)` on WorkspaceSettings
- AIDraft revision fields: `autoSendRevisionAttemptedAt`, `autoSendOriginalConfidence`, `autoSendRevisionConfidence`, `autoSendRevisionApplied`, `autoSendRevisionSelectorUsed`
- `LeadMemoryEntry` has `source` enum: MANUAL, SYSTEM, INFERENCE. Has `expiresAt`.
- Kill switch: `AUTO_SEND_REVISION_DISABLED=1`

### What does NOT exist yet:
- `DraftPipelineRun`, `DraftPipelineArtifact` models
- `autoSendRevisionModel`, `autoSendRevisionReasoningEffort`, `autoSendRevisionMaxIterations` fields
- Any iteration/loop logic, `DraftRunSnapshot`, `DraftRunContextPack` types

## Concurrent Phases
Overlaps detected by scanning the last 10 phases (`docs/planning/phase-122` → `phase-113`) and repo state (`git status --porcelain`).

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 119 | Active (no `review.md`) | Files: `lib/ai-drafts.ts`, prompt-runner/budget semantics | Re-read current `lib/ai-drafts.ts` before edits; do not regress Step 3 verifier hardening; keep prompt keys stable. |
| Phase 122 | Complete (`review.md` present) | Domain: Meeting Overseer prompt/semantics | Preserve Meeting Overseer extraction/gate contracts and prompt keys; do not weaken fail-closed semantics introduced for booking. |
| Phase 116 | Complete (canary pending per plan) | Domain: auto-send revision idempotency + rollout toggles | Build on existing kill-switch + at-most-once attempt claim patterns; keep telemetry stats-only. |
| Phase 115 | Complete | Domain: revision agent + optimization context selection | Extend without breaking existing single-attempt semantics for non-looped paths; reuse selection plumbing. |
| Phase 124 | Active (concurrent) | File: `lib/workspace-capabilities.ts` modified | Out of scope for this phase; must not be accidentally bundled into commits for Phase 123. Resolve/commit separately before landing. |

## Objectives
* [ ] Introduce a run-scoped persistence layer ("DraftPipelineRun" + per-stage artifacts) that links Step 1/2/3 outputs, overseer decisions, evaluator outputs, and revision iterations under a single `runId`.
* [ ] Provide a deterministic, weighted context builder for the revision agent (primary: low-confidence reasons + current draft; secondary: strategy + knowledge + redacted lead memory; tertiary: metadata/prompt keys).
* [ ] Implement an overseer ↔ revision loop (**email channel only**): when `auto_send.evaluate` confidence < threshold (and not hard-blocked), run up to 3 revise→overseer→re-evaluate iterations, stopping early on success.
* [ ] Make the loop retry-safe and resumable using persisted per-iteration artifacts (no repeated token burn on retries).
* [ ] Add gated memory-write proposals (LLM proposes, overseer approves) to feed `LeadMemoryEntry` with TTL, provenance, and approval status.
* [ ] Ship with tests + quality gates (`npm test`, `npm run lint`, `npm run build`) and minimal operational docs for new knobs.

## Constraints
- **Channel gate:** The 3-iteration loop is email-only. SMS/LinkedIn continue with existing single-pass revision.
- **PII hygiene:** Do not store raw message bodies / conversation history in `AIInteraction.metadata` (stats-only). Draft text is already a sendable artifact, but its retention must be bounded (30 days).
- **Idempotency:** All stage writes must be deduped (unique keys) and safe under job retries. `DraftPipelineRun` uses `@@unique([triggerMessageId, channel])` for creation idempotency.
- **Bounded agent loops:** Max 3 iterations total; **total loop timeout 60s** (env: `AUTO_SEND_REVISION_LOOP_TIMEOUT_MS`); **per-iteration budget ~18s**; **cumulative output token cap 20K** (env: `AUTO_SEND_REVISION_LOOP_MAX_OUTPUT_TOKENS`); fail closed on hard blocks or tool failures.
- **Cron budget awareness:** Limit loop-enabled jobs to max 2 per cron invocation to prevent queue starvation (cron budget 240s, loop budget 60s × 2 = 120s leaves 120s for other jobs).
- **Prompt stability:** Keep existing prompt keys stable unless there is a clear reason to version; prefer adding new keys only when necessary.
- **Prisma:** Schema changes require `npm run db:push` against the correct DB; verify columns/indexes exist. All new columns nullable with defaults.
- **Freshness:** All agents within a single run use the same snapshot; changes apply to subsequent runs.
- **Fail-open:** If `DraftPipelineRun` creation fails, continue draft generation without instrumentation. Loop falls back to single-pass revision if no run exists.

## Success Criteria
- A single `runId` links and persists: Step 1 strategy, Step 2 generation output, Step 3 verifier output, overseer decisions, evaluator outputs, and revision iterations.
- When confidence < threshold on email channel, the system performs up to 3 revise→overseer→evaluate cycles, stopping early when confidence crosses threshold and is safe to send.
- The revision loop never auto-sends unless threshold is met; hard blocks always stop the loop.
- The revision model is configurable per workspace (default: `gpt-5.2`, high reasoning effort), and is observable in artifacts/telemetry without raw text.
- Memory proposals are gated; approved proposals write to `LeadMemoryEntry` with TTL, provenance, and `status=APPROVED`; unapproved proposals persist as `status=PENDING`.
- Loop exhaustion rate < 50% (most loops should succeed before 3 iterations); monitored via structured telemetry.
- Tests cover: context weighting, loop bounds/stop conditions, channel gating, idempotent artifact persistence, no-op detection; `npm test` + `npm run lint` + `npm run build` pass.

## Critical Files to Modify

| File | What Changes | Subphase |
|------|-------------|----------|
| `prisma/schema.prisma` | Add `DraftPipelineRun`, `DraftPipelineArtifact` models; add 3 fields to `WorkspaceSettings`; add `autoSendRevisionIterations` to `AIDraft`; add `status` to `LeadMemoryEntry` | a, e |
| `lib/auto-send/types.ts:66-73` | Extend `AutoSendContext.workspaceSettings` with new fields | a |
| `lib/inbound-post-process/pipeline.ts:102-111` | Update Prisma `select` clauses for new workspace settings | a |
| `actions/auto-send-revision-rollout-actions.ts` | Add new fields with super-admin gating | a |
| `lib/ai-drafts.ts` | Create `DraftPipelineRun`, persist Step 1/2/3 artifacts | b |
| `lib/meeting-overseer.ts` | Add `runMeetingOverseerGateRaw()` (cache-bypass for loop) | d |
| `lib/lead-context-bundle.ts` | Add "revision" profile with budgets | c |
| `lib/auto-send/revision-agent.ts` | Accept `runId`/`iteration`, use weighted context pack | c |
| `lib/auto-send/orchestrator.ts:280-338` | Replace single-pass revision with loop orchestration | d |
| `lib/background-jobs/runner.ts` | Add loop-eligible job counter (max 2 per cron invocation) | d |

### New Files

| File | Purpose | Subphase |
|------|---------|----------|
| `lib/draft-pipeline/types.ts` | Stage names, status enum, `DraftRunContextPack`, `MemoryProposal` types | a |
| `lib/draft-pipeline/validate-payload.ts` | 32KB payload size validation | a |
| `lib/draft-pipeline/queries.ts` | Read helpers: `getDraftPipelineRunByDraftId()`, `getArtifactsForRun()` | b |
| `lib/draft-pipeline/context-pack.ts` | `buildDraftRunContextPack()` — weighted revision context builder | c |

### Existing Functions to Reuse

| Function | File | How Used |
|----------|------|----------|
| `evaluateAutoSend()` | `lib/auto-send-evaluator.ts` | Re-evaluate after each revision iteration |
| `selectAutoSendOptimizationContext()` | `lib/auto-send/optimization-context.ts` | Called once at loop start, fed into context pack |
| `buildLeadContextBundle()` | `lib/lead-context-bundle.ts` | New "revision" profile for knowledge/memory |
| `computeLeadMemoryExpiryDate()` | `lib/lead-memory-context.ts` | TTL calculation for memory proposals |
| `coerceEmailDraftVerificationModel()` | codebase pattern | Template for new `coerceAutoSendRevisionModel()` |
| `isTrueSuperAdminUser()` | `actions/auto-send-revision-rollout-actions.ts` | Gate new settings fields |

## RED TEAM Findings (Gaps / Weak Spots)

### CRITICAL (4)

#### C1. MeetingOverseerDecision unique constraint blocks multi-iteration gate calls
**Subphase:** D
**Problem:** `MeetingOverseerDecision` has `@@unique([messageId, stage])`. `runMeetingOverseerGate()` short-circuits by loading cached decisions. Loop iterations 2+ silently reuse iteration 1's gate result — the loop never gets fresh gate feedback on revised drafts.
**Fix:** Add `runMeetingOverseerGateRaw()` that performs the gate LLM call without persistence. Store loop gate results only in `DraftPipelineArtifact` keyed by `(runId, "meeting_overseer_gate", iteration)`. Existing `runMeetingOverseerGate()` is unchanged (backwards compatible).

#### C2. At-most-once claim incompatible with multi-iteration resumability
**Subphase:** D
**Problem:** `autoSendRevisionAttemptedAt IS NULL` is a single-shot gate. Job crash mid-loop + retry = loop permanently skipped (no resumability).
**Fix:** Move claim to `DraftPipelineRun.status = RUNNING`. Resume from last completed iteration via artifacts. Keep `autoSendRevisionAttemptedAt` as backwards-compatible timestamp only (set once, never re-checked for gating).

#### C3. Per-iteration timeout budget unspecified — loop can consume 75s+
**Subphase:** D
**Problem:** 3 × (revision ~10s + gate ~10s + eval ~5s) = ~75s per job vs 240s cron budget for 10 jobs.
**Fix:** Total loop timeout: 60s (`AUTO_SEND_REVISION_LOOP_TIMEOUT_MS`). Per-iteration: ~18s. Early termination when `remainingMs < 20s`.

#### C4. Cron budget exhaustion with multiple loop-enabled jobs
**Subphase:** D
**Problem:** 4 loop-enabled jobs × 60s = entire 240s budget. Other jobs starved.
**Fix:** Max 2 loop-eligible jobs per cron invocation. Counter in `lib/background-jobs/runner.ts`. Non-email and non-revision jobs unaffected.

### HIGH (10)

#### H1. `AutoSendContext.workspaceSettings` type missing new fields
**Subphase:** A, D — `lib/auto-send/types.ts:66-73` only carries 6 fields. New fields will be `undefined` at runtime.
**Fix:** Update type + all Prisma select clauses (pipeline.ts:102-111 and other entry points).

#### H2. New WorkspaceSettings columns need nullable defaults
**Subphase:** A — Adding required columns to existing rows fails `db:push`.
**Fix:** `autoSendRevisionModel String? @default("gpt-5.2")`, `autoSendRevisionReasoningEffort String? @default("high")`, `autoSendRevisionMaxIterations Int? @default(3)`. Loop still gated behind `autoSendRevisionEnabled` (defaults false).

#### H3. DraftPipelineRun creation not idempotent
**Subphase:** B — Job retry may create duplicates.
**Fix:** `@@unique([triggerMessageId, channel])` + upsert pattern. If run exists, load and continue.

#### H4. No fallback on DraftPipelineRun creation failure
**Subphase:** B, D — DB issue or missing migration.
**Fix:** Fail-open: try/catch, continue without instrumentation (`runId = null`). Loop falls back to single-pass revision.

#### H5. No fallback on mid-loop iteration error
**Subphase:** D — Unrecoverable error in iteration 2, no behavior specified.
**Fix:** Stop loop, use best-confidence draft seen so far. Log as artifact with stage `loop_error`. Set `DraftPipelineRun.status = "FAILED"`.

#### H6. No pruning mechanism specified
**Subphase:** E — "30 days via cron" too vague.
**Fix:** Piggyback on `/api/cron/background-jobs`: after processing jobs, if remaining time > 10s, delete up to 500 rows > 30 days. `onDelete: Cascade` for artifacts. Env: `DRAFT_PIPELINE_RUN_RETENTION_DAYS` (default 30).

#### H7. No token budget cap for entire loop
**Subphase:** D — 9 extra LLM calls with gpt-5.2 high reasoning = material cost.
**Fix:** Cumulative output token tracking. Env: `AUTO_SEND_REVISION_LOOP_MAX_OUTPUT_TOKENS` (default 20000). Abort loop if exceeded.

#### H8. New settings need super-admin gating
**Subphase:** A — Model/reasoning/iterations affect cost and latency.
**Fix:** Extend `actions/auto-send-revision-rollout-actions.ts` with `isTrueSuperAdminUser()` gating for all 3 new fields.

#### H9. AIDraft revision fields ambiguous under loop
**Subphase:** D — Which iteration's confidence is `autoSendRevisionConfidence`?
**Fix:** Fields reflect **final loop state**: `autoSendOriginalConfidence` = iter-0 eval, `autoSendRevisionConfidence` = final/best confidence, `autoSendRevisionApplied` = true if any revision used. Add `autoSendRevisionIterations Int? @default(0)`.

#### H10. No loop exhaustion monitoring
**Subphase:** D — No way to know if the loop is effective.
**Fix:** Structured telemetry at loop completion: `{ loopExhausted, iterationsUsed, startConfidence, endConfidence, totalOutputTokens, totalLatencyMs, stopReason, loopSkipReason, channel }`. Log as `AIInteraction` with `source: "auto_send_revision_loop"`.

### MEDIUM (14)

| # | Finding | Subphase | Fix |
|---|---------|----------|-----|
| M1 | Client/Lead model relations need DraftPipelineRun | A | Add `draftPipelineRuns DraftPipelineRun[]` to both |
| M2 | Optimization context selector integration unspecified | C | Call once at loop start, not per-iteration |
| M3 | Confidence oscillation behavior unspecified | D | Best-so-far tracking (highest confidence + draft pair) |
| M4 | DraftPipelineArtifact.payload no size limit | A | 32KB max, validate before every write |
| M5 | "Extend LeadContextBundle" underspecified | C | New "revision" profile: knowledge 3000, memory 800 tokens |
| M6 | Weighted sections no defined allocations | C | Primary 60% (~6000), Secondary 30% (~3000), Tertiary 10% (~1000) |
| M7 | "Strong reasoning model" default unnamed | A | Default `"gpt-5.2"` + coercion function |
| M8 | Memory proposal schema undefined | E | `MemoryProposal = { category, content, ttlDays, confidence }`. Safe allowlist: timezone/scheduling/communication_preference, availability_pattern |
| M9 | No no-op detection in loop | D | >95% similar draft aborts loop (reason: `revision_no_change`) |
| M10 | DraftPipelineRun.status state machine undefined | A | RUNNING → COMPLETED \| FAILED \| ABORTED. Forward-only. |
| M11 | No test for loop + delayed auto-send | D | Delayed send does NOT re-run loop. Add test case. |
| M12 | Schema migration rollback not documented | A | Rollback SQL in plan (see below) |
| M13 | Overseer gate prompt may not suit revision context | C/D | Evaluate existing prompt; add `meeting.overseer.revision_gate.v1` if needed |
| M14 | Memory proposal dedup not specified | E | `createMany({ skipDuplicates: true })` on `(leadId, category, content)` |

### LOW (4)

| # | Finding | Subphase | Fix |
|---|---------|----------|-----|
| L1 | Artifact missing token usage fields | A | Add `inputTokens Int?`, `outputTokens Int?`, `latencyMs Int?` |
| L2 | No way to distinguish "loop disabled" vs "not triggered" | D | `loopSkipReason` in telemetry |
| L3 | Artifact text access control | A | Internal/admin-only, no client-portal exposure |
| L4 | Artifact resumability intent undocumented | D | Add code comment explaining cache-hit = reuse design |

## Resolved Decisions

| # | Decision | Answer |
|---|----------|--------|
| Q1 | Channel scope | **Email-only.** SMS/LinkedIn stay single-pass. |
| Q2 | Default maxIterations | **3.** All revision-enabled workspaces get the full loop. Early-stop on threshold. |
| Q3 | Memory proposals | **Persist as pending rows.** `LeadMemoryEntry.status = APPROVED \| PENDING`. Safe categories auto-approve. |
| Q4 | Cost at scale | ~10-20% trigger rate → 90-180 extra LLM calls/day per 100 drafts. Acceptable. |

## Assumptions (>= 90% confidence)

- **A1.** New WorkspaceSettings fields nullable with defaults (matches `draftGenerationModel` pattern). ~95%
- **A2.** 30-day retention sufficient for pipeline runs. ~95%
- **A3.** `AUTO_SEND_REVISION_DISABLED=1` applies to entire loop. ~98%
- **A4.** Phase 119 Step 3 verifier changes merged (commit `71f4bf1`). ~95%
- **A5.** Phase 122 Meeting Overseer changes merged. ~95%

## Non-Goals
- SMS/LinkedIn revision loop (email-only for Phase 123)
- Human review UI for pending memory proposals (follow-up phase)
- Changing existing prompt keys or overseer extraction behavior
- Modifying auto-booking logic

## Subphase Index
* a — Data model + contracts (DraftPipelineRun/Artifact, iteration support, workspace model config, type updates)
* b — Instrumentation: persist run artifacts for draft Step 1/2/3 + overseer decisions (fail-open, idempotent)
* c — Revision context builder (weighted pack with token allocations) + revision-agent integration + overseer prompt evaluation
* d — Overseer ↔ revision loop (max 3 iterations, email-only) + resumability/idempotency + timeout budgets + cron budget awareness
* e — Gated long-term memory proposals (persist as pending) + pruning + tests/rollout/docs

## Rollback SQL (Emergency)
```sql
DROP TABLE IF EXISTS "DraftPipelineArtifact";
DROP TABLE IF EXISTS "DraftPipelineRun";
ALTER TABLE "WorkspaceSettings" DROP COLUMN IF EXISTS "autoSendRevisionModel";
ALTER TABLE "WorkspaceSettings" DROP COLUMN IF EXISTS "autoSendRevisionReasoningEffort";
ALTER TABLE "WorkspaceSettings" DROP COLUMN IF EXISTS "autoSendRevisionMaxIterations";
ALTER TABLE "AIDraft" DROP COLUMN IF EXISTS "autoSendRevisionIterations";
ALTER TABLE "LeadMemoryEntry" DROP COLUMN IF EXISTS "status";
```

## Verification (End-to-End)

1. `npm run db:push` — new schema applied successfully
2. `npm run build` — no type errors from new fields/types
3. `npm run lint` — clean
4. `npm test` — all tests pass including:
   - Loop bounds (3 max), early stop (threshold met), hard block stop
   - Timeout + token budget enforcement
   - Artifact-based resumability (no duplicate LLM calls on retry)
   - No-op detection (>95% similar draft aborts loop)
   - Channel gate (email loops, SMS/LinkedIn single-pass)
   - Fail-open on missing DraftPipelineRun
   - Delayed auto-send does NOT re-trigger loop
   - Memory proposal gating (safe categories approved, others pending)
   - Memory dedup (no duplicate LeadMemoryEntry rows)
   - Cron budget: max 2 loop-eligible jobs per invocation
   - MeetingOverseerDecision cache bypass (loop doesn't corrupt main gate cache)
   - Best-so-far tracking (confidence oscillation uses highest-confidence draft)
5. Prisma Studio verification:
   - DraftPipelineRun + artifacts created for a test draft
   - WorkspaceSettings rows show new fields with defaults
   - LeadMemoryEntry status field present with default "APPROVED"
6. Telemetry: AIInteraction logs for loop iterations include correct `featureId`/`promptKey` and loop metrics

## Phase Summary (running)
- 2026-02-09 — Completed Phase 123a schema/contracts + settings propagation; Prisma validate/generate/db:push succeeded; `npm run build` succeeded. (files: `prisma/schema.prisma`, `lib/draft-pipeline/types.ts`, `lib/draft-pipeline/validate-payload.ts`, `lib/auto-send/types.ts`, `lib/auto-send/revision-config.ts`, `lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/email-inbound-post-process.ts`, `actions/auto-send-revision-rollout-actions.ts`, `docs/planning/phase-123/a/plan.md`)
- 2026-02-09 — Completed Phase 123c/123d: revision context pack + bounded evaluator↔revision loop (max 3 iterations) with per-iteration artifact persistence and cache reuse for retry-safety; added loop unit tests; `npm test`/`npm run lint`/`npm run build` all pass. (files: `lib/draft-pipeline/context-pack.ts`, `lib/lead-context-bundle.ts`, `lib/auto-send/revision-agent.ts`, `lib/auto-send/orchestrator.ts`, `lib/__tests__/auto-send-revision-agent.test.ts`, `lib/auto-send/__tests__/orchestrator.test.ts`, `docs/planning/phase-123/c/plan.md`, `docs/planning/phase-123/d/plan.md`, `docs/planning/phase-123/e/plan.md`)

## Review Notes
- Post-implementation review: `docs/planning/phase-123/review.md`
- Phase 123e (gated long-term memory proposals + pruning) was explicitly deferred to keep the shipped scope aligned with the user’s request (cross-agent run context + bounded confidence-raising loop).
