# Phase 164 — Inbox Perf Variance Fix + Live Perf Canary (Playwright + Probe)

## Purpose
Eliminate the “sometimes fast, sometimes extremely slow” Master Inbox behavior by fixing the underlying slow paths, and ship a durable, enterprise-grade live performance canary (Playwright + probe script) so regressions are caught quickly.

## Context
- Reported symptom: Master Inbox sometimes loads quickly and sometimes is extremely slow.
- Evidence (Phase 163 investigation):
  - Supabase/Postgres logs showed ~12s+ lead search queries caused by `%term%` (ILIKE/contains-style) scans on large workspaces.
  - Additional variance came from Supabase Admin user lookup behavior paging through all auth users (highly variable under load).
- We already implemented initial stabilizers locally (uncommitted): server-side search guardrails + fast-path for full-email searches, plus Supabase Admin `getUserById` + Redis caching. This phase turns that into a clean, testable, shippable change with live verification.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 163 | Active | Same goal: perf variance + Playwright harness | Phase 164 ships a scoped, commit-ready slice; keep Phase 163 as broad umbrella. |
| Phase 161 | Active | Inbox read APIs (`app/api/inbox/*`) | Keep changes additive; do not alter auth/flag semantics. |
| Phase 160 | Active | Untracked artifacts and unrelated docs edits | Keep Phase 164 commit scoped; do not include unrelated artifacts. |
| Phase 162 | Completed | AI pipeline safety work | Out of scope; avoid touching AI/messaging logic in this phase. |

## Objectives
* [ ] Ship backend fixes that remove the worst-case slow paths (email search scan + Supabase Admin paging variance).
* [ ] Add minimal observability parity for inbox read APIs (`x-request-id`, `x-zrg-duration-ms`).
* [ ] Add a live perf canary suite:
  - `scripts/inbox-canary-probe.ts` (server header timing, p50/p95)
  - `e2e/inbox-perf.spec.mjs` (Playwright, budget checks)
* [ ] Verify in live environment (prod/preview) that p95 server timings are stable and no longer spike for common flows.

## Constraints
- No secrets/cookies/tokens committed to git.
- No PII in logs or test artifacts (counts/timings only).
- Multi-tenant safety: caching must be keyed per user/workspace when applicable; no cross-tenant leakage.
- React work must follow “You might not need an effect”: no effect-driven refetch loops, no state updates during render.

## Success Criteria
- Inbox endpoints expose `x-zrg-duration-ms` and `x-request-id` on success and failure.
- Full-email searches do not trigger `%term%` scans (verified via p95 budgets and/or DB logs).
- Supabase Admin email lookup no longer pages through all users in normal operation (verified by code path + log signals).
- `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, and `npm run test:e2e` pass for the committed change set.
- Live canary runs (Playwright and/or probe script) show stable p95 server timings:
  - `/api/inbox/counts` p95 within agreed budget
  - `/api/inbox/conversations` p95 within agreed budget

## Subphase Index
* a — Scope/Isolation + Evidence Packet Definition
* b — Backend Stabilization (Search + Supabase Admin)
* c — Frontend Stabilization (Search Trigger Guardrails + Render Churn)
* d — Perf Canary Harness (Probe + Playwright) + Runbook
* e — Validation + Commit/Push + Live Verification

