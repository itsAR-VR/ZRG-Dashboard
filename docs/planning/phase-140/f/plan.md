# Phase 140f - Live AI Replay Harness (Real Generation + LLM Judge)

## Focus

Implement a production-faithful replay harness that:
- runs real live draft generations against historical inbound replies,
- supports batch/multi-case runs with concurrency + retries,
- scores each output via LLM judge,
- writes JSON artifacts for long-term agent regression tracking.

## Inputs

- User requirement: deterministic fixtures are not enough; need real end-to-end model generation tests.
- Existing draft path: `generateResponseDraft` in `lib/ai-drafts.ts`.
- Existing prompt runner + telemetry plumbing.

## Work

1. Add replay core modules under `lib/ai-replay/`:
   - CLI parsing/defaults
   - case selection + risk scoring
   - live run-case execution (generation + judge)
   - artifact persistence + baseline diff
2. Add live runner script:
   - `scripts/live-ai-replay.ts`
3. Add replay judge prompt template:
   - `ai.replay.judge.v1` in `lib/ai/prompt-registry.ts`
4. Add scripts:
   - `test:ai-replay`
   - `test:ai-replay:sample`
5. Add tests:
   - selector risk scoring
   - judge schema validation
   - CLI arg parsing
6. Document for long-term agent usage in:
   - `AGENTS.md`
   - `CLAUDE.md`
   - `README.md`

## Output

- Real replay runner implemented with:
  - auto-selection of high-risk historical inbound messages,
  - optional explicit message ID mode (`--thread-ids`),
  - batch concurrency (`--concurrency`) and per-case retries (`--retries`),
  - baseline comparisons (`--baseline`),
  - full-text artifacts in `.artifacts/ai-replay/*.json` (gitignored).
- Default behavior deletes replay-generated drafts after scoring (`--keep-drafts` to retain).

## Validation

- `npm run lint`
- `npm run build`
- `node --conditions=react-server --import tsx --test lib/ai-replay/__tests__/select-cases.test.ts lib/ai-replay/__tests__/judge-schema.test.ts lib/ai-replay/__tests__/cli.test.ts`
- Live smoke command (requires env + client id):
  - `npm run test:ai-replay -- --client-id <clientId> --limit 2 --concurrency 1`

## Handoff

Next agent can run targeted live replays by workspace and maintain a rolling baseline artifact for regression detection across model/prompt updates.
