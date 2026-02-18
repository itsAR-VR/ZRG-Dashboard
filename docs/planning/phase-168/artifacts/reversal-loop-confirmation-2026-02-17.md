# Reversal Loop Confirmation — 2026-02-17

## Source
- Log export: `zrg-dashboard-log-export-2026-02-17T21-43-29.json`
- Dataset size: `39,385` rows

## Route/Status Confirmation
Top failing route/status buckets from the export:

- `/api/webhooks/email` `504`: `21,050`
- `/api/inbox/conversations` `504`: `8,718`
- `/api/inbox/conversations` `500`: `4,938`
- `/api/inbox/conversations` blank status: `1,443`
- `/api/cron/response-timing` `500`: `545`
- `/api/cron/background-jobs` `200`: `556`
- `/api/cron/background-jobs` `500`: `77`

## Time-Slice Reversal Pattern
Window checked: `2026-02-17 21:21:00` to `2026-02-17 21:23:00` UTC.

- Interleaved rows across webhook + inbox + background-jobs: `694`
- Background-jobs invocations inside same stressed slice include:
  - `2026-02-17 21:21:04` (`200`, `500`)
  - `2026-02-17 21:22:04`, `21:22:14`, `21:22:29`, `21:22:35`–`21:22:38`, `21:22:40`–`21:22:43` (mostly `200`)
- In the same interval, webhook and inbox are repeatedly emitting `504` (plus blank/500 variants), indicating repeated mixed-route pressure rather than a single isolated endpoint failure.

Interpretation for Phase 168: this supports the log-driven "reversal loop" hypothesis (webhook + inbox timeout pressure occurring concurrently with cron/background activity).

## Commands Used
```bash
jq 'length' zrg-dashboard-log-export-2026-02-17T21-43-29.json

jq -r '.[] | "\u001e\(.requestPath)\u001f\(.responseStatusCode // "<none>")"' \
  zrg-dashboard-log-export-2026-02-17T21-43-29.json | sort | uniq -c | sort -nr | head -12

jq -r '.[]
  | select(.requestPath | contains("/api/cron/background-jobs"))
  | (.responseStatusCode // "<none>")' \
  zrg-dashboard-log-export-2026-02-17T21-43-29.json | sort | uniq -c

jq -r '.[]
  | select(.requestPath | test("/api/webhooks/email|/api/cron/background-jobs|/api/inbox/conversations"))
  | select(.TimeUTC >= "2026-02-17 21:21:00" and .TimeUTC <= "2026-02-17 21:23:00")
  | [.timestampInMs, .TimeUTC, .requestPath, (.responseStatusCode // "<none>")] | @tsv' \
  zrg-dashboard-log-export-2026-02-17T21-43-29.json | wc -l
```
