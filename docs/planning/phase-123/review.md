# Phase 123 — Review

## Summary
- Shipped cross-agent draft-run persistence (`DraftPipelineRun` + `DraftPipelineArtifact`) and threaded `runId` through draft generation to downstream auto-send.
- Shipped bounded evaluator↔revision loop (max 3 iterations) for AI auto-send, stopping early when the campaign threshold is met.
- Added revision context-pack injection + per-iteration artifact persistence + cache reuse for retry-safety when `runId` is available.
- Verified locally: `npm test`, `npm run lint` (warnings only), `npm run build`, `npm run db:push` all pass.

## What Shipped
- Draft-run persistence (schema + artifact writes):
  - `prisma/schema.prisma`
  - `lib/ai-drafts.ts`
  - `lib/draft-pipeline/types.ts`
  - `lib/draft-pipeline/validate-payload.ts`
  - `lib/draft-pipeline/queries.ts`
- Revision context pack + revision agent integration:
  - `lib/draft-pipeline/context-pack.ts`
  - `lib/lead-context-bundle.ts`
  - `lib/auto-send/revision-agent.ts`
- Bounded loop orchestration + tests:
  - `lib/auto-send/orchestrator.ts`
  - `lib/auto-send/__tests__/orchestrator.test.ts`
  - `lib/__tests__/auto-send-revision-agent.test.ts`

## Verification

### Commands
- `npm test` — pass (2026-02-09)
- `npm run lint` — pass (warnings only) (2026-02-09)
- `npm run build` — pass (warnings only) (2026-02-09)
- `npm run db:push` — pass (2026-02-09)

### Notes
- Working tree contains concurrent, uncommitted changes from other phases (`phase-124/125/126`). This review reflects the combined state (tests/lint/build all green), but commits should be scoped per-phase to avoid bundling unrelated work.

## Success Criteria → Evidence

1. A single `runId` links/persists Step 1/2/3 + overseer artifacts under a draft-run.
   - Evidence: `prisma/schema.prisma`, `lib/ai-drafts.ts`, `lib/draft-pipeline/queries.ts`, `npm run db:push`
   - Status: met

2. When evaluator confidence < threshold (AI auto-send), the system performs up to 3 bounded revise→re-evaluate iterations and stops early when threshold is met.
   - Evidence: `lib/auto-send/orchestrator.ts`, unit tests in `lib/auto-send/__tests__/orchestrator.test.ts`
   - Status: met

3. Revision model configuration is per-workspace and revision uses a strong reasoning model by default.
   - Evidence: `prisma/schema.prisma` (WorkspaceSettings knobs), `lib/auto-send/revision-agent.ts` (coercion + reasoning effort)
   - Status: partial (implemented; needs a production smoke/telemetry check to confirm config is actually being used in real runs)

4. Revision loop is retry-safe/resumable without duplicate token burn.
   - Evidence: `lib/auto-send/revision-agent.ts` (per-iteration artifacts + cache reuse when runId exists), unit tests cover loop bounds (not cache-hit behavior)
   - Status: partial (core mechanism shipped; add an explicit unit test for cache-hit path if we want stronger guarantees)

5. Long-term memory proposals are gated (LLM proposes, overseer approves) and retained/purged safely.
   - Evidence: `docs/planning/phase-123/e/plan.md` (explicitly deferred)
   - Status: not met (deferred)

## Plan Adherence
- Planned vs implemented deltas:
  - Planned Meeting Overseer↔revision loop and MeetingOverseerDecision cache bypass → implemented evaluator↔revision loop instead (aligns with user “confidence<threshold” requirement; Meeting Overseer does not operate on campaign confidence thresholds).
  - Planned token-budget enforcement + cron throttling → deferred (prompt runner does not expose token counts to orchestrator; cron throttling can be added if queue starvation observed).
  - Planned long-term memory proposals + pruning → deferred (scoped out to avoid coupling revision-loop correctness with memory-write governance).

## Risks / Rollback
- Risk: working tree mixes multiple phases → commit bundling risk.
  - Mitigation: stage/commit Phase 123 changes separately from Phase 124/125/126; re-run `npm test`/`npm run build` per commit if needed.
- Rollback: schema additions are reversible via the SQL in `docs/planning/phase-123/plan.md` (“Rollback SQL (Emergency)”).

## Follow-ups
- Add a cache-hit unit test for revision artifacts (exercise the `DraftPipelineArtifact` reuse path in `lib/auto-send/revision-agent.ts`).
- If desired: spin out a dedicated phase for gated long-term memory proposals + retention/pruning (LeadMemoryEntry governance).

