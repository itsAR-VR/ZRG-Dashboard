# Phase 170c — Master Inbox Throughput Hardening (Search/Cursor/Reply-State)

## Focus
Stabilize Inbox latency under multi-user load by reducing high-variance query patterns in search, cursor pagination, and reply-state filtering.

## Targets
- Inbox counts endpoint p95 `< 2.0s` (server-reported `x-zrg-duration-ms`)
- Inbox conversations endpoint p95 `< 3.0s` (server-reported `x-zrg-duration-ms`)
- Inbox email search p95 `< 2.0s` under authenticated canary runs
- Multi-user staged runs keep error rate `< 1%` with no sustained p95 regression band-over-band

## Inputs
- `docs/planning/phase-170/b/plan.md`
- `app/api/inbox/*`
- `actions/lead-actions.ts`

## Work
1. Profile cursor/list queries for heavy filters (`search`, `responses`, `attention`, `previous_attention`, score filters).
2. Replace high-variance multi-batch scan behavior with bounded, index-friendly selection paths where possible.
3. Reduce duplicate transformations and expensive per-request enrichment work on list endpoints.
4. Validate fail-open safety behavior and auth semantics remain unchanged.
5. Add minimal diagnostics for list/query budget enforcement.

## Validation
- `npm run lint`
- `npm run build`
- `npm test`
- `npm run test:ai-drafts`
- `npm run test:e2e -- e2e/inbox-perf.spec.mjs`
- `npm run probe:inbox -- --client-id <workspaceId> --samples 20 --out docs/planning/phase-170/artifacts/inbox-canary.json`
- `npm run probe:staged-load -- --client-id <workspaceId> --no-analytics --bands small:2:4,medium:6:4,large:12:4 --out docs/planning/phase-170/artifacts/load-checks.json`
- Replay validation deferred to phase-end closeout (`170f`) per Phase 170 override.

## Output
- Inbox throughput patch set + evidence in `docs/planning/phase-170/artifacts/inbox-pass.md`

## Handoff
Subphase d applies similar payload-shaping principles to Settings hydration and deferred section loading.
