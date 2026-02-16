# Phase 163b — Observability: Request IDs + Server Timing (Inbox)

## Focus
Make inbox read-path observability as strong as analytics so slow runs are diagnosable without guesswork.

## Inputs
- Outputs from 163a (slow endpoints + request IDs)
- Analytics timing/header patterns: `app/api/analytics/_helpers.ts`
- Inbox read routes: `app/api/inbox/counts/route.ts`, `app/api/inbox/conversations/route.ts`, `app/api/inbox/conversations/[leadId]/route.ts`

## Work
1. Ensure inbox read endpoints emit:
   - `x-request-id` (always)
   - `x-zrg-duration-ms` (success path, and optionally error path)
   - `x-zrg-cache` when cacheable (hit/miss/bypass)
2. Add structured logs for:
   - slow requests above a threshold (e.g. > 1500ms server time)
   - disabled-path responses (flag-driven) with explicit reason
3. Make headers safe:
   - no PII
   - no secrets
   - minimal, consistent, and stable for Playwright parsing

## Output
- Inbox read routes updated with consistent timing + cache + request id headers.
- Documented header contract in phase docs for future tests.

## Handoff
Use the new timing signals to confirm whether variance is server-side (DB/compute) or client-side (refetch churn) before changing architecture.

