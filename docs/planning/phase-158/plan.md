# Phase 158 — Log Export Triage: Fix Response Timing + Analytics Raw SQL Errors

## Purpose
Fix the production warnings/errors surfaced in the provided Vercel log exports, prioritizing cron 500s and analytics raw SQL failures.

## Context
- Inputs provided (exported 2026-02-16):
  - `zrg-dashboard-log-error-export-2026-02-16T15-36-11.json` (3917 entries)
  - `zrg-dashboard-log-warningexport-2026-02-16T15-36-38.json` (7490 entries)
- Highest-impact issues extracted from the exports:
  1) **Cron hard-fail:** `/api/cron/response-timing` returns `500` repeatedly (PG `42601`, Prisma `P2010`) with `syntax error at or near "$1"`.
     - Root cause is very likely parameterized `SET LOCAL statement_timeout = $1` in `lib/response-timing/processor.ts` (Postgres does not accept `$1` placeholders in `SET` utility statements).
  2) **Analytics (soft-fail):** `/api/analytics/overview` logs `Error calculating response time metrics` (PG `42601`, Prisma `P2010`) with `syntax error at or near "FILTER"`.
     - Root cause appears to be `AVG(...)::double precision FILTER (...)` ordering in `actions/analytics-actions.ts` (cast occurs before `FILTER`, which is invalid SQL).
  3) **Analytics (soft-fail):** `getAiDraftBookingConversionStats` logs failures (PG `42883`, Prisma `P2010`) with `operator does not exist: timestamp without time zone >= interval`.
     - Root cause is likely type inference around `${to} - (${maturityBufferDays} * interval '1 day')` in `actions/ai-draft-response-analytics-actions.ts`.
  4) **Analytics (known / concurrent):** `getCrmWindowSummary` logged PG `42P18` once (`could not determine data type of parameter $4`) on `/api/analytics/crm/rows` (this overlaps with Phase 157’s active work).
- Warning noise that may or may not be actionable:
  - **528** warnings: `Failed to find Server Action "<id>"` on `POST /` and `POST /auth/login` returning `404` (likely stale client payloads across deployments and/or caching behavior; needs investigation + UX mitigation decision).
  - Several integration warnings are likely *external-state* (EmailBison reply send 404 “Record not found”, SMTP auth required reconnect; GHL DND active) and should be treated as operational signals rather than code defects unless retry/skip semantics are wrong.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 157 | Active | `actions/analytics-actions.ts` (raw SQL bind patterns + analytics reliability) | Do not revert concurrent edits; re-read current file state and merge semantically. Prefer to land FILTER fix alongside Phase 157’s query-safety work. |
| Phase 156 | Active | Dashboard settings UI | Independent; avoid Settings IA changes unless required for server-action warning mitigation. |
| Uncommitted working tree | Active | `actions/analytics-actions.ts` modified; `docs/planning/phase-156/` and `docs/planning/phase-157/` untracked | Preserve intent of existing uncommitted changes; keep Phase 158 touches minimal and focused. |

## Repo Reality Check (RED TEAM)

- What exists today:
  - `lib/response-timing/processor.ts` uses bounded `$executeRawUnsafe` for `SET LOCAL statement_timeout` in the response-timing cron transaction.
  - `actions/analytics-actions.ts` response-time aggregate SQL uses `AVG(... ) FILTER (...)` ordering and now has regression coverage in `lib/__tests__/analytics-response-time-metrics-sql.test.ts`.
  - `actions/ai-draft-response-analytics-actions.ts` computes booking-conversion maturity cutoff in JS and binds it as a timestamp parameter.
  - Server-action refresh fallback is now wired in:
    - `app/auth/login/page.tsx`
    - `components/dashboard/dashboard-shell.tsx`
    - `lib/server-action-version-skew.ts`
  - `next.config.mjs` includes deployment skew guardrails (`deploymentId`) and no-store headers for `/` and `/auth/login`.
- What the plan assumes:
  - Local SQL fixes remove the exact PG `42601` / `42883` signatures seen in the export.
  - Server-action warning spikes are largely version-skew noise, not a single handler regression.
  - Production signature disappearance still requires deploy + follow-up logs.
- Verified touch points:
  - `lib/response-timing/processor.ts`
  - `actions/analytics-actions.ts`
  - `actions/ai-draft-response-analytics-actions.ts`
  - `app/auth/login/page.tsx`
  - `components/dashboard/dashboard-shell.tsx`
  - `next.config.mjs`

## Objectives
* [x] Translate log export findings into a concrete, prioritized fix list with code touch points.
* [x] Stop the `/api/cron/response-timing` 500s by fixing the failing raw SQL.
* [x] Fix analytics raw SQL issues so metrics endpoints stop emitting Prisma `P2010` warnings/errors.
* [x] Decide and (if feasible) mitigate the “Failed to find Server Action” warning storm.
* [x] Validate with lint/typecheck/build/tests and confirm errors disappear in follow-up logs.

## Constraints
- Do not commit log export JSONs or any secrets.
- Keep fixes minimal and strongly typed; prefer Prisma-safe SQL patterns.
- Any “unsafe” SQL must be bounded and non-user-controlled (document why it is safe).
- Coordinate with Phase 157 changes in `actions/analytics-actions.ts` (merge semantics, don’t overwrite).

