# Phase 115 — Review

## Summary
- Shipped a bounded auto-send revision loop: context selection → revise → re-evaluate once (AI_AUTO_SEND only).
- Added hard-block tagging to the evaluator so revision is skipped for deterministic safety blocks.
- Added AI Ops visibility for `auto_send.context_select` + `auto_send.revise` (no raw text; stats-only metadata allowlist).
- Verified: `npm test`, `npm run lint`, `npm run build` all pass locally.

## What Shipped
- Optimization context + selector:
  - `lib/auto-send/optimization-context.ts`
  - `lib/ai/prompt-registry.ts` (prompt key `auto_send.context_select.v1`)
- Revision agent:
  - `lib/auto-send/revision-agent.ts`
  - `lib/ai/prompt-registry.ts` (prompt key `auto_send.revise.v1`)
- Hard-block tagging:
  - `lib/auto-send-evaluator.ts` (adds optional `{ source, hardBlockCode }`)
- Orchestrator integration:
  - `lib/auto-send/orchestrator.ts`
- Telemetry + AI Ops visibility:
  - `lib/ai/openai-telemetry.ts` (allowlists `autoSendRevision`)
  - `actions/ai-ops-feed-actions.ts` (adds featureIds)
  - `components/dashboard/ai-ops-panel.tsx` (adds filters)
- Tests + harness:
  - `lib/__tests__/auto-send-optimization-context.test.ts`
  - `lib/__tests__/auto-send-revision-agent.test.ts`
  - `lib/auto-send/__tests__/orchestrator.test.ts`
  - `lib/__tests__/openai-telemetry-metadata.test.ts`
  - `scripts/test-orchestrator.ts`

## Verification

### Commands
- `npm test` — pass (2026-02-07)
- `npm run lint` — pass (warnings only; pre-existing) (2026-02-07)
- `npm run build` — pass (2026-02-07)
- `npm run db:push` — skip (no Prisma schema changes in Phase 115)

### Notes
- Lint has existing warnings unrelated to Phase 115 changes; no new lint errors introduced.
- Next build emits existing CSS optimization warnings; build succeeds.

## Success Criteria → Evidence

1. Confidence-below-threshold triggers one revision + re-eval (model-based only).
   - Evidence:
     - `lib/auto-send/orchestrator.ts` (revision attempt inserted between first eval and threshold decision)
     - `lib/auto-send/revision-agent.ts` (bounded revise-once flow + deadline)
     - `lib/auto-send/__tests__/orchestrator.test.ts` (revision path test)
   - Status: met

2. Persist revised draft only on demonstrable improvement.
   - Evidence:
     - `lib/auto-send/revision-agent.ts` (only persists when `revisedConfidence > originalConfidence`; guarded updateMany count)
     - `lib/__tests__/auto-send-revision-agent.test.ts`
   - Status: met

3. AI Ops visibility without raw text exposure.
   - Evidence:
     - `actions/ai-ops-feed-actions.ts` includes `auto_send.context_select` + `auto_send.revise`
     - `lib/ai/openai-telemetry.ts` allowlists stats-only `autoSendRevision` metadata
     - `components/dashboard/ai-ops-panel.tsx` adds filters for new featureIds
   - Status: met

4. Unit tests cover trigger gating + hard-block bypass + bounded behavior.
   - Evidence:
     - `lib/auto-send/__tests__/orchestrator.test.ts` (revision attempted only when below threshold; skipped on hard blocks)
     - `lib/__tests__/auto-send-revision-agent.test.ts` (kill-switch; persist-on-improve)
   - Status: met

## Plan Adherence
- Planned vs implemented deltas:
  - AIDraft schema fields for revision tracking were **deferred** to avoid DB migration/rollout work in this phase.
  - AI Ops feed shows the revision featureIds; it does not yet surface a confidence-delta column derived from post-call metadata.

## Risks / Rollback
- Risk: Revision loop increases LLM usage/latency on low-confidence cases.
  - Mitigation: bounded single-pass loop + 10s per new prompt + ~35s aggregate deadline; fail-closed to existing `needs_review`.
- Rollback lever: `AUTO_SEND_REVISION_DISABLED=1` disables selector/reviser without changing evaluator behavior.

## Follow-ups
- Add schema-level revision tracking on `AIDraft` if you want inbox/draft filtering (and run `npm run db:push` with rollout plan).
- Optionally enrich AI Ops event summaries with revision deltas (stats-only) by updating AIInteraction metadata post-call.
