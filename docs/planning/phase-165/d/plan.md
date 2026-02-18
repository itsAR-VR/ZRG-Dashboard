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
- Durable run observability implemented:
  - `lib/inngest/job-status.ts` now writes both Redis status and DB-backed `BackgroundFunctionRun` records.
  - Run records include `runId`, `dispatchKey`, `correlationId`, `requestedAt`, attempts, timing, and terminal error.
- Function-level idempotency + correlation plumbing implemented:
  - process/maintenance functions now parse dispatch metadata from event payload,
  - both functions persist correlation fields into durable run records,
  - both functions enforce `idempotency` by dispatch key.
- Dispatch outcome durability implemented:
  - enqueue success/failure/inline-emergency outcomes persisted in `BackgroundDispatchWindow`.
- Existing worker retry semantics preserved:
  - `lib/background-jobs/runner.ts` retry/backoff behavior unchanged (no regression to job execution semantics).

## Handoff
Execute closure validation and rollout packet in 165e; track replay blockers explicitly if infrastructure prevents full NTTAN completion.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added durable status write path for function attempts and dispatch lifecycle.
  - Kept existing worker processing semantics unchanged while adding observability metadata.
  - Added deterministic dispatch helper tests.
- Commands run:
  - `npm run test:ai-drafts` — pass.
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20` — failed (DB connectivity preflight to Supabase host).
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3` — failed (same DB connectivity preflight blocker).
- Replay diagnostics captured from artifacts:
  - artifacts:
    - `.artifacts/ai-replay/run-2026-02-17T21-52-26-180Z.json`
    - `.artifacts/ai-replay/run-2026-02-17T21-52-30-831Z.json`
  - `judgePromptKey`: `meeting.overseer.gate.v1`
  - `judgeSystemPrompt`: present in artifact config
  - `failureTypeCounts`:
    - dry-run: `infra_error=1` (all other failure types `0`)
    - live: `infra_error=2` (all other failure types `0`)
  - critical invariants: all zero (`slot_mismatch`, `date_mismatch`, `fabricated_link`, `empty_draft`, `non_logistics_reply`)
- Blockers:
  - Replay preflight currently cannot reach `db.pzaptpgrcezknnsfytob.supabase.co` from this execution context.
- Next concrete steps:
  - Keep replay artifacts and preflight failures as explicit NTTAN blockers in 165e.
  - Re-run the two replay commands from a network path that can reach Supabase and append results.
