# Phase 78e — Verification, smoke tests, and monitoring checklist

## Focus

Prove the fix eliminates the error signatures and doesn’t regress core cron/webhook behavior.

## Inputs

- Phase 78b/78c code changes
- Phase 78d migrations + rollout steps

## Work

- Local validation:
  - `npm run lint`
  - `npm run build`
- Targeted smoke tests:
  - `/api/cron/followups` with valid auth:
    - schema compatible → 200 and success payload
    - schema incompatible → 503 with `missing[]`
  - `/api/webhooks/email`:
    - schema compatible → 2xx normal behavior
    - schema incompatible → 503 (retryable)
  - Non-critical cron endpoints return 200 with structured errors on transient failures.
- Monitoring:
  - Add/verify log lines keyed on `[SchemaCompat]` for alerting
  - Re-export logs and confirm P2022 signatures are gone

## Output

- Evidence (commands + expected outputs) that Phase 78 achieved its success criteria.

## Handoff

Proceed to production rollout using the documented migrations sequence; verify logs remain clean post-deploy.

