# Phase 170e — 20-Iteration Cross-Section Verification Loop + Multi-User Load Runs

## Focus
Run at least 20 explicit optimization verification iterations across Analytics, Inbox, and Settings, including mixed multi-user scenarios.

## Inputs
- `docs/planning/phase-170/d/plan.md`
- Artifacts from subphases a/b/c/d

## Work
1. Execute a fixed 20-iteration matrix and log every iteration:
   - Iterations 1-5: Analytics primary paths
   - Iterations 6-10: Inbox primary paths
   - Iterations 11-15: Settings primary paths
   - Iterations 16-20: Mixed cross-view and concurrency stress loops
2. For each iteration, record:
   - section/view + scenario
   - code/config delta
   - latency/error metrics before/after
   - keep/revert decision
3. Run staged multi-user load checks with explicit bands:
   - `small`: `2` concurrent users, `4` requests per worker per endpoint
   - `medium`: `6` concurrent users, `4` requests per worker per endpoint
   - `large`: `12` concurrent users, `4` requests per worker per endpoint
   - Command:
     - `npm run probe:staged-load -- --client-id <workspaceId> --bands small:2:4,medium:6:4,large:12:4 --out docs/planning/phase-170/artifacts/load-checks.json`
   - Required outputs:
     - endpoint-level `p50/p95/max`, status distribution, error rate by band
     - closure summary in `docs/planning/phase-170/artifacts/load-checks.md`
4. Use Playwright/live checks only after code-level iteration deltas are captured.
5. Assign verification ownership:
   - Code + metrics capture: active implementation agent
   - Plan-gap RED TEAM: explorer sub-agent
   - Final packet sanity check: phase closeout reviewer (`170f`)

## Validation
- Iteration log completeness and metric consistency check
- `npm run lint`
- `npm run build`
- `npm test`
- `npm run test:ai-drafts` (only if message/reply logic changed during iteration loop)
- Replay validation deferred to phase-end closeout (`170f`) per Phase 170 override.

## Output
- `docs/planning/phase-170/artifacts/iteration-log.md`
- `docs/planning/phase-170/artifacts/load-checks.md`

## Handoff
Subphase f finalizes architecture decisions, rollout plan, and regression guardrails for production scale.
