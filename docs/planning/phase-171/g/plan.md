# Phase 171g — Coordination + Replay Evidence Closure

## Focus
Close the remaining RED TEAM gaps that were not explicitly covered by completed subphases: cross-phase coordination checks and manifest-driven replay diagnostics required for rollout safety.

## Inputs
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/plan.md`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-169/plan.md`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/inngest/functions/process-background-jobs.ts`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/app/api/cron/background-jobs/route.ts`

## Work
1. Run pre-flight conflict check before implementation slices.
verify: overlap and working-tree status for shared files is recorded before edits.
2. Create/refresh replay manifest at `docs/planning/phase-171/replay-case-manifest.json` with queue-stall-relevant thread IDs.
verify: manifest exists, is valid JSON, and references realistic recent cases.
3. Run required AI/message replay gates:
`npm run test:ai-drafts`
`npm run test:ai-replay -- --thread-ids-file docs/planning/phase-171/replay-case-manifest.json --dry-run`
`npm run test:ai-replay -- --thread-ids-file docs/planning/phase-171/replay-case-manifest.json --concurrency 3`
verify: all commands pass or produce a classified failure packet.
4. Review replay artifacts for gate diagnostics:
`judgePromptKey`, `judgeSystemPrompt`, and per-case `failureType`.
verify: each failed case has explicit failure classification and remediation owner.
5. If prior replay artifact exists, run optional baseline compare:
`npm run test:ai-replay -- --thread-ids-file docs/planning/phase-171/replay-case-manifest.json --baseline .artifacts/ai-replay/<prior-run>.json`
verify: regression delta is documented (pass/fail per failure type).

## Output
Coordination + replay evidence packet attached to phase artifacts, with explicit pass/fail status for AI/message safety and queue-stall regressions.

## Handoff
If this subphase passes, return to Phase 171f for final go/no-go.
If this subphase fails, route remediation to the owning must-have subphase (`b`, `c`, `d`, or `e`) based on `failureType`.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Multi-agent preflight executed:
    - `git status --porcelain` showed overlapping active work folders (`phase-171`, `phase-172` uncommitted).
    - scanned last 10 phases and confirmed direct domain overlap with `phase-172` (same background/Inngest surfaces).
  - Created replay manifest:
    - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/replay-case-manifest.json`
    - seeded from selected queue-stall-relevant replay cases.
  - Captured fallback replay evidence (pre-manifest):
    - dry run artifact: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/.artifacts/ai-replay/run-2026-02-19T02-00-23-901Z.json`
    - live run artifact: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/.artifacts/ai-replay/run-2026-02-19T02-00-30-315Z.json`
  - Captured manifest-driven replay evidence:
    - dry run artifact: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/.artifacts/ai-replay/run-2026-02-19T02-08-56-721Z.json`
    - live AB artifact: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/.artifacts/ai-replay/run-2026-02-19T02-09-02-455Z.json`
  - Added operator evidence kit:
    - query pack: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/artifacts/queue-health-operator-queries.sql`
    - runbook: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/artifacts/queue-stall-runbook.md`
    - snapshot: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/artifacts/queue-health-snapshot-2026-02-19T03-50-06Z.md`
  - Deployed Phase 171 fixes to production and executed live canary:
    - deployment alias: `https://zrg-dashboard.vercel.app`
    - canary endpoint call returned `mode=inline-stale-run-recovery` with `staleRecovery.recovered=11`.
  - Captured post-deploy/post-recovery evidence snapshot:
    - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/artifacts/queue-health-snapshot-2026-02-19T04-28-28Z.md`
  - Added draft-skip operator visibility patch:
    - file: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/email-inbound-post-process.ts`
    - behavior: when draft generation is intentionally skipped due scheduling follow-up task or call-without-phone (and no action-signal alert exists), send a deduped Slack ops notification to workspace notification channels.
  - Captured post-redeploy health snapshot:
    - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/artifacts/queue-health-snapshot-2026-02-19T04-36-40Z.md`
  - Captured incident-specific forensic packet:
    - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/artifacts/kurt-incident-analysis-2026-02-19.md`
- Commands run:
  - `npm run test:ai-drafts` — pass
  - `npm run test:ai-replay -- --client-id f222e9b1-43e4-4929-bbad-92b557e9bae4 --dry-run --limit 20` — pass
  - `npm run test:ai-replay -- --client-id f222e9b1-43e4-4929-bbad-92b557e9bae4 --limit 20 --concurrency 3` — pass
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-171/replay-case-manifest.json --dry-run` — pass
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-171/replay-case-manifest.json --concurrency 3` — pass
  - `vercel --prod --yes` — pass
  - `vercel --prod --yes` (post draft-skip visibility patch) — pass
  - `vercel env pull .env.local --environment production --yes` — pass
  - authenticated cron canary call on `/api/cron/background-jobs` — status 200, stale recovery path exercised
  - authenticated cron check on `/api/cron/background-jobs` after redeploy — status 202, dispatch path healthy
  - Supabase operator SQL checks (pre/post) — stale run cluster cleared and queue due depth stable at zero
- Coordination notes:
  - Conflict detected: `phase-172` currently targets the same files (`lib/background-jobs/*`, `lib/inngest/*`, `app/api/cron/background-jobs/route.ts`).
  - Resolution this turn: constrained edits to Phase 171 must-have stabilization surfaces only and preserved existing dispatch-key/idempotency contracts from active phases.
- Evidence summary:
  - `judgePromptKey`: `meeting.overseer.gate.v1` (plus null for skipped cases)
  - `judgeSystemPrompt`: scheduling overseer gate prompt (`systemPrompt` captured in artifacts)
  - failureType counts (manifest live AB run, overseer summary): `draft_quality_error=3`, all other failure types `0`
  - critical invariant counts: `slot_mismatch=0`, `date_mismatch=0`, `fabricated_link=0`, `empty_draft=0`, `non_logistics_reply=0`
  - live queue evidence:
    - pre-recovery: `running_count=11`, `stale_over_15m=11`, `pending_due=0`
    - post-recovery: `running_count=0`, `stale_over_15m=0`, `pending_due=0`
    - dispatch health unchanged: `ENQUEUED=60`, `ENQUEUE_FAILED=0`, `INLINE_EMERGENCY=0` (last 60m)
    - duplicate-send indicators (last 60m): zero across `ghlId`, `emailBisonReplyId`, `inboxxiaScheduledEmailId`, `unipileMessageId`, `webhookDedupeKey`
    - post-redeploy queue evidence: `pending_due=0`, `stale_running_jobs=0`, `stale_over_15m=0`, active `running_count=1` (non-stale)
- Blockers:
  - Explicit Slack alert-path breach simulation remains pending in a controlled staging window (not run in production).
- Next concrete steps:
  - Map the three `draft_quality_error` cases back to concrete remediation ownership and carry into Phase 172 quality backlog.
  - Run one staging breach simulation for stale-run and queue-age alert sink proof.
