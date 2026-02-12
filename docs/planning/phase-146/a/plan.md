# Phase 146a — Failure Taxonomy, Evidence Packet Schema, and Critical-Case Baseline

## Focus

Create a single source of truth for AI replay failures so every failed case can be diagnosed and routed to the right fix owner without ambiguity.

## Inputs

- `docs/planning/phase-146/plan.md`
- Latest replay artifacts from `.artifacts/ai-replay/*.json`
- Existing replay harness and judge metadata paths:
  - `scripts/live-ai-replay.ts`
  - `lib/ai-replay/*`
  - `lib/ai/prompt-registry.ts`
- Known critical cases from phase context (`59dc...`, `bfb...`, `2a70...`).

## Existing Infrastructure (RED TEAM)

- `ReplayFailureType` already defined at `lib/ai-replay/types.ts:80-86` with 5 categories: `decision_error`, `execution_error`, `draft_quality_error`, `judge_error`, `infra_error`.
- `classifyFailureType()` in `lib/ai-replay/run-case.ts:16-41` does basic regex-based classification.
- Replay artifacts already include `judgePromptKey`, `judgeSystemPrompt`, `failureType` per case (added in Phase 145d).
- Frozen manifest exists at `docs/planning/phase-145/replay-case-manifest.json` (3 core + 7 top-10 cases).

## Work

1. **Extend** existing `ReplayFailureType` in `lib/ai-replay/types.ts`:
   - Add `selection_error` to the enum.
   - Add `draft_generation_error` if distinct from `draft_quality_error` (generation never produced vs produced but failed quality).
   - Document each category with owning subsystem (prompting, orchestration, infra, evaluator).
2. Define `ReplayEvidencePacket` type in `lib/ai-replay/types.ts`:
   - inbound context summary
   - decision contract snapshot (`AIDecisionContractV1` or null)
   - generated draft text (or generation error message)
   - judge inputs/prompt identifiers (`judgePromptKey`, `judgeSystemPrompt`)
   - prior human outbound reference (when available)
   - `failureType` classification
   - invariant breaches (list of specific policy violations)
   - token usage / latency diagnostics
3. Wire evidence packet construction into `lib/ai-replay/run-case.ts` so each case result includes structured evidence.
4. Decide manifest strategy: inherit `docs/planning/phase-145/replay-case-manifest.json` or create `docs/planning/phase-146/replay-case-manifest.json` with expanded set.
5. Define ownership mapping (prompting, orchestration, infra, evaluator) for each failure class.
6. Establish baseline metrics from current Phase 145 artifacts before fixes.

## Validation

- `npm run lint`, `npm run build`, `npm run test`
- `npm run test:ai-drafts`
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --dry-run`
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --concurrency 3`

## Output

- Canonical failure taxonomy + evidence packet schema documented in phase artifacts.
- Stable replay case manifest for critical and high-risk cohorts.
- Baseline scorecard that later subphases must improve against.

## Handoff

146b consumes the evidence packet and baseline to focus exclusively on why booking-first failed for `59dc...`.

## Progress This Turn (Terminus Maximus)

- Work done:
  - Added deterministic Phase 146 replay cohort file at `docs/planning/phase-146/replay-case-manifest.json` (core 3 + top 10 + explicit `threadIds`).
  - Added canonical taxonomy document at `docs/planning/phase-146/replay-failure-taxonomy.md`.
  - Added evidence packet JSON schema draft at `docs/planning/phase-146/evidence-packet-schema.json`.
  - Extended replay failure enum in `lib/ai-replay/types.ts` with:
    - `draft_generation_error`
    - `selection_error`
  - Added `summary.failureTypeCounts` to replay artifacts (`lib/ai-replay/types.ts`, `scripts/live-ai-replay.ts`).
  - Hardened replay script preflight/selection failure diagnostics:
    - preflight blocking failures now still write an artifact,
    - selection-empty failure now still writes an artifact,
    - failure-type counts are printed in run summary.
  - Tightened case-level failure classification in `lib/ai-replay/run-case.ts` to distinguish judge vs infra vs draft-generation vs selection classes.
- Commands run:
  - `node --import tsx --test lib/ai-replay/__tests__/cli.test.ts lib/ai-replay/__tests__/judge-schema.test.ts lib/ai-replay/__tests__/select-cases.test.ts` — pass.
  - `npm run lint` — pass (warnings only, no new errors).
  - `npm run build` — pass.
  - `npm run test:ai-drafts` — pass.
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --dry-run` — blocked; artifact written: `.artifacts/ai-replay/run-2026-02-12T08-26-49-976Z.json`.
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --concurrency 3` — blocked; artifact written: `.artifacts/ai-replay/run-2026-02-12T08-26-55-361Z.json`.
- Coordination conflicts (multi-agent):
  - Overlap exists with active phases 141/145 on `scripts/live-ai-replay.ts` and `lib/ai-replay/*`.
  - Resolution used: surgical, additive changes only (new enum values + summary fields + artifact writes), no behavioral rewrites to selection ranking or judge prompt composition.
- Blockers:
  - Runtime DB connectivity failure (`db.pzaptpgrcezknnsfytob.supabase.co` unreachable) blocks dry/live replay execution in this environment.
- Next concrete steps:
  - Add `ReplayEvidencePacket` runtime type and attach it in `runReplayCase` output (currently schema exists on disk but not wired in runtime artifacts).
  - Start 146b deep trace for `59dc...` using manifest artifact + end-to-end path instrumentation once DB connectivity is restored.

### Update — 2026-02-12 08:30 UTC

- Additional work done:
  - Implemented runtime `ReplayEvidencePacket` type in `lib/ai-replay/types.ts` and attached it to `ReplayCaseResult`.
  - Wired evidence packet population in `lib/ai-replay/run-case.ts` for `skipped`, `evaluated`, and `failed` paths (with judge prompt metadata and generation-status details).
  - Updated `scripts/live-ai-replay.ts` dry-run case construction to include `evidencePacket`.
- Additional commands run:
  - `node --import tsx --test lib/ai-replay/__tests__/cli.test.ts lib/ai-replay/__tests__/judge-schema.test.ts lib/ai-replay/__tests__/select-cases.test.ts` — pass.
  - `npm run lint` — pass (warnings only).
  - `npm run build` — pass.
  - `npm run test:ai-drafts` — pass.
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --dry-run` — blocked; artifact `.artifacts/ai-replay/run-2026-02-12T08-29-59-589Z.json`.
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --concurrency 3` — blocked; artifact `.artifacts/ai-replay/run-2026-02-12T08-30-03-756Z.json`.
- NTTAN evidence captured:
  - `judgePromptKey`: `ai.replay.judge.v1`
  - `judgeSystemPrompt`: captured in both artifact `config` blocks.
  - `failureTypeCounts`:
    - dry-run: `infra_error=1`, all others `0`
    - live: `infra_error=2`, all others `0`
- Updated next concrete steps:
  - Move to 146b with static-path trace and invariant definition while infra is blocked.
  - Once connectivity is restored, rerun live replay with the same manifest to collect case-level quality deltas.
