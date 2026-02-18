# Signing-Key Remediation Summary
- Window: 2026-02-18T05:47Z to 2026-02-18T05:59Z
- Scope: production Inngest execution health for cron/background offloads.

## Root Cause
- Production `INNGEST_SIGNING_KEY` had trailing whitespace/newline, causing signature verification failures.
- Symptom: `inngest/function.failed` events with `Invalid signature` (`401`) across:
  - `zrg-dashboard-process-background-jobs`
  - `zrg-dashboard-background-maintenance`
  - `zrg-dashboard-cron-response-timing`

## Fix
- Rewrote production `INNGEST_SIGNING_KEY` with trimmed value (no trailing whitespace).
- Deployed updated production configuration.

## Verification
- Inngest failure evidence before fix:
  - `inngest-invalid-signature-evidence-2026-02-18T05-47-35Z.json`
- Post-fix failure window check:
  - `inngest-failure-window-after-signing-fix-2026-02-18T05-57-03Z.json`
  - Result: `recentInvalidSignatureCount=0` since `2026-02-18T05:51:00Z`.
- Durable run ledger now populated:
  - `inngest-post-signing-fix-check-2026-02-18T05-51-06Z.json`
  - Includes successful `cron-response-timing` and active/successful background functions.
- Response-timing dispatch verification after re-enable:
  - `post-fix-response-timing-dispatch-response-2026-02-18T05-55-15Z.txt`
  - `post-fix-response-timing-dispatch-check-2026-02-18T05-56-47Z.json`
  - Result: `cron-response-timing` row present with `SUCCEEDED`.
