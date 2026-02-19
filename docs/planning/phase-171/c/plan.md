# Phase 171c — Must-Have Fix: Bounded Parallel Queue Drain

## Focus
Increase throughput safely so pending queue age drops under sustained inbound load.

## Inputs
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/b/plan.md`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/inngest/functions/process-background-jobs.ts`

## Work
1. Add bounded parallelism for due job processing (small fixed concurrency).
verify: queue-age metric improves in controlled load test.
2. Keep existing locking/idempotency semantics while parallelizing.
verify: no increase in duplicate or conflicting job completion states.
3. Keep rollout flag for quick fallback.
verify: can switch between old and new behavior without deploy.

## Output
Throughput improvement that is minimal, reversible, and measurable.

## Handoff
Phase 171d instruments queue health and adds alerting for new failure signals.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Increased bounded worker capacity in `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`:
    - default due-job batch size raised to `20` (`BACKGROUND_JOB_CRON_LIMIT` override still supported)
    - added worker pool control `BACKGROUND_JOB_WORKER_CONCURRENCY` (default `4`, capped)
    - switched due-job processing from single loop to bounded parallel worker loops while retaining row-claim locking semantics
  - Increased Inngest function concurrency for queue drain resilience in `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/inngest/functions/process-background-jobs.ts`:
    - new env: `BACKGROUND_JOBS_INNGEST_CONCURRENCY` (default `2`, capped)
- Commands run:
  - `npm run lint` — pass
  - `npm run build` — pass
- Blockers:
  - None for implementation; canary evidence still pending.
- Next concrete steps:
  - Measure queue-age trend under load with new worker settings before widening rollout.
