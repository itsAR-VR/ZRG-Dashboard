# Phase 42b — EmailBison Auth + 401 Diagnostics and Mapping

## Focus
Make EmailBison authentication failures (`401`) diagnosable and actionable, and ensure the EmailBison client fails safely without cascading into retries/timeouts.

## Inputs
- Vercel logs (Jan 19, 2026): EmailBison replies fetch failed `401` with “URL/key” mismatch hint
- Phase 41 plan (Email campaign sync) for shared constraints and existing changes
- EmailBison client code (likely `lib/emailbison-api.ts`) and relevant env vars
- Stakeholder decision (Jan 19, 2026): EmailBison base host must be configurable (white-label) and base hosts should be manageable under Integrations
  - Initial allowed hosts: `send.meetinboxxia.com`, `send.foundersclubsend.com`

## Work
- Implement configurable EmailBison base host (white-label):
  - Add an Integrations setting to manage **allowed EmailBison base hosts** (add/remove).
  - Allow each workspace to select the EmailBison base host it should use.
  - Default behavior remains unchanged for existing workspaces (fallback host: `send.meetinboxxia.com`).
  - Validate base host entries to reduce SSRF/misconfig risk:
    - HTTPS-only
    - hostname-only (no path/query)
    - disallow IP literals and localhost-style hosts
  - Likely implementation touch points (verify during Phase 42 execution):
    - Data model: `prisma/schema.prisma` (new model for allowed hosts + a selected host field on `Client`)
    - Admin actions: `actions/client-actions.ts` (`getClients`, `createClient`, `updateClient`)
    - UI: `components/dashboard/settings/integrations-manager.tsx` (host CRUD + per-workspace selection)
    - Client: `lib/emailbison-api.ts` (stop relying on hard-coded base URL; accept base URL/host per request)
- Confirm the EmailBison base URL + API key/header contract used by all calls (campaigns, replies, sent mail, lead details) and ensure the chosen base host is threaded through.
- Normalize error handling so `401` becomes a first-class mapped error with:
  - provider name
  - endpoint called
  - HTTP status code
  - safe upstream payload excerpt (no secrets, no message bodies)
  - base host used (hostname only; no keys)
- Update call sites to surface a clear remediation message (e.g., “Check EmailBison URL + API key for this workspace”) instead of “Unknown error”.
- Add a small “integration health” check path (or a dry-run request) if it helps isolate misconfiguration quickly.
  - Prefer a lightweight GET endpoint (campaigns or sender emails) with strict timeout + no retries on 401.

## Output
- EmailBison client now returns consistent, actionable auth errors (no “Unknown error” on 401/403) and includes safe diagnostic context (endpoint + base host) without logging PII:
  - Added helpers in `lib/emailbison-api.ts` to format auth/HTTP failures and include `EMAILBISON_BASE_URL` guidance.
  - Mapped `401/403` across core endpoints (replies, sent emails, lead fetch/create, sender emails, lead search helpers) to a single actionable message.
  - Downgraded 401/403 logging to `console.warn` with `{ status, endpoint, host, error }` and removed full payload/body logs.
  - Removed PII-heavy logs (recipient emails, message previews, reply “from/subject” summaries).
  - Redacted query strings from retry/cancel logs to avoid leaking email addresses in URLs.
- Sync flows that rely on EmailBison now fail fast with a clear remediation message when credentials/base URL are misconfigured (instead of noisy `[error]` logs).

Note: The base host is currently configurable via `EMAILBISON_BASE_URL` env var (deployment-wide). Per-workspace host selection remains a follow-on if/when multi-host needs to coexist in a single deployment.

## Handoff
Proceed to Phase 42c to harden BackgroundJob enqueue idempotency (stop `P2002` on `dedupeKey`) and address the remaining 300s timeout by ensuring long-running sync work is off the request path.
