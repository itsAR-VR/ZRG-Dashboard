# Phase 165d — Worker Idempotency/Failure Semantics + Observability Hardening

## Focus
Make background processing resilient to retries, partial failures, and duplicate signals while improving triage visibility.

## Inputs
- Outputs of 165b/165c
- `lib/background-jobs/runner.ts`
- `lib/background-jobs/maintenance.ts`
- `lib/inngest/functions/process-background-jobs.ts`
- `lib/inngest/functions/background-maintenance.ts`
- `lib/inngest/job-status.ts`

## Work
- Enforce idempotent processing boundaries:
  - classify retriable vs terminal errors,
  - ensure repeated attempts do not produce duplicate side effects.
- Persist run attempt lifecycle and terminal failure context to DB-backed reliability records.
- Add/standardize structured logs and correlation IDs across dispatch + function execution + job runner.
- Define dead-letter handling and operator recovery actions (requeue, inspect, discard) with explicit invariants.
- Add guardrails for message/reply-sensitive paths and ensure background retries do not violate messaging safety behavior.
- Validation (required):
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
  - `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`

## Output
- Idempotent and observable background execution model with durable failure diagnostics and safe retry semantics.

## Handoff
Execute full validation and canary rollout in 165e.
