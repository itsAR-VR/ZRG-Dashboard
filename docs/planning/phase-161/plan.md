# Phase 161 — `/api/inbox/conversations` 503 Incident Triage (Log Export 2026-02-16)

## Purpose
Identify and fix the production spike of `503` responses on `/api/inbox/conversations`, then harden observability so the same incident is diagnosable from logs alone.

## Context
- User provided additional export: `zrg-dashboard-log-export-2026-02-16T16-16-06.json`.
- Repo-grounded summary from that export:
  - 120 entries total,
  - 116 entries with `responseStatusCode = 503`,
  - all concentrated on `GET zrg-dashboard.vercel.app/api/inbox/conversations`,
  - message fields are empty in this export, so no direct in-log stack trace.
- Current route behavior supports intentional `503`:
  - `app/api/inbox/conversations/route.ts` returns `{ error: "READ_API_DISABLED" }` with `503` when `isInboxReadApiEnabled()` is false and no fail-open header is present.
  - response includes `x-zrg-read-api-reason: disabled_by_flag`.
- Feature flag resolution in `lib/feature-flags.ts`:
  - explicit env false (`INBOX_READ_API_V1` or `NEXT_PUBLIC_INBOX_READ_API_V1`) disables read API,
  - missing env values in production default to enabled.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 158 | Active | Production log triage and read-path reliability context | Keep overlap additive: 161 is inbox read API incident deep dive; do not regress 158 analytics fixes. |
| Phase 155 | Active/partially closed | Inbox read API rollout contracts and fallback behavior | Preserve Phase 155 flag/fallback architecture; patch incident root cause without architectural churn. |
| Phase 159 | Active | Added this export as out-of-scope context | Keep 159 scoped to Knowledge Assets 413; only cross-link incident outcomes. |
| Uncommitted working tree | Active | Multiple unrelated files currently modified by other agents | Keep implementation isolated to inbox read API files and incident docs. |

## Objectives
* [ ] Reconstruct incident timeline and isolate the exact 503 trigger path(s).
* [ ] Determine whether 503s were expected due to flag state (`READ_API_DISABLED`) or due to another server/runtime failure.
* [ ] Ship the minimal safe fix (config, fallback behavior, or code path) to stop the 503 spike.
* [ ] Improve logs/headers/metrics so future 503s are self-attributing.
* [ ] Validate with local + deployment checks and capture closure evidence.

## Constraints
- Do not expand scope into unrelated inbox UI refactors.
- Preserve auth/authorization behavior of inbox read endpoints.
- Keep runtime flag semantics stable unless explicitly required for incident resolution.
- Avoid changes that break Phase 155 canary/rollback controls.
- No destructive data operations.

## Success Criteria
- Exported production logs no longer show recurring 503 bursts on `/api/inbox/conversations` for normal traffic.
- If read API is intentionally disabled, logs include clear structured reason and request metadata sufficient for immediate diagnosis.
- Inbox frontend behavior is resilient (fallback path or explicit UX) when read API disablement is intentional.
- Validation gates pass:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm test`

## Subphase Index
* a — Incident Evidence Packet + Timeline Reconstruction
* b — Root-Cause Isolation (Flags, Fail-Open, Runtime Paths)
* c — Remediation + Observability Hardening
* d — Validation + Production Verification + Incident Closure

