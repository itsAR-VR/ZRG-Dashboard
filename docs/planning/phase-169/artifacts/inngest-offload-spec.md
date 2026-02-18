# Phase 169b Artifact — Inngest Offload Spec

## Scope Lock (from 169a matrix)

### Migrate to durable offload
- `/api/webhooks/email` (`EMAIL_SENT`) via existing `WebhookEvent` queue-first behavior.
- `/api/cron/background-jobs` via existing dispatch-only Inngest flow (Phase 165 contract).
- New dispatch-only cron offloads:
  - `/api/cron/response-timing`
  - `/api/cron/appointment-reconcile`
  - `/api/cron/followups`
  - `/api/cron/availability`
  - `/api/cron/emailbison/availability-slot`

### Stay synchronous (verification targets only)
- `/api/inbox/conversations`
- `/api/inbox/counts`

## Event + Payload Contract

### Shared payload shape for cron dispatch events
Reuse Phase 165 shape from `lib/inngest/events.ts` (`BackgroundDispatchEventData`) and extend with optional `params` only where route semantics require it:

```ts
{
  source: string;
  requestedAt: string;          // ISO UTC
  dispatchKey: string;          // deterministic bucket key
  correlationId: string;        // request-scoped UUID
  dispatchWindowStart: string;  // ISO UTC bucket start
  dispatchWindowSeconds: number;
  params?: Record<string, string>; // only for appointment-reconcile
}
```

Rules:
- `source` format: `cron/<job-name>`.
- `correlationId`: generated once in route handler and copied to function status writes.
- `params` included only for `/api/cron/appointment-reconcile` and only contains recognized query params.

## Canonical Event Names
- `cron/response-timing.requested`
- `cron/appointment-reconcile.requested`
- `cron/followups.requested`
- `cron/availability.requested`
- `cron/emailbison-availability-slot.requested`

## Deterministic Dispatch Keys + Event IDs

### Bucket rules
- Minutely cron routes: floor timestamp to UTC minute bucket (`YYYY-MM-DDTHH:mm`).
- 5-minute cron routes: floor timestamp to UTC 5-minute bucket.
- Appointment reconcile includes a stable params hash so manual replay params do not collide with default scheduled invocations.

### Derivations
- `response-timing` (5-min):
  - `dispatchKey = cron:response-timing:<UTC-5m-bucket>`
  - `event.id = cron/response-timing.requested:<dispatchKey>`
- `appointment-reconcile` (1-min + params hash):
  - `dispatchKey = cron:appointment-reconcile:<UTC-minute-bucket>:<paramsHash>`
  - `event.id = cron/appointment-reconcile.requested:<dispatchKey>`
- `followups` (1-min):
  - `dispatchKey = cron:followups:<UTC-minute-bucket>`
  - `event.id = cron/followups.requested:<dispatchKey>`
- `availability` (1-min):
  - `dispatchKey = cron:availability:<UTC-minute-bucket>`
  - `event.id = cron/availability.requested:<dispatchKey>`
- `emailbison-availability-slot` (1-min):
  - `dispatchKey = cron:emailbison-availability-slot:<UTC-minute-bucket>`
  - `event.id = cron/emailbison-availability-slot.requested:<dispatchKey>`

Function-level idempotency for every new cron function:
- `idempotency: "event.data.dispatchKey"`

## Function Config Contract

For each new cron function under `lib/inngest/functions/`:
- `id`: stable kebab-case name (`cron-response-timing`, `cron-appointment-reconcile`, etc.)
- `retries: 3`
- `concurrency: { limit: 1 }`
- `idempotency: "event.data.dispatchKey"`
- `writeInngestJobStatus` must be called on `running`, `succeeded`, and `failed`
- `jobName` in status writer is fixed per function and included in response docs

## Route Dispatch Contract (HTTP behavior)

For each migrated cron route when `*_USE_INNGEST=true` and Inngest is configured:
1. Keep existing `CRON_SECRET` auth logic unchanged.
2. Compute deterministic `dispatchKey` + `correlationId`.
3. Publish one event with deterministic `event.id`.
4. Return `202` JSON with:
   - `success: true`
   - `mode: "dispatch-only"`
   - `dispatch: { source, requestedAt, dispatchKey, correlationId, dispatchWindowStart, dispatchWindowSeconds, params? }`
   - `event: { name, id, publishedEventId? }`
   - `timestamp`

When flag is false:
- Preserve current inline behavior and response payload shape.

On enqueue failure while flag is true:
- Return non-2xx (`503`) and do **not** auto-fallback inline.
- Rollback path is flipping the route flag off.

## Flag + Rollback Matrix

