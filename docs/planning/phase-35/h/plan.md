# Phase 35h — Schema-backed Dedupe + Job Telemetry Attribution

## Focus

Lock in two cross-cutting decisions from Phase 35 and make them executable:

1) **Schema-backed webhook dedupe for GHL SMS** (workflow webhook payload lacks a provider message ID)
2) **Job-type-level AI telemetry attribution** via `AIInteraction.source`

## Inputs

- Root plan: `docs/planning/phase-35/plan.md`
- Schema: `prisma/schema.prisma` (`Message`, `BackgroundJob`, enums)
- GHL SMS webhook: `app/api/webhooks/ghl/sms/route.ts`
- Background jobs:
  - `app/api/cron/background-jobs/route.ts`
  - `lib/background-jobs/runner.ts`
- Telemetry context: `lib/ai/telemetry-context.ts`
- Reference idempotency patterns:
  - `app/api/webhooks/email/route.ts` (dedupe race handling + enqueue reset semantics)

## Work

### 1) Schema: Add Dedupe Fields

Update `prisma/schema.prisma`:

- Add `Message.webhookDedupeKey String? @unique`
  - Used for webhook-sourced events where the provider payload has no stable message ID (starting with GHL SMS workflow webhooks).
  - Store a short, deterministic value (hash + prefix) to avoid large index keys.
- Add `Message.unipileMessageId String? @unique`
  - Used for LinkedIn (Unipile) inbound/outbound message idempotency.

Run `npm run db:push` after updating the schema.

### 2) GHL SMS: Compute a Stable `webhookDedupeKey`

Add a helper (example target file: `lib/webhook-dedupe.ts`) that computes:

- `webhookDedupeKey = "ghl_sms:" + sha256hex( ... )`
- Use **only stable, message-event-specific** inputs from the raw webhook payload:
  - `clientId` (resolved from `location.id`)
  - `payload.contact_id`
  - `payload.workflow?.id` (optional)
  - `payload.date_created` (raw string; optional)
  - `payload.customData?.Date` and `payload.customData?.Time` (raw strings; optional)
  - `normalizedBody` from `payload.message?.body || payload.customData?.Message || ""`
- Do **not** use receipt time in the dedupe key (varies per retry).

### 3) GHL SMS: Use Schema-backed Dedupe on Insert

Refactor `app/api/webhooks/ghl/sms/route.ts` insert path so that:

- It attempts `prisma.message.create({ data: { webhookDedupeKey, ... } })` for inbound messages when `ghlId` is not available from the payload.
- On `P2002`, it:
  - fetches the existing message by `webhookDedupeKey`
  - **re-enqueues** the post-process background job (upsert/reset semantics)
  - returns `200 { success: true, deduped: true }` to prevent retry storms

### 4) Background Jobs: Set Job-type `AIInteraction.source`

Update `lib/background-jobs/runner.ts` so each handler executes inside an explicit telemetry context:

- Wrap each job handler invocation with:
  - `withAiTelemetrySource(\`background_job:${lockedJob.type}\`, () => handler())`
- Rationale: the cron route sets `source="/api/cron/background-jobs"`; this step overrides source per job so AI spend/latency can be attributed to `BackgroundJobType`.

### 5) Validation (RED TEAM)

- Webhook retry safety:
  - Send the same GHL SMS webhook payload twice → only one inbound `Message` row exists (same `webhookDedupeKey`)
  - BackgroundJob dedupe prevents multiple jobs per message+type
- Telemetry:
  - Trigger a job that calls OpenAI → verify created `AIInteraction.source` is `background_job:<TYPE>` (not `/api/cron/background-jobs`)

## Output

- A concrete, schema-backed idempotency mechanism for GHL SMS webhook inserts (`Message.webhookDedupeKey`)
- Per-job AIInteraction attribution via `AIInteraction.source = background_job:<BackgroundJobType>`

## Handoff

- Apply these patterns before or alongside the per-webhook refactors (35b–35e) so every channel inherits consistent idempotency and telemetry behavior.
