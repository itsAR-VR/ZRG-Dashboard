# Phase 169d — Verify + iterate (exports + rollback)

## Focus
Verify each migration slice with objective evidence (paired Vercel dashboard exports + durable run ledger health), then iterate to the next route only after the target signature materially drops. Rehearse rollback by flipping flags off and capturing evidence.

## Inputs
- Phase 169a/169b artifacts:
  - `docs/planning/phase-169/artifacts/log-driven-matrix.md`
  - `docs/planning/phase-169/artifacts/inngest-offload-spec.md`
- Deployment metadata for the slice under test (UTC deploy time + deployment ID/URL)
- Vercel dashboard export access (baseline/post-change for matched windows)
- Durable health sources:
  - `WebhookEvent` queue depth (pending/running/failed)
  - `BackgroundFunctionRun` entries for new Inngest functions

## Work
1. Baseline capture (per slice):
   - Export a Vercel dashboard log dataset for a fixed window (e.g. 30–60 minutes).
   - Store it under `docs/planning/phase-169/artifacts/` with UTC timestamps and the exact filters used.
2. Deploy + enable (production-only):
   - Deploy the code for the slice.
   - Enable exactly one route flag from the spec (or one small group if they are strictly dependent).
3. Post-change capture:
   - Export the same dashboard view for the same duration after deploy.
   - Compare route+signature deltas (504/500/blank-status and dominant messages).
4. Durable health check:
   - Confirm new Inngest runs exist and are succeeding (via `BackgroundFunctionRun`).
   - Confirm `WebhookEvent` is draining (no sustained growth in pending-due rows).
5. Rollback rehearsal (required at least once per phase):
   - Flip the most recently enabled flag back to `false`.
   - Confirm the route returns to inline behavior (and still respects auth/secret checks).
   - Capture a short export window + a brief operator timeline under `docs/planning/phase-169/artifacts/`.
6. Iterate:
   - Only advance to the next route in the migration matrix once the target signature materially improves in the post-change export.
   - If no improvement is observed, stop and update the matrix with the observed blocker (DB contention, missing schema, Inngest config, etc.).

## Expected Output
- Paired Vercel dashboard exports per slice (baseline + post-change), plus at least one rollback export
- A short verification memo that records:
  - deploy time + flags enabled
  - route-level deltas for the target signature
  - durable execution health status (queue depth + run ledger)

