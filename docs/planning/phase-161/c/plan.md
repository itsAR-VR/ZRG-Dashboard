# Phase 161c — Remediation + Observability Hardening

## Focus
Implement the smallest fix that stops the 503 spike and improves future diagnosability.

## Inputs
- Phase 161b root cause decision
- inbox read API route/client files

## Work
1. Implement remediation based on root cause:
   - if flag/config issue: correct runtime config and add guardrails against accidental disablement.
   - if fail-open gap: ensure client fallback header path is consistently applied where intended.
   - if route/action bug: patch failing code path with targeted fix.
2. Improve observability:
   - ensure structured warning/error logs always include route, request id, clientId, reason code.
   - include explicit headers/reason fields for disabled/read-fail-open states.
3. Keep behavior safe:
   - preserve auth/permission checks,
   - avoid changing unrelated inbox query semantics.

## Output
- Minimal fix + enhanced observability for inbox read API 503 conditions.

## Handoff
Proceed to Phase 161d for validation, production verification, and closure notes.

