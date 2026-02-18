# Phase 170f — Architecture Finalization, Rollout Guardrails, and Closeout Packet

## Focus
Finalize long-term architecture decisions from the iteration loop, define safe rollout/rollback mechanics, and ship a production-ready closeout packet.

## Inputs
- `docs/planning/phase-170/e/plan.md`
- All phase-170 artifacts

## Work
1. Consolidate accepted architecture changes (what was changed, why, expected scale impact).
2. Document rejected alternatives and anti-overengineering rationale.
3. Define rollout order, canary thresholds, alert triggers, and rollback procedures.
4. Produce operator runbook for ongoing performance monitoring and future regressions.
5. Run the single end-of-phase replay certification pass (preferred manifest-driven command; fallback to client-id mode when manifest is unavailable) and record diagnostics.
6. Prepare a follow-on backlog for medium/high-effort improvements not shipped in this phase.

## Validation
- All success criteria in root plan satisfied
- Regression gate checklist complete
- Production readiness review completed
- Single replay pass completed:
  - Preferred: `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-170/replay-case-manifest.json --concurrency 3`
  - Fallback: `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`
- Replay artifact review includes:
  - `judgePromptKey`
  - `judgeSystemPrompt`
  - per-case `failureType`

## Output
- Final closeout report: `docs/planning/phase-170/review.md`
- Architecture decision summary: `docs/planning/phase-170/artifacts/architecture-decisions.md`

## Handoff
Phase complete. Next phase starts only for deferred backlog items that exceed current risk/time budget.
