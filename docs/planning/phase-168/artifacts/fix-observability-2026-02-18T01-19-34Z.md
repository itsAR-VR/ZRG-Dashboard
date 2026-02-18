# Phase 168c Observability Verification — 2026-02-18T01-19-34Z

## Request/Duration Diagnostics (Code-level)
- `x-request-id` + `x-zrg-duration-ms` are emitted in:
  - `app/api/inbox/conversations/route.ts`
  - `app/api/inbox/counts/route.ts`

## Timeout Guardrails
- Inbox query statement timeout guardrails verified in `actions/lead-actions.ts`:
  - `INBOX_QUERY_STATEMENT_TIMEOUT_MS = 12000`
  - fallback timeout for full-email search path `INBOX_FULL_EMAIL_FALLBACK_TIMEOUT_MS = 5000`
- Response timing processor guardrails verified in `lib/response-timing/processor.ts`:
  - bounded `statement_timeout`
  - bounded transaction timeout/maxWait

## Webhook Queue-First Guard
- `INBOXXIA_EMAIL_SENT_ASYNC` gate verified in `app/api/webhooks/email/route.ts`.
- Async path performs durable queue upsert (`WebhookEvent`) and returns early.

## Runtime Verification Status
- Live request/response captures remain operator-run for this environment.
- Use Phase 168d comparability packet to confirm these headers and timing signatures in production windows.

## Operator Commands (for 168d packet)
```bash
vercel list --environment production --status READY --yes
vercel env ls production --no-color
vercel logs <deployment-url> --json | jq 'select(.level=="error" or .statusCode==500)'
```
