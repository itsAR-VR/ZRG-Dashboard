# Inngest Invalid Signature Evidence
- CapturedAtUTC: 2026-02-18T05-47-35Z
- Source: Inngest management events API (`/v1/events?limit=200`) queried with production `INNGEST_SIGNING_KEY`.
- EvidenceFile: `inngest-invalid-signature-evidence-2026-02-18T05-47-35Z.json`

## Finding
- `inngest/function.failed` events were repeatedly emitted with `Invalid signature` / `invalid status code: 401`.
- Affected functions in sampled window:
  - `zrg-dashboard-process-background-jobs` triggered by `background/process.requested`
  - `zrg-dashboard-background-maintenance` triggered by `background/maintenance.requested`
  - `zrg-dashboard-cron-response-timing` triggered by `cron/response-timing.requested`

## Impact
- Inngest-triggered execution failed before function logic completed.
- Durable run ledger (`BackgroundFunctionRun`) remained empty for cron/offloaded paths prior to remediation.
- Dispatch windows accumulated in `ENQUEUED` state without durable run confirmations.