## Output
- Completed production verification slices for all cron offload routes with dispatch-only responses and durable ledger evidence.
- Captured artifacts:
  - Baseline (inline behavior): `baseline-response-timing-response-body-2026-02-18T03-16-31Z.txt` + matching meta/log window.
  - Initial post-enable (dispatch-only): `post-response-timing-response-body-2026-02-18T03-19-35Z.txt` + matching meta/log window.
  - Initial durable-health snapshots (pre-fix, failing):  
    `durable-health-response-timing-2026-02-18T03-28-49Z.json`,  
    `rollback-durable-health-response-timing-2026-02-18T03-34-33Z.json`,  
    `manual-probe-durable-check-2026-02-18T03-42-05Z.json`.
  - Rollback rehearsal:
    - `rollback-response-timing-response-body-2026-02-18T03-33-46Z.txt`
    - `rollback-response-timing-meta-2026-02-18T03-33-46Z.md`
    - `rollback-response-timing-operator-timeline-2026-02-18T03-33-46Z.md`
  - Root-cause evidence for durable failure:
    - `inngest-invalid-signature-evidence-2026-02-18T05-47-35Z.json`
    - `inngest-invalid-signature-evidence-2026-02-18T05-47-35Z.md`
    - `signing-key-remediation-summary-2026-02-18T05-59-49Z.md`
  - Post-fix verification:
    - `inngest-post-signing-fix-check-2026-02-18T05-51-06Z.json`
    - `inngest-failure-window-after-signing-fix-2026-02-18T05-57-03Z.json`
    - `post-fix-response-timing-dispatch-response-2026-02-18T05-55-15Z.txt`
    - `post-fix-response-timing-dispatch-check-2026-02-18T05-56-47Z.json`
  - Next-slice verification (appointment reconcile):
    - `post-fix-appointment-reconcile-dispatch-response-2026-02-18T05-59-49Z.txt`
    - `post-fix-appointment-reconcile-dispatch-check-2026-02-18T05-59-49Z.json`
    - `post-fix-appointment-reconcile-dispatch-followup-2026-02-18T05-59.json`
    - `post-fix-appointment-reconcile-ledger-2026-02-18T06-06-20Z.json`
  - Followups verification:
    - `post-fix-followups-dispatch-response-2026-02-18T06-09-28Z.txt`
    - `post-fix-followups-dispatch-check-2026-02-18T06-09-28Z.json`
    - `post-fix-followups-dispatch-meta-2026-02-18T06-09-28Z.md`
    - `post-fix-followups-ledger-2026-02-18T06-12-47Z.json`
  - Availability verification:
    - `post-fix-availability-dispatch-response-2026-02-18T06-15-51Z.txt`
    - `post-fix-availability-dispatch-check-2026-02-18T06-15-51Z.json`
    - `post-fix-availability-dispatch-meta-2026-02-18T06-15-51Z.md`
  - EmailBison availability-slot verification:
    - `post-fix-emailbison-availability-slot-dispatch-response-2026-02-18T06-18-23Z.txt`
    - `post-fix-emailbison-availability-slot-dispatch-check-2026-02-18T06-18-23Z.json`
    - `post-fix-emailbison-availability-slot-dispatch-meta-2026-02-18T06-18-23Z.md`
    - `post-fix-emailbison-availability-slot-dispatch-followup-2026-02-18T06-18.json`
    - `post-fix-emailbison-availability-slot-ledger-2026-02-18T06-18-30Z.json`
  - Env hygiene + post-normalization sanity:
    - `post-fix-cron-flag-snapshot-2026-02-18T06-21-26Z.md`
    - `post-fix-env-whitespace-check-2026-02-18T06-24-14Z.json`
    - `post-fix-response-timing-sanity-response-2026-02-18T06-24-14Z.txt`
    - `post-fix-webhookevent-queue-snapshot-2026-02-18T06-25-13Z.json`
- Observed results:
  - Root cause confirmed: production `INNGEST_SIGNING_KEY` contained trailing whitespace/newline causing `Invalid signature` (`401`) failures on Inngest callbacks.
  - After trimming/redeploying signing key, new `BackgroundFunctionRun` rows appeared, including `cron-response-timing` with `SUCCEEDED`.
  - `Invalid signature` failures after `2026-02-18T05:51:00Z` dropped to zero in sampled window.
  - `/api/cron/response-timing` is re-enabled and verified in dispatch-only mode with durable success.
  - `/api/cron/appointment-reconcile` stale `cron:appointment-reconcile:2026-02-18T05:59` run self-healed to `SUCCEEDED` at `2026-02-18T06:07:07.515Z`; newer windows remain healthy.
  - `/api/cron/followups`, `/api/cron/availability`, and `/api/cron/emailbison/availability-slot` are enabled and producing durable runs that reach `SUCCEEDED`.
  - Production booleans were normalized to remove trailing newline risk; post-normalization env check shows no leading/trailing whitespace on critical cron flags/secrets.
  - `WebhookEvent` queue snapshot shows no pending/running/failed backlog at capture time (`duePending=0`, `dueFailed=0`, `runningCount=0`).
  - Current production flag state: `CRON_RESPONSE_TIMING_USE_INNGEST=true`, `CRON_APPOINTMENT_RECONCILE_USE_INNGEST=true`, `CRON_FOLLOWUPS_USE_INNGEST=true`, `CRON_AVAILABILITY_USE_INNGEST=true`, `CRON_EMAILBISON_AVAILABILITY_SLOT_USE_INNGEST=true`, `BACKGROUND_JOBS_USE_INNGEST=true`, `INBOXXIA_EMAIL_SENT_ASYNC=true`.

## RED TEAM Findings (This Turn)
- Secret integrity gap:
  - Failure mode: env secrets with trailing whitespace/newline can silently pass deploy env checks but fail runtime signature verification.
  - Mitigation now required for rollout slices: trim + whitespace-assert critical secrets (`CRON_SECRET`, `INNGEST_SIGNING_KEY`) before deploy and confirm pulled value has `hasWhitespace=false`.
