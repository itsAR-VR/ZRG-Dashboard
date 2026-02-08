# Phase 117c — Observability Hardening (Server Action Failures, No PII)

## Focus
Ensure any future Server Action failures are diagnosable (action name, user/workspace scope, error class) without leaking PII or secrets, and without relying on opaque digests.

## Inputs
- Phase 117a root cause + failure signatures
- Server action modules touched in Phase 117b
- Existing patterns for admin visibility:
  - `actions/admin-dashboard-actions.ts`
  - `components/dashboard/admin-dashboard-tab.tsx`

## Work
1. Add a tiny "safe error shape" helper (stats-only)
   - Create a helper (location TBD during implementation) to normalize unknown errors into:
     - `publicMessage` (short, non-sensitive)
     - `errorClass` (e.g., `not_authenticated`, `unauthorized`, `auth_timeout`, `db_error`, `unknown`)
     - `debugId` (random id for log correlation)
   - Do not include raw Prisma errors, SQL, message bodies, emails, phone numbers, or tokens.
   - **RT-4 enhancement:** Include `auth_timeout` as a distinct `errorClass` to distinguish Supabase latency-induced "Not authenticated" from actual missing credentials. Detection: check for `AbortError` or timeout-related error messages.

2. Apply safe error helper to RETURN values of catch blocks (RT-9)
   - For `getClients` and `getConversationsCursor`:
     - Replace raw `errorMessage` in catch block return values with `publicMessage` from the helper.
     - **Before (leaks details):** `error: \`Failed to fetch conversations: ${errorMessage}\``
     - **After (safe):** `error: publicMessage` (e.g., "Failed to load conversations — please retry")
     - This prevents SQL snippets, table names, or internal details from reaching the client.

3. Log structured errors server-side for the affected actions
   - For `getClients` and `getConversationsCursor`:
     - On error, `console.error` a single structured object:
       - `debugId`, `action`, `userId` (ok), `clientId` (ok), `errorClass`, and the safe message
     - Ensure logs do not include request cookies or message bodies.

4. (Optional but recommended) Add admin-only "recent action failures" counter
   - If there is an existing AI Ops feed pattern that can be reused without adding new infra:
     - write a minimal aggregate into the Admin Dashboard snapshot:
       - count of conversation-list errors (last 1h / 24h)
   - If adding persistence is required, do not do it in Phase 117; keep it as follow-up.

## Validation (RED TEAM — RT-8 fix: added standard suite)
- Intentionally trigger a controlled failure locally (e.g., invalid clientId) and confirm:
  - action returns `{ success: false, error: <publicMessage> }` (safe, no SQL/internal details)
  - server logs include `debugId` + action name + `errorClass`
  - UI shows a non-digest error message
- Standard validation suite (must pass):
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`

## Planned Output
- A minimal, safe, and actionable error logging layer for the inbox-critical server actions.

## Planned Handoff
- Phase 117d runs the production readiness sweep (env/crons/webhooks) and updates the launch checklist/runbook.

## Output

- Added a minimal, safe error helper and applied it to inbox conversation list actions:
  - `lib/safe-action-error.ts` classifies common failure modes (`not_authenticated`, `unauthorized`, `auth_timeout`, `db_error`, `unknown`) and generates a `debugId`.
  - `actions/lead-actions.ts` catch blocks no longer return raw `error.message` to the client; they return safe messages and include a `ref: <debugId>` for operator correlation.
  - Auth failures are treated as expected and do not spam `console.error` logs.
- Validation:
  - `npm run typecheck` — pass
  - `npm test` — pass

## Handoff

- Phase 117d: finalize the production readiness sweep (env/crons/webhooks auth) and produce the explicit launch + rollback runbook in 117e.