| Surface | Enable flag | Rollback |
| --- | --- | --- |
| Webhook `EMAIL_SENT` queue-first | `INBOXXIA_EMAIL_SENT_ASYNC=true` | `INBOXXIA_EMAIL_SENT_ASYNC=false` |
| Background jobs dispatch-only (existing) | `INNGEST_EVENT_KEY` set or `BACKGROUND_JOBS_USE_INNGEST=true` | `BACKGROUND_JOBS_USE_INNGEST=false` (or unset event key), optionally `BACKGROUND_JOBS_FORCE_INLINE=true` for emergency |
| Response timing cron dispatch | `CRON_RESPONSE_TIMING_USE_INNGEST=true` | `CRON_RESPONSE_TIMING_USE_INNGEST=false` |
| Appointment reconcile cron dispatch | `CRON_APPOINTMENT_RECONCILE_USE_INNGEST=true` | `CRON_APPOINTMENT_RECONCILE_USE_INNGEST=false` |
| Followups cron dispatch | `CRON_FOLLOWUPS_USE_INNGEST=true` | `CRON_FOLLOWUPS_USE_INNGEST=false` |
| Availability cron dispatch | `CRON_AVAILABILITY_USE_INNGEST=true` | `CRON_AVAILABILITY_USE_INNGEST=false` |
| EmailBison availability-slot cron dispatch | `CRON_EMAILBISON_AVAILABILITY_SLOT_USE_INNGEST=true` | `CRON_EMAILBISON_AVAILABILITY_SLOT_USE_INNGEST=false` |

## Route → Contract Mapping (Implementation Source of Truth)

| Route | Event | Dispatch key pattern | Function id | Retries | Concurrency | Status `jobName` | Owner files |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| `/api/cron/response-timing` | `cron/response-timing.requested` | `cron:response-timing:<UTC-5m-bucket>` | `cron-response-timing` | 3 | `limit:1` | `cron-response-timing` | `app/api/cron/response-timing/route.ts`, `lib/response-timing/processor.ts`, `lib/inngest/events.ts`, `lib/inngest/functions/cron-response-timing.ts` |
| `/api/cron/appointment-reconcile` | `cron/appointment-reconcile.requested` | `cron:appointment-reconcile:<UTC-minute-bucket>:<paramsHash>` | `cron-appointment-reconcile` | 3 | `limit:1` | `cron-appointment-reconcile` | `app/api/cron/appointment-reconcile/route.ts`, `lib/appointment-reconcile-runner.ts`, `lib/inngest/events.ts`, `lib/inngest/functions/cron-appointment-reconcile.ts` |
| `/api/cron/followups` | `cron/followups.requested` | `cron:followups:<UTC-minute-bucket>` | `cron-followups` | 3 | `limit:1` | `cron-followups` | `app/api/cron/followups/route.ts`, `lib/followup-engine.ts`, `lib/inngest/events.ts`, `lib/inngest/functions/cron-followups.ts` |
| `/api/cron/availability` | `cron/availability.requested` | `cron:availability:<UTC-minute-bucket>` | `cron-availability` | 3 | `limit:1` | `cron-availability` | `app/api/cron/availability/route.ts`, `lib/availability-cache.ts`, `lib/inngest/events.ts`, `lib/inngest/functions/cron-availability.ts` |
| `/api/cron/emailbison/availability-slot` | `cron/emailbison-availability-slot.requested` | `cron:emailbison-availability-slot:<UTC-minute-bucket>` | `cron-emailbison-availability-slot` | 3 | `limit:1` | `cron-emailbison-availability-slot` | `app/api/cron/emailbison/availability-slot/route.ts`, `lib/emailbison-first-touch-availability.ts`, `lib/inngest/events.ts`, `lib/inngest/functions/cron-emailbison-availability-slot.ts` |

## Observability Requirements (must ship with implementation)
- Route response metadata for every dispatch-only invocation:
  - `dispatchKey`
  - `correlationId`
  - deterministic event `id`
  - published event IDs (when returned by Inngest)
- Function run ledger:
  - all new functions write `running/succeeded/failed` rows through `writeInngestJobStatus`
  - include `dispatchKey`, `correlationId`, `requestedAt`, `runId`, `attempt`

## Validation Gate Requirements for 169c
- `npm run lint`
- `npm run build`
- `npm test`
- NTTAN:
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-169/replay-case-manifest.json --dry-run`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-169/replay-case-manifest.json --concurrency 3`
  - fallback only when manifest missing: run the `--client-id <clientId> --limit 20` dry/live pair
- Record replay artifact path + `judgePromptKey` + `judgeSystemPrompt` + per-case `failureType` counts in phase output.