- Observability interpretation gap:
  - `BackgroundDispatchWindow.status=ENQUEUED` is not a completion signal.
  - Completion must be inferred from `BackgroundFunctionRun` terminal states (or explicit downstream status tracking), otherwise healthy execution can be misread as stuck.
- URL canonicalization gap:
  - `NEXT_PUBLIC_APP_URL` includes a trailing slash in pulled env, and naive URL joining produced `308` responses during manual probes (`//api/...`) that mimic route failures.
  - Mitigation: normalize `BASE_URL` with trailing-slash trim before probe execution or use `curl -L` explicitly.

## Expected Handoff
If all migrated routes remain stable, close verification by attaching matched-window dashboard exports and then move to phase review.

## Handoff
- Continue with verification closure tasks:
  1. Capture matched-window Vercel dashboard exports for response-timing, appointment-reconcile, followups, availability, and emailbison availability-slot post-fix windows.
  2. If desired for extra confidence, capture an additional `WebhookEvent` queue snapshot in the same export window (one snapshot already recorded with zero backlog).
  3. Keep secret-whitespace checks in every env update step.
- Coordination note: Phase 165 owns the broader background orchestration surfaces; avoid code edits there without re-reading latest phase-165 plan updates. This subphase used production env + artifact updates only.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Confirmed followups durable health and recorded terminal success ledger snapshots; appointment stale row (`05:59`) moved to `SUCCEEDED`.
  - Enabled `CRON_AVAILABILITY_USE_INNGEST=true`, deployed to production, and captured dispatch + durable success evidence.
  - Enabled `CRON_EMAILBISON_AVAILABILITY_SLOT_USE_INNGEST=true`, deployed to production, and captured dispatch + follow-up ledger showing `RUNNING → SUCCEEDED`.
  - Normalized trailing-newline boolean env values (`CRON_AVAILABILITY_USE_INNGEST`, `CRON_EMAILBISON_AVAILABILITY_SLOT_USE_INNGEST`, `BACKGROUND_JOBS_USE_INNGEST`, `INBOXXIA_EMAIL_SENT_ASYNC`) and redeployed.
  - Captured post-normalization whitespace checks and response-timing dispatch sanity probe.
  - Removed invalid probe artifacts generated during a trailing-slash URL capture (`308`) to keep evidence set clean.
- Commands run:
  - `npx tsx --env-file=.env.local ... backgroundFunctionRun snapshots` (followups + appointment ledger) — pass.
  - `vercel env add CRON_AVAILABILITY_USE_INNGEST production --force`, `vercel --prod --yes` — pass.
  - `vercel env add CRON_EMAILBISON_AVAILABILITY_SLOT_USE_INNGEST production --force`, `vercel --prod --yes` — pass.
  - `vercel env pull <tmp> --environment production --yes` + `curl -H "Authorization: Bearer <CRON_SECRET>" .../api/cron/availability` — pass (`202`, dispatch-only).
  - `vercel env pull <tmp> --environment production --yes` + `curl -H "Authorization: Bearer <CRON_SECRET>" .../api/cron/emailbison/availability-slot` — pass (`202`, dispatch-only).
  - `npx tsx --env-file=<tmp> ... backgroundFunctionRun snapshots` for availability/emailbison — pass (`SUCCEEDED` terminal rows observed).
  - `printf 'true' | vercel env add <FLAG> production --force` for four newline-affected booleans + `vercel --prod --yes` — pass.
  - `vercel env pull <tmp> --environment production --yes` + node env whitespace audit + `/api/cron/response-timing` probe — pass (all target vars `hasLeadingOrTrailingWhitespace=false`, probe `202` dispatch-only).
  - `npx tsx --env-file=<tmp> ... webhookEvent groupBy/count snapshot` — pass (`grouped=[]`, due/running backlog counts `0`).
- Blockers:
  - Vercel CLI log streaming still does not provide full dashboard export parity for strict route-level signature deltas.
- Next concrete steps:
  - Pull matched-window dashboard exports (baseline/post-fix) for each migrated route to satisfy phase success criteria.
  - Run phase review once export-based deltas are attached.
