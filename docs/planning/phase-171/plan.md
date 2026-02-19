# Phase 171 — Inngest Queue Stall Prevention (Karpathy Realignment)

## Purpose
Fix the concrete failure mode where lead work stalls for 30+ minutes and never reaches AI draft/Slack notification, while keeping the solution simple, testable, and safe to roll out.

## Context
Observed production symptom: `kurt@restorationchurchsd.com` stayed queued with no AI send and no Slack notification.
Observed system behavior: cron dispatch kept enqueueing events while `process-background-jobs` had a stuck `RUNNING` run and pending queue age grew.
High-confidence root cause class: global serialization plus stale run/lock recovery gaps.
User direction lock: this phase must both stabilize immediately and produce a concrete architecture handoff for 100k-user scaling in Phase 172, with explicit root-cause visibility for long-running executions.

## Assumptions
We keep Inngest as the orchestrator (no queue platform migration in this phase).
We preserve existing idempotency/dedupe semantics and AI safety gates.
We implement only the minimal schema/config changes required for liveness and throughput.

## Non-Goals
No full pipeline rewrite.
No broad refactor of unrelated cron/webhook paths.
No speculative features unless canary evidence proves they are required.

## Repo Reality Check (RED TEAM)

- What exists today:
  - `lib/background-jobs/runner.ts` already has stale `BackgroundJob` lock release logic (`RUNNING` -> `PENDING` after `lockedAt` cutoff), plus per-row claim semantics.
  - `lib/inngest/functions/process-background-jobs.ts` is wired via `writeInngestJobStatus` and runs `processBackgroundJobs()`, but does not itself enforce stale `BackgroundFunctionRun` recovery policy.
  - `app/api/cron/background-jobs/route.ts` supports dispatch windows (`BackgroundDispatchWindow`) and still contains inline processing path comments/fallback surfaces.
  - Prisma models/enums for `BackgroundJob`, `BackgroundDispatchWindow`, and `BackgroundFunctionRun` exist in `prisma/schema.prisma`.
- What the original plan assumed:
  - Stale-run recovery was entirely missing (partly true only for function-run ledger; false for job-row locks).
  - Validation could stop at generic AI replay commands without manifest/judge diagnostics.
- Verified touch points:
  - `lib/inngest/functions/process-background-jobs.ts`
  - `lib/background-jobs/runner.ts`
  - `app/api/cron/background-jobs/route.ts`
  - `prisma/schema.prisma`
  - `lib/inngest/events.ts`
- Repo mismatches fixed in this plan:
  - Clarified that stale-lock recovery must target `BackgroundFunctionRun`/dispatch liveness gaps, not duplicate existing `BackgroundJob` stale release behavior.
  - Added mandatory manifest-driven replay checks and judge diagnostic review for AI/message impact.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 169 | Active | Inngest cron/webhook contract and dispatch semantics | Reuse event/flag contract; avoid diverging dispatch-key/idempotency semantics. |
| Phase 170 | Active | Perf/observability conventions and reliability evidence format | Reuse metric/log naming and artifact shape where possible. |
| Phase 167 | Active | Runtime timeout behavior | Keep stale-run logic compatible with timeout budgets. |
| Phase 165 | Active | Background dispatch ledger/function-run model (`BackgroundDispatchWindow`, `BackgroundFunctionRun`) | Re-read shared files before edits; do not fork ledger semantics. |
| Working tree | Active | `docs/planning/phase-171/` uncommitted | Keep this phase scoped to plan hardening only during RED TEAM pass. |

## Objectives
* [ ] Prevent one stuck run from blocking the entire queue.
* [ ] Reduce queue delay with bounded, safe parallelism.
* [ ] Make queue health observable with actionable alerts.
* [ ] Prove AI/message safety is preserved with manifest-driven replay evidence.
* [ ] Produce a decision-complete handoff into Phase 172 (fairness + autoscaling architecture) without expanding this phase into a mega-implementation.

## Constraints
Surgical changes only in background-job + Inngest paths.
Feature-flagged rollout and explicit rollback trigger required.
Every planned step must have a verify check.
Keep `CRON_SECRET` auth checks and existing webhook/cron secret gates intact.
Do not alter user-facing inbox read-path behavior in this phase.

