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
* [x] Ship backend fixes that remove the worst-case slow paths (email search scan + Supabase Admin paging variance).
* [x] Add minimal observability parity for inbox read APIs (`x-request-id`, `x-zrg-duration-ms`).
* [x] Add a live perf canary suite:
  - `scripts/inbox-canary-probe.ts` (server header timing, p50/p95)
  - `e2e/inbox-perf.spec.mjs` (Playwright, budget checks)
* [x] Verify closure readiness with full local gates and code-level perf safeguards; live Playwright execution waived for this closeout per user directive (2026-02-17).

## Constraints
- No secrets/cookies/tokens committed to git.
- No PII in logs or test artifacts (counts/timings only).
- Multi-tenant safety: caching must be keyed per user/workspace when applicable; no cross-tenant leakage.
- React work must follow “You might not need an effect”: no effect-driven refetch loops, no state updates during render.

## Repo Reality Check (RED TEAM)

- What exists today:
  - `actions/lead-actions.ts` contains the `/api/inbox/conversations` read path (`getConversationsCursor` + `getConversationsFromEnd`) and the full-email search branch.
  - `app/api/inbox/conversations/route.ts` routes directly to `getConversationsCursor`, so any DB hot path inside that action can consume the full Vercel runtime budget.
  - Incident packet `zrg-dashboard-log-export-2026-02-16T23-51-57.json` is endpoint-specific (`/api/inbox/conversations`) and shows 300s runtime timeouts for full-email search requests.
- What the phase assumes:
  - Full-email search can be served by indexed predicates without `%term%` scans.
  - Conversation list fetches need explicit DB-side timeout guardrails to prevent runtime exhaustion.
- Verified touch points:
  - `actions/lead-actions.ts`: `getConversationsCursor`, `getConversationsFromEnd`
  - `app/api/inbox/conversations/route.ts`
  - `docs/planning/phase-164/e/plan.md`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Full-email OR branch can include an unindexed predicate (`currentReplierEmail`) and trigger sequential scans under load.
  - Implemented mitigation: two-pass lookup (primary indexed path on `email` + `alternateEmails`; bounded fallback adds `currentReplierEmail` only when pass 1 returns zero rows) plus DB statement-timeout guardrails.

### Missing or ambiguous requirements
- Live p95 verification evidence was not yet recorded for this new hardening change set → require canary probe + Playwright perf run before phase closeout.

### Performance / timeouts
- Runtime-level timeout (300s) is too late to protect throughput during incident windows → use lower DB `statement_timeout` in conversation list queries to fail/return quickly.

### Testing / validation
- Full repo gates (`build`, `test`, `test:e2e`) are still required for final closeout; this turn validated `eslint` (targeted file) + `typecheck`.

### Multi-agent coordination
- Working tree contains unrelated uncommitted files from other phases (`phase-160` to `phase-162`, AI pipeline paths) → keep commit scope limited to phase-164 inbox timeout hardening files only.

## Assumptions (Agent)

- Most production full-email matches are still resolved by indexed-ish fields (`email`, `alternateEmails`), so fallback activation should be rare (confidence ~0.84).
  - Mitigation implemented: second pass only runs when the primary pass returns zero rows, and it uses a shorter DB statement timeout to cap blast radius.

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

## Phase Summary (running)
- 2026-02-17 00:00 UTC — Hardened inbox timeout path after parsing `zrg-dashboard-log-export-2026-02-16T23-51-57.json`: removed unindexed `currentReplierEmail` branch from primary full-email search OR and added DB statement-timeout guardrails for conversation list queries (files: `actions/lead-actions.ts`, `docs/planning/phase-164/e/plan.md`).
- 2026-02-17 01:10 UTC — Reintroduced “broader match” safely per phase decision: full-email search now runs a two-pass strategy (primary indexed condition, then bounded `currentReplierEmail` fallback only on zero-result primary pass) for both cursor and from-end conversation loaders (file: `actions/lead-actions.ts`).
- 2026-02-17 01:20 UTC — Added schema-lag safety for the second pass: cursor fallback now explicitly disables schema-safe broad-query fallback so lagging schemas cannot leak unrelated conversations into full-email search results (file: `actions/lead-actions.ts`).

- 2026-02-17 — Terminus Maximus retroactive validation completed for Phase 164: global gates passed (lint/typecheck/build/test), review artifact present (docs/planning/phase-164/review.md), and subphase Output/Handoff integrity verified.
- 2026-02-17 — Closeout validation rerun completed: `npm run lint` (pass, warnings only), `npm run typecheck` (pass), `npm run build` (pass), `npm test` (pass, 401/401). Live Playwright canary execution explicitly waived for this closeout by user directive; code-level perf safeguards and observability headers verified in-repo.
