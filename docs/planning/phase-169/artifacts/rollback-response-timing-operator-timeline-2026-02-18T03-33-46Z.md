# Rollback Operator Timeline — response-timing
- 2026-02-18T03:19Z: Verified dispatch-only response for `/api/cron/response-timing` while `CRON_RESPONSE_TIMING_USE_INNGEST=true` (artifact: `post-response-timing-response-body-2026-02-18T03-19-35Z.txt`).
- 2026-02-18T03:31Z: Flipped `CRON_RESPONSE_TIMING_USE_INNGEST=false` in production.
- 2026-02-18T03:31Z: Attempted production deploy (`https://zrg-dashboard-i3jr3eqmk-zrg.vercel.app`) failed with build error: `CRON_SECRET contains leading or trailing whitespace`.
- 2026-02-18T03:32Z: Root cause found: previous CLI env update unintentionally included `dotenv` log text in `CRON_SECRET`.
- 2026-02-18T03:32Z: Rewrote `CRON_SECRET` in production using quiet dotenv extraction (no extra output).
- 2026-02-18T03:33Z: Redeployed successfully to production (`https://zrg-dashboard-1r6g869pg-zrg.vercel.app`) and alias `https://zrg-dashboard.vercel.app`.
- 2026-02-18T03:33Z: Authorized curl to `/api/cron/response-timing` returned HTTP 200 with inline payload, confirming rollback path.
- 2026-02-18T03:34Z: Captured rollback durable-health snapshot; `BackgroundFunctionRun` still had zero `cron-response-timing` rows (artifact: `rollback-durable-health-response-timing-2026-02-18T03-34-33Z.json`).

## Notes
- Rollback mechanics (flag flip + deploy + inline verification) are validated.
- Durable-run observability remains a blocker for dispatch-mode confidence because `BackgroundFunctionRun` did not receive `cron-response-timing` records in the sampled windows.