## Success Criteria
- `/api/cron/response-timing` returns `200` in production and no longer logs Prisma `P2010` / PG `42601` (`syntax error at or near "$1"`).
- `/api/analytics/overview` no longer logs `Error calculating response time metrics` with PG `42601` (`syntax error at or near "FILTER"`).
- `getAiDraftBookingConversionStats` no longer logs PG `42883` (`timestamp without time zone >= interval`) and returns data for a normal window.
- A clear decision is made for server-action drift warnings:
  - either reduced materially by preventing stale caching, or
  - handled via explicit UX fallback (“app updated, refresh”) with documented rationale if the server-side warning cannot be eliminated.
- Validation gates pass:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm test`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Sampling gap: production verification was completed via targeted post-deploy log windows, but low-frequency signatures could still recur outside sampled windows.
  - Mitigation: keep 24h follow-up monitoring for the same signatures and reopen with a narrow phase only if they reappear.
- Server-action drift warnings can persist from already-open stale tabs even after cache/header mitigation.
  - Mitigation: keep explicit refresh fallback UX and monitor warning trend, not just absolute zero.

### Missing or ambiguous requirements
- Replay evidence field naming differs from older docs (`promptKey`/`systemPrompt` vs `judgePromptKey`/`judgeSystemPrompt`).
  - Plan fix: record available artifact keys directly and map terminology in closure notes.

### Repo mismatches / coordination risks
- `next.config.mjs` overlaps Phase 159 upload-limit work.
  - Mitigation: keep Phase 158 change additive (`deploymentId` + route cache headers) and retain existing server-action size/origin config.
- `actions/analytics-actions.ts` overlaps Phase 157 analytics hardening.
  - Mitigation: semantic merge only; no reverts of concurrent query-safety edits.

### Testing / validation
- NTTAN manifest file is absent for this phase.
  - Mitigation: use fallback replay invocation with `--client-id ... --limit 20` and record artifact diagnostics.

## Assumptions (Agent)
- The `Failed to find Server Action` burst is primarily version skew behavior (stale client vs newer deployment), not one deterministic bad action ID. (confidence ~95%)
- `deploymentId` + `no-store` on `/` and `/auth/login` materially reduces stale action payload reuse but cannot retroactively fix old open tabs. (confidence ~92%)
- The SQL fixes are sufficient to eliminate the exact logged parse/type signatures once deployed. (confidence ~92%)

## Open Questions (Need Human Input)
- [x] Can we run a production verification window immediately after deploying these changes? (resolved 2026-02-16)
  - Outcome: yes; production verification window completed with deploy + endpoint probes + runtime log sampling.

## Subphase Index
* a — Log Triaging + Issue Inventory
* b — Response Timing Pipeline Fixes (Cron + Overview Metrics)
* c — AI Draft Booking Conversion Stats Fix
* d — Server Action Drift Warning Mitigation (Decision + Fix)
* e — Validation + Verification (Local + Production Logs)

## Phase Summary (running)
- 2026-02-16 — Built issue inventory from provided exports with concrete counts/signatures and mapped callsites for cron `$1`, overview `FILTER`, booking `timestamp >= interval`, and server-action drift warnings.
- 2026-02-16 — Landed/validated code-path mitigations for stale Server Action IDs: shared skew detector + login/dashboard reload fallback + `deploymentId`/no-store route cache headers (files: `lib/server-action-version-skew.ts`, `app/auth/login/page.tsx`, `components/dashboard/dashboard-shell.tsx`, `next.config.mjs`).
- 2026-02-16 — Validation gates completed locally: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, plus targeted SQL regression tests.
- 2026-02-16 — NTTAN completed using fallback replay mode (no manifest): `npm run test:ai-drafts` and replay dry/live artifacts captured under `.artifacts/ai-replay/` (live summary: evaluated=19, passed=18, failedJudge=1, failureType `draft_quality_error=1`, promptKey `meeting.overseer.gate.v1`).
- 2026-02-16 — Production verify loop completed with three deploys (`b3i6nigmi`, `p6m7s3fjh`, `hmoopsjxc`), including two production-only not-null default drift fixes (`ResponseTimingEvent.id` and `ResponseTimingEvent.updatedAt` explicit insert values).
- 2026-02-16 — Final production verification on `https://zrg-dashboard-hmoopsjxc-zrg.vercel.app`: cron endpoint returns `200`, authenticated analytics overview/campaigns return `200`, and post-deploy runtime log windows show zero occurrences of target signatures (`$1`, `FILTER`, `timestamp >= interval`, `AiDraftBookingConversionStats Failed`, `Failed to find Server Action` within sampled window).
- Phase 158 is ready to close.
- 2026-02-16 — Post-implementation review completed (`docs/planning/phase-158/review.md`): combined-worktree `lint`/`build` passed; NTTAN rerun passed (dry-run + live) with prompt evidence `meeting.overseer.gate.v1`; optional baseline compare completed (`improved=3`, `regressed=2`, `new=6`) with no infra/critical invariant failures.
- 2026-02-16 13:51 EST — Terminus Maximus closure checkpoint: re-ran multi-agent preflight + phase-gaps RED TEAM repo-reality validation for Phase 158; all recorded touchpoints still exist and no additional planning gaps were identified (files: `docs/planning/phase-158/plan.md`).
