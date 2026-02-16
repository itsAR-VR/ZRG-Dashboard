# Phase 155a — Merge + Deploy Phase 154 Read Path Behind Flags (Gradual Rollout + Monitor)

## Focus
Land the already-implemented Phase 154 read-path work in `main` safely, with an enterprise rollback path, before building additional architecture layers.

## Inputs
- Phase 154 branch contents (GET inbox + analytics overview endpoints, Redis caching helpers, feature flags).
- Vercel project environments and ability to set env vars.
- Upstash Redis credentials:
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`
- Feature flags:
  - `NEXT_PUBLIC_INBOX_READ_API_V1`
  - `NEXT_PUBLIC_ANALYTICS_READ_API_V1`

## Work
1. Create a PR from `phase-154` to `main`.
2. Verify CI/build parity:
   - `npm run lint`
   - `npm run typecheck`
   - `npm run build`
   - `npm test`
3. Deploy to **preview** with flags OFF initially:
   - Set Upstash env vars in preview.
   - Keep `NEXT_PUBLIC_*` flags set to `0`.
4. Enable flags in preview and run a focused smoke test:
   - Inbox loads list + counts + conversation detail.
   - Workspace switching does not crash.
   - Analytics overview loads.
5. Deploy to **production** with gradual rollout:
   - Set Upstash env vars in prod.
   - Enable one flag at a time:
     - `NEXT_PUBLIC_INBOX_READ_API_V1=1` first.
     - then `NEXT_PUBLIC_ANALYTICS_READ_API_V1=1`.
6. Monitoring (console-only + infra):
   - Watch Vercel logs for 401/403 spikes (auth regression).
   - Watch DB utilization for query spikes.
   - Confirm cache hit rates via lightweight logs/metrics (if present) or temporary counters in Redis.

Rollback checklist (must be explicit):
- Flip `NEXT_PUBLIC_*` flags back to `0` in prod (immediate rollback to Server Actions).
- Leave Redis enabled; it is best-effort and should not break runtime if unreachable.

## Output
- Phase 154 merged into `main` and deployed.
- Feature flags are proven in preview and gradually enabled in production with a known rollback path.

## Handoff
Proceed to Phase 155b to implement Postgres `inbox_counts` materialization and remove expensive counts scans from the hot path.

