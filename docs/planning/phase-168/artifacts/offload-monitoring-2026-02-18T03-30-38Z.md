# Offload Monitoring Snapshot

## Source Artifacts
- queue/ledger snapshot: `docs/planning/phase-168/artifacts/offload-snapshot-2026-02-18T03-30-38Z.json`
- cron probe table: `docs/planning/phase-168/artifacts/cron-probes-2026-02-18T03-25-40Z.tsv`
- runtime stream sample: `docs/planning/phase-168/artifacts/vercel-live-stream-2026-02-18T03-23-25Z.jsonl`

## Queue + Ledger Health
- `WebhookEvent` outstanding (`PENDING`/`RUNNING`): `0` in snapshot window.
- `WebhookEvent` recent 30m and 24h grouped rows: none returned in this environment snapshot.
- `BackgroundFunctionRun` recent 30m and 24h grouped rows: none returned in this environment snapshot.

## Cron/Dispatch Health
- `/api/cron/response-timing` returned `202` with dispatch-only payload.
- `/api/cron/background-jobs` returned `200` with `dispatch-duplicate-suppressed` payload and existing ENQUEUED dispatch IDs.
- `/api/cron/followups` and `/api/cron/availability` returned `200` `locked` (expected lock protection behavior).
- `/api/cron/appointment-reconcile` returned `200` with `health: healthy`.
- `/api/cron/emailbison/availability-slot` probe hit client timeout (`000` after 20s max-time); runtime stream still shows recurring info-level activity on this route with no sampled `error` lines.

## Threshold Evaluation (Phase 168e Draft)
- Queue growth trigger (monotonic growth over 30m): **not triggered** in this snapshot (`0` outstanding).
- Background failure ratio trigger (`>10%`): **not computable** in this snapshot (`0` sampled runs).
- Reversal-loop trigger (>=2 distinct 2-minute slices): **not observed** in sampled live stream window.

## Operator Notes
- Keep the emailbison availability-slot endpoint under watch because one direct probe timed out even though sampled logs remained info-level.
- Re-run this snapshot during a higher-traffic window to populate non-zero ledger ratios.
