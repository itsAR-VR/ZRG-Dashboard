# Phase 145d — Replay Dual-Track Suite + Infra Preflight

## Focus

Upgrade replay from draft-only evaluation to dual-track validation:
- decision extraction track
- outbound quality track

with explicit infra preflight and artifact diagnostics.

## Inputs

- `docs/planning/phase-145/c/plan.md`
- Replay surfaces:
  - `scripts/live-ai-replay.ts`
  - `lib/ai-replay/run-case.ts`
  - `lib/ai-replay/judge.ts`
  - `lib/ai/prompt-registry.ts`

## Coordination Pre-Flight (Mandatory)

- Run `git status --short` and phase overlap scan before replay-surface edits.
- Re-read latest versions of replay/judge files in this subphase scope.
- If concurrent replay changes are present, resolve by feature-flag/symbol boundaries and document in progress notes.

## Work

1. Add replay mode support: `decision`, `outbound`, `both` (default `both`).
   - Extend `lib/ai-replay/types.ts` with `ReplayMode` type and per-track result fields.
   - Extend `lib/ai-replay/judge-schema.ts` with decision-track judge schema (binary extraction pass/fail).
   - Extend `lib/ai-replay/judge.ts` with decision-track judge prompt (validate extraction contract correctness).
   - Update `lib/ai-replay/cli.ts` to accept `--mode decision|outbound|both`.
2. Add artifact fields:
  - `decisionOutput`
  - `executionPathTaken`
  - `failureType` (`decision_error`, `execution_error`, `draft_quality_error`, `judge_error`, `infra_error`)
  - `timezoneRenderCheck`
3. Add environment preflight checks before run:
  - DB connectivity
  - API key presence/validity
  - required prompt keys available
4. Prevent ambiguous failures:
  - infra failures must be reported as infra, not draft/judge failure.
5. Keep judge prompt strict but bounded; retain guardrails for truncation and retry budget.
6. Add critical-case targeting support for `core3 + top10`.
   - Use deterministic case list from `docs/planning/phase-145/replay-case-manifest.json` (no dynamic “latest top 10” at gate time).

## Edge Cases

- Zero selected cases due filters.
- `max_output_tokens` recurrence.
- API 401 mid-run.
- partial run completion with mixed case outcomes.

## Validation

- Replay unit/integration tests for dual-track outputs.
- Run suites on dry-run + live modes where environment permits.
- Verify critical-case and non-critical pass-rate calculations.
- NTTAN command gate (mandatory for this subphase):
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --mode both --thread-ids-file docs/planning/phase-145/replay-case-manifest.json --dry-run`
  - `npm run test:ai-replay -- --mode both --thread-ids-file docs/planning/phase-145/replay-case-manifest.json --concurrency 3`

## Output

- Replay suite can prove extraction correctness and outbound quality separately.
- Infra problems no longer masquerade as model behavior regressions.

## Handoff

145e updates phase skills and review workflow to make these checks mandatory for AI-message changes.

## Progress This Turn (Terminus Maximus)

- Implemented replay hardening in `scripts/live-ai-replay.ts` and `lib/ai-replay/*`:
  - added `--thread-ids-file` CLI support (manifest-friendly; accepts case IDs with channel suffix),
  - added preflight checks for DB connectivity, OpenAI key presence, and schema-drift sentinel (`WorkspaceSettings.aiRouteBookingProcessEnabled`),
  - dry-run now continues with non-blocking schema warnings; live runs fail fast on blocking infra issues.
- Added artifact diagnostics:
  - artifact config now includes `threadIdsFile`, `judgePromptKey`, `judgeSystemPrompt`,
  - per-case results now include `failureType` classification (`infra_error`, `judge_error`, `draft_quality_error`, etc.).
- Improved judge token robustness:
  - increased replay judge default token ceilings,
  - added dynamic budget scaling using token-estimated judge input size.

Validation this turn:
- `node --conditions=react-server --import tsx --test lib/ai-replay/__tests__/cli.test.ts` ✅
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-145/replay-case-manifest.json --dry-run` ✅
- `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3` ❌ (blocked by explicit preflight schema drift check)

Current status:
- Dual-track mode (`decision|outbound|both`) remains open; this turn delivered infra attribution + deterministic manifest replay + judge diagnostics foundations.

Progress update (2026-02-12 07:05 UTC):
- Cleared replay schema drift by running `npm run db:push` (column `WorkspaceSettings.aiRouteBookingProcessEnabled` now present in runtime DB).
- Live replay now executes end-to-end on manifest with real model generation + judge:
  - `run-2026-02-12T06-51-35-686Z.json` → evaluated=8, passed=2
  - `run-2026-02-12T07-00-06-514Z.json` → evaluated=7, passed=1
  - `run-2026-02-12T07-03-11-855Z.json` → evaluated=7, passed=3
- Added root-cause telemetry notes from artifact analysis:
  - case `59dc...`: timezone alignment fixed to PST but still fails strict scheduling-window/booking-only policy.
  - case `bfb...`: still fails required pricing phrasing + required qualification wording policy.
  - case `2a70...`: now passes after scheduling-only/voice prompt tightening.
- Executed required client-id live replay gate after unblock:
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3`
  - Result artifact `run-2026-02-12T07-08-47-271Z.json`: evaluated=15, passed=4, failedJudge=11, failed=0.
- Still open for 145d:
  - true dual-track replay mode flags (`--mode decision|outbound|both`) and per-track artifact fields are not fully implemented yet.
