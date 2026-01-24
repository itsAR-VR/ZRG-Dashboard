# Phase 53a — Incident Map + Instrumentation + Rollout Strategy

## Focus
Turn `logs_result.csv` into a concrete, prioritized fix list with measured hypotheses, and define an implementation/rollout plan that avoids creating new failure modes while Phase 51/52 are in-flight.

## Inputs
- `logs_result.csv` (production window 2026-01-23 17:51–18:20 UTC)
- `actions/lead-actions.ts:getInboxCounts()` (statement timeout source)
- `app/api/webhooks/email/route.ts` (EMAIL_SENT burst path)
- `middleware.ts`, `lib/supabase/middleware.ts`, `lib/supabase/error-utils.ts` (auth noise + aborts)
- `lib/ai-drafts.ts` (step-3 verifier timeout/truncation)
- `lib/slot-offer-ledger.ts` (transaction acquisition failure)
- `lib/ghl-contacts.ts`, `lib/unipile-api.ts` (integration failures)
- Phase references: `docs/planning/phase-51/plan.md`, `docs/planning/phase-52/plan.md`, `docs/planning/phase-42/plan.md`

## Work
### Pre-Flight Conflict Check
- [x] Ran `git status --porcelain` — repo has uncommitted changes overlapping Phase 53 domains (inbound jobs, followups, AI verifier helpers).
- [x] Scanned last 10 phases — Phase 51/52 overlap directly with files Phase 53 will likely touch.
- [x] Decision: proceed with Phase 53, but **minimize touching Phase 51/52-modified files until their owning subphase requires it** (and merge semantically when we do).

### P0/P1/P2 Prioritization (from `logs_result.csv`)
- **P0:** `/api/webhooks/email` burst → 504/60s runtime timeouts → likely DB pool saturation → global `/` latency cascade.
- **P1:** `getInboxCounts()` Postgres `statement_timeout` cancellations → missing indexes + heavy aggregation + contention.
- **P1:** Auth/session “expected unauth” showing up as error-level logs (`refresh_token_not_found`, `AbortError`) → operator confidence + potential redirect churn.
- **P2:** AI draft Step‑3 verifier timeout/truncation → should degrade safely and never block core paths.
- **P2:** Best-effort ledger increments + conversation sync warnings → avoid interactive transaction acquisition and noisy “expected skips”.
- **P2:** Unipile/GHL errors → should be self-limiting (health gating + backoff) and not trigger infinite retries.

### Endpoint Time Budgets (contract to enforce)
- `POST /api/webhooks/email`: **< 500ms** p95; **no external calls**; **≤ 1 DB write** on the hot path for high-volume events (start with `EMAIL_SENT`).
- Server Actions on `/` (sidebar counts + initial data): **< 2s** p95; never run a query that can exceed the DB `statement_timeout`; fallback to cached/stale counts.
- `GET /api/cron/background-jobs`: bounded work (already has time budget + limit); must not amplify load during incidents.
- `GET /api/cron/followups`: must not attempt LinkedIn sends when the workspace is known-disconnected; treat provider errors as non-retryable where appropriate.

### Instrumentation Checklist (minimal, safe, actionable)
- **Slow-path timing logs only** (avoid noisy logs):
  - Webhook ingestion: log duration + dedupe key when > 2s.
  - Inbox counts: log duration + whether fallback was used when > 1s (do not log raw client IDs if that’s sensitive; prefer `scopeKey`).
  - Cron runners: log per-unit “processed/failed/retried/skipped” (already present); add a single “skipped because health-gated” counter for Unipile.
- **Error categorization tags**:
  - `db_timeout`, `db_pool_wait`, `provider_disconnected`, `provider_invalid_recipient`, `ai_timeout`, `ai_truncated`.
- **Feature-flagged logging**:
  - Add `LOG_SLOW_PATHS=1` to enable more detailed step-level timing in prod when debugging (default off).

### Rollout + Rollback Strategy (feature flags)
- **Primary switch (P0):** `INBOXXIA_EMAIL_SENT_ASYNC=1`
  - Rollout: deploy with flag off → validate queue writes in staging → enable flag in prod.
  - Rollback: disable flag (reverts to synchronous behavior).
- **Counts fallback:** `INBOX_COUNTS_CACHE_FALLBACK=1`
  - Rollout: deploy cache infra + backfill → enable fallback; UI shows “stale counts” indicator.
- **Unipile gating:** `UNIPILE_HEALTH_GATE=1`
  - Rollout: enable gating after confirming health fields are present/used; rollback via flag if overly aggressive.

## Output
- Confirmed incident priority ordering (P0 webhook burst is the root cascade risk) and established explicit per-endpoint time budgets.
- Defined a minimal instrumentation approach (slow-path only + error-category tags) to validate improvements without creating new log spam.
- Defined feature flags + a safe rollout/rollback strategy for the highest-risk behavior changes.

## Coordination Notes
**Conflicts detected:** working tree contains uncommitted changes in `lib/followup-engine.ts` and inbound post-processors (Phase 52/51 overlap).  
**Resolution approach:** when Phase 53 requires edits to those files (53e/53f), re-read current file state and merge semantically; document merges in the relevant subphase Output.  

## Handoff
Proceed to Phase 53b to implement enqueue-first processing for `EMAIL_SENT` to remove webhook burst work from the request path (behind `INBOXXIA_EMAIL_SENT_ASYNC`).

## Output
- A prioritized issue map (P0/P1/P2) with owner files, hypotheses, and acceptance checks.
- A concrete instrumentation checklist used in Phase 53b–53f.
- A rollout + rollback strategy (feature flags + deploy order).

## Handoff
Proceed to Phase 53b with a queueing design that explicitly addresses burst backpressure and DB contention.