## Success Criteria
No stale `process-background-jobs` function-run can block queue progress past the locked stale threshold of 15 minutes.
Oldest due-pending queue age recovers to p95 <= 5 minutes during canary after warm-up.
No duplicate customer-visible sends are introduced (duplicate-send invariant remains 0 in canary evidence packet).
Alert path is wired and tested through the locked sink (`Slack-only engineering channel`) for stale-run and queue-age breaches.
AI/message validation gates pass:
`npm run test:ai-drafts`
`npm run test:ai-replay -- --thread-ids-file docs/planning/phase-171/replay-case-manifest.json --dry-run`
`npm run test:ai-replay -- --thread-ids-file docs/planning/phase-171/replay-case-manifest.json --concurrency 3`
Fallback only when manifest is unavailable:
`npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
`npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`
Replay artifact review explicitly captures:
`judgePromptKey`, `judgeSystemPrompt`, per-case `failureType`, and invariant evidence (`slot_mismatch`, `date_mismatch`, `fabricated_link`, `empty_draft`, `non_logistics_reply`).

## Execution Loop (Step -> Verify)
1. Finalize failure contract (thresholds + rollback trigger) -> verify: one operator query pack can classify stale run, queue age, duplicate invariant pass/fail.
2. Ship stale-run detection + recovery fence for function-run liveness gaps using locked semantics:
   - attempt in-run continuation for remaining claimable work when feasible,
   - if true in-run continuation is not supported, execute fenced auto re-dispatch successor with strict dedupe.
   -> verify: pending jobs resume without redoing already-succeeded jobs.
3. Ship bounded parallel processing for due jobs with locked initial sizing (`batchSize=20`, `workerConcurrency=4`) -> verify: queue age decreases under load without duplicate sends.
4. Ship minimal queue health telemetry + alerts -> verify: stale-run and queue-age breaches fire one deterministic alert path each.
5. Run AI/message and replay gates with manifest + diagnostics review -> verify: required commands pass and replay artifacts include judge metadata + failure taxonomy.
6. Only if gates fail, activate conditional hardening -> verify: specific failed metric improves and regression risk stays bounded.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Global queue stall persists because only `BackgroundJob` stale locks are recovered while `BackgroundFunctionRun` liveness gaps remain unbounded.
  - Mitigation: define and implement explicit stale function-run cutoff + safe recovery fence in must-have flow.
- Bounded parallelism increases throughput but can amplify duplicate side effects when idempotency boundaries are unclear.
  - Mitigation: preserve per-job claim semantics and validate duplicate invariant in canary + replay evidence.

### Missing or ambiguous requirements
- Stale threshold, canary window length, and queue-age target were not explicit numeric gates.
  - Mitigation: add default assumptions + Open Questions for human lock-in.
- Alert sink and on-call ownership were unspecified.
  - Mitigation: require one alert path owner before rollout decision.
- New reliability env toggles and operator query pack were initially undocumented.
  - Mitigation: document controls in `.env.example` + `README.md`, and ship query/runbook artifacts for canary operations.

### Repo mismatches (fixed in this plan)
- Original framing implied stale recovery was absent globally.
  - Correction: stale recovery already exists for `BackgroundJob` rows in `runner.ts`; remaining gap is function-run/dispatch liveness.
- Original validation omitted manifest-driven replay and judge metadata review.
  - Correction: add mandatory manifest-based replay gates plus diagnostics checks.

### Performance / timeout risks
- Higher concurrency can increase DB contention and produce false recovery churn.
  - Mitigation: keep small fixed concurrency with rollback flag and compare queue-age improvement vs error-rate drift.

### Security / permissions risks
- Cron/background routes can be accidentally loosened during refactors.
  - Mitigation: preserve `Authorization: Bearer ${CRON_SECRET}` checks and keep dispatch-only behavior behind explicit flags.

### Testing / validation risks
- Without manifest-driven replay, AI/message regressions can pass deterministic tests but fail realistic historical threads.
  - Mitigation: enforce dry-run + live replay on `docs/planning/phase-171/replay-case-manifest.json`, plus judge metadata review.

### Multi-agent coordination risks
- Phases 165/167/169 touched the same background-job + Inngest surfaces.
  - Mitigation: require pre-flight conflict check (recent phase overlap + working tree check) before implementation slices.

## Coordination Strategy (Multi-Agent)
- Pre-flight before each implementation slice:
  - Check current working tree and identify overlapping edits on `lib/background-jobs/*`, `lib/inngest/*`, `app/api/cron/background-jobs/route.ts`, `prisma/schema.prisma`.
  - Re-read shared files immediately before editing (do not rely on stale assumptions from older phase docs).
- Conflict handling:
  - If overlap is detected with active phase changes, merge semantically and record the resolution in the subphase Output notes.
  - If a dependency phase changes dispatch/idempotency contracts, pause the slice and re-baseline acceptance gates before proceeding.

## Subphase Index
* a — Failure Contract + Acceptance Gates
* b — Must-Have Fix: Stale Run Recovery
* c — Must-Have Fix: Bounded Parallel Queue Drain
* d — Must-Have Fix: Queue Health Signals + Alerts
* e — Conditional Hardening (Only If Canary Fails)
* f — Final Validation + Rollout Decision
* g — Coordination + Replay Evidence Closure (append-only hardening)

## Decision Locks (2026-02-19)

- Stale recovery cutoff: 15 minutes.
- Queue-age go/no-go threshold: oldest due-pending age p95 <= 5 minutes.
- Alert ownership path: Slack-only engineering channel.
- Recovery contract:
  - preferred behavior is safe continuation of remaining claimable work,
  - required fallback is fenced auto re-dispatch successor with strict dedupe if in-run continuation is not technically viable.
- Throughput contract:
  - chunk + bounded parallelism,
  - initial settings `batchSize=20`, `workerConcurrency=4`.

## Phase 172 Handoff Contract

- This phase must emit a complete architecture handoff to Phase 172 for 100k-user scale controls:
  - global capacity management,
  - per-workspace fairness quotas,
  - autoscaling with contention/error guardrails,
  - enterprise quota escalation path with strict dedupe preserved.
- Phase 171 remains stabilization-first; large architecture implementation lands in Phase 172.

## Assumptions (Agent)

- Existing `BackgroundJob` stale-lock release behavior in `runner.ts` remains intact; this phase extends missing function-run liveness controls.
- Manifest-driven replay remains mandatory because queue behavior can change AI/message timing and downstream send outcomes.

## Phase Summary (running)
- 2026-02-19 02:32:46Z — Implemented must-have stabilization slices for stale-run recovery, bounded parallel queue drain, and queue-health telemetry; completed lint/build + full NTTAN replay gates (client fallback + manifest variants) and recorded AB replay evidence for final go/no-go (files: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/dispatch-ledger.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/app/api/cron/background-jobs/route.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/inngest/functions/process-background-jobs.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/maintenance.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/replay-case-manifest.json`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/b/plan.md`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/c/plan.md`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/d/plan.md`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/f/plan.md`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/g/plan.md`).
- 2026-02-19 03:51:00Z — Closed operator-evidence gap by documenting new reliability env controls in `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/.env.example` and `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/README.md`, then added Phase 171 canary/runbook artifacts (`queue-health-operator-queries.sql`, `queue-stall-runbook.md`, `queue-health-snapshot-2026-02-19T03-50-06Z.md`) to support final rollout decision.
- 2026-02-19 04:28:28Z — Deployed production (`https://zrg-dashboard.vercel.app`) and executed authenticated live canary on `/api/cron/background-jobs`; stale-run watchdog recovered 11 stale `process-background-jobs` runs in one cycle (`mode=inline-stale-run-recovery`), post-checks confirmed `pending_due=0`, `stale_over_15m=0`, dispatch health stayed `ENQUEUED=60/60m`, and duplicate-send indicators remained zero (`ghlId`, `emailBisonReplyId`, `inboxxiaScheduledEmailId`, `unipileMessageId`, `webhookDedupeKey`). Evidence captured in `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/artifacts/queue-health-snapshot-2026-02-19T04-28-28Z.md`.
- 2026-02-19 04:36:40Z — Added operator visibility guard for intentional AI draft skips in `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/email-inbound-post-process.ts` (posts Slack ops notification when scheduling flow/call-without-phone suppresses draft creation and no action-signal alert was emitted), redeployed production, and captured post-redeploy health snapshot with no stale-run regression (`pending_due=0`, `stale_over_15m=0`, dispatch healthy). Evidence: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/artifacts/queue-health-snapshot-2026-02-19T04-36-40Z.md`.
- 2026-02-19 04:36:40Z — Added incident-forensics artifact for `kurt@restorationchurchsd.com` showing job timing delays, follow-up-task routing, and why draft/slack appeared silent before this patch: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/artifacts/kurt-incident-analysis-2026-02-19.md`.
