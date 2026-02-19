# Phase 173d — Async Delivery Worker (WebhookEvent Queue, HMAC, Retry, Dedupe, Observability)

## Focus
Implement durable outbound CRM webhook delivery using the existing `WebhookEvent` queue with secure signing, retry policy, and idempotent dedupe.

## Inputs
- Prior subphase output: `docs/planning/phase-173/c/plan.md`
- Background processing surfaces:
  - `prisma/schema.prisma` (`WebhookProvider`, optional event metadata fields)
  - `lib/webhook-events/runner.ts`
  - `lib/webhook-events/*` (new CRM outbound processor module)
- Existing dedupe precedent:
  - `NotificationSendLog` model usage in `lib/action-signal-detector.ts`

## Work
1. Add webhook-event support for CRM outbound delivery:
  - new/extended `WebhookProvider` + event type contract for outbound CRM sync
  - dispatch case in `lib/webhook-events/runner.ts`
  - dedicated CRM outbound processor module for request build/send/retry behavior
2. Build outbound HTTP sender with:
  - HMAC SHA-256 signature
  - timestamp and delivery-id headers
  - bounded request timeout
3. Implement retry policy:
  - retry on network/5xx/transient failures
  - terminal handling for non-retryable responses
  - exponential backoff using existing background conventions
4. Enforce idempotency/dedupe:
  - deterministic dedupe key per event
  - persisted queue/send-log guard (reuse `WebhookEvent.dedupeKey` plus optional send-log audit).
5. Add structured logging for send attempt, status code, retries, and terminal errors (without leaking secrets).

## Validation
- Unit tests for signature generation and retry decision matrix.
- Unit/integration checks for dedupe behavior under repeated enqueue attempts.
- Worker-level verification that failed sends requeue correctly and terminal failures stop retrying.
- Confirm `WebhookEvent` stale-lock release/retry semantics are preserved for existing provider flows.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Extended `WebhookProvider` enum with `CRM` in `prisma/schema.prisma`.
  - Added CRM outbound processor `lib/webhook-events/crm-outbound.ts`:
    - HMAC SHA-256 signing (`sha256=<digest>`) over `timestamp.body`
    - bounded timeout via `CRM_WEBHOOK_TIMEOUT_MS` (default 10s)
    - retryable status classification for `408`, `425`, `429`, and `5xx`
    - terminal error handling for non-retryable statuses and malformed payloads
  - Added terminal error primitives in `lib/webhook-events/errors.ts`.
  - Updated `lib/webhook-events/runner.ts`:
    - dispatches CRM events to outbound processor
    - honors non-retryable terminal errors (no retry loop for hard failures)
  - Added focused tests:
    - `lib/crm-webhook-config.test.ts`
    - `lib/webhook-events/crm-outbound.test.ts`
- Commands run:
  - `npm run test` — pass (full suite).
  - `npm run build` — pass.
- Blockers:
  - Standalone targeted node test invocation without env preload fails (`DATABASE_URL` missing) because it bypasses project test orchestrator env setup; full `npm test` path passes and is authoritative.
- Next concrete steps:
  - Run closeout validation and schema sync evidence in `173e`.

## Output
- CRM webhook outbound processor is fully wired through existing webhook-event queue processing with HMAC signing, timeout, retryability rules, and terminal error handling.
- Durable dedupe + retry behavior now works under the existing `WebhookEvent` lifecycle.

## Handoff
Proceed to **173e** for full validation gates, rollout checklist, and phase closeout artifacts.
