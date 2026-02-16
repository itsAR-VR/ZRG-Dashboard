# Phase 161b — Root-Cause Isolation (Flags, Fail-Open, Runtime Paths)

## Focus
Identify the exact mechanism causing `/api/inbox/conversations` to return 503 in production.

## Inputs
- Phase 161a evidence packet
- `app/api/inbox/conversations/route.ts`
- `lib/feature-flags.ts`
- client callers in `components/dashboard/inbox-view.tsx` and related read API fetch helpers

## Work
1. Verify server-side 503 code paths in route:
   - `READ_API_DISABLED` path (feature flag false),
   - any uncaught runtime exceptions mapped to 503 elsewhere in call chain.
2. Verify flag resolution inputs at runtime:
   - `INBOX_READ_API_V1`,
   - `NEXT_PUBLIC_INBOX_READ_API_V1`,
   - production defaults when values are absent.
3. Verify fail-open mechanics:
   - whether client requests include `x-zrg-read-api-fail-open: server_action_unavailable` when expected,
   - whether that header path is reachable from affected UI calls.
4. Produce root-cause conclusion with confidence and evidence:
   - config drift, rollout misconfiguration, missing fail-open path, or true server failure.

## Output
- Decision-complete root cause statement and selected remediation strategy.

## Handoff
Proceed to Phase 161c to implement the minimal, safe fix and observability improvements.

