# Manual Inngest Probe Summary — response-timing
- Goal: verify whether production Inngest event consumption produces durable `BackgroundFunctionRun` rows for `cron-response-timing`.
- Probe events sent (accepted by Inngest event API):
  - `01KHQD6W4CJBYQN650Y5C9J9P4` (`dispatchKey=cron:response-timing:manual-probe:2026-02-18T03:37:56`)
  - `01KHQD9KHVJKGRX49W513CTC1K` (`dispatchKey=cron:response-timing:manual-probe:2026-02-18T03:39:26`)
  - `01KHQDBCWFCRV2A7Z5PWYP0EYQ` (`dispatchKey=cron:response-timing:manual-probe-long:2026-02-18T03:40:24`)
- Evidence files:
  - `manual-probe-inngest-event-2026-02-18T03-39-21Z.json`
  - `manual-probe-inngest-event-long-2026-02-18T03-40-20Z.json`
  - `manual-probe-inngest-logs-2026-02-18T03-39-21Z.jsonl`
  - `manual-probe-inngest-logs-long-2026-02-18T03-40-20Z.jsonl`
  - `manual-probe-durable-check-2026-02-18T03-42-05Z.json`

## Observations
- Event publish succeeded each time (`sendResult.ids` present).
- No `BackgroundFunctionRun` rows were created for any probe `dispatchKey`.
- Recent `cron-response-timing` rows remained empty in the durable ledger query.
- Runtime log windows captured unrelated cron traffic but no explicit `cron-response-timing` handler logs/errors.

## Interpretation
- Durable-run visibility failure is reproducible independently of the cron route flag.
- Most likely next checks:
  1. Validate cloud-side function registration and run execution for `cron/response-timing.requested`.
  2. Confirm production `/api/inngest` is receiving and executing the probe events.
  3. If runs execute, trace why `writeInngestJobStatus` durable upserts are missing.
