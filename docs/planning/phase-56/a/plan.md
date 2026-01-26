# Phase 56a — Phase 53 Production Rollout (Schema + Flags)

## Focus
Safely roll out Phase 53’s production stability changes by applying schema first, validating with the ship-check, backfilling rollups, and enabling flags gradually with monitoring.

## Inputs
- `docs/planning/phase-53/review.md`
- `docs/planning/phase-53/runbook.md`
- `scripts/phase-53-ship-check.ts`
- `scripts/backfill-lead-message-rollups.ts`

## Work
1) **Apply schema to production**
   - Run `npm run db:push` against the intended prod database (`DIRECT_URL` configured).

2) **Ship-check**
   - Run `node --import tsx scripts/phase-53-ship-check.ts --strict` and confirm required tables/columns exist.

3) **Backfill**
   - Run `node --import tsx scripts/backfill-lead-message-rollups.ts` (full) or per workspace via `--clientId`.

4) **Deploy with flags OFF**
   - Keep flags **off** initially:
     - `INBOXXIA_EMAIL_SENT_ASYNC=0`
     - `UNIPILE_HEALTH_GATE=0`

5) **Enable flags gradually**
   - Enable `INBOXXIA_EMAIL_SENT_ASYNC=1` first; monitor webhook 504s and queue drain health.
   - Enable `UNIPILE_HEALTH_GATE=1` next; monitor LinkedIn followup pause rates and notification volume.

## Output
- A short rollout log (what was run, where, and the result) plus any anomalies observed (link to Vercel logs / metrics).

## Handoff
Once Phase 53 is stable in production, proceed to Phase 56b to validate/enable Phase 55 cron safely.

