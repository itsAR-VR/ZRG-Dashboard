# Phase 53 — Production Stability: Webhook Bursts, Inbox Timeouts, and Integration Resilience

## Purpose
Plan and execute fixes for the production issues surfaced in `logs_result.csv` (Vercel logs from **2026-01-23 17:51:04 → 18:20:01 UTC**) with a focus on eliminating timeouts, reducing DB contention, and making integrations fail safely and idempotently.

## Context
`logs_result.csv` contains a short but high-signal window of production failures and degradations:

### A) Email webhook burst → 504 + 60s runtime timeouts
- Path: `POST /api/webhooks/email`
- Observed: **203** requests returned **504**, with explicit `Vercel Runtime Timeout Error: Task timed out after 60 seconds`.
- Concentrated burst: **~177** 504s during **18:13–18:14 UTC**, strongly suggesting burst/concurrency + DB contention rather than a single “slow code path”.

### B) Inbox counts query canceled by Postgres statement_timeout (P2010 / 57014)
- Path: `POST /` (Next.js Server Actions)
- Log signature: `Failed to get inbox counts ... prisma.$queryRaw() ... canceling statement due to statement timeout`
- Count: **37** occurrences.
- Source: `actions/lead-actions.ts:getInboxCounts()` uses a CTE + aggregation over `Lead` and `Message` to compute “requires attention” counts.

### C) Severe latency on `/` (likely DB contention)
- For successful `POST /` entries with `durationMs`, median duration is ~**120s** (near a runtime cap), indicating broader request-path work is stalling under load (likely connection pool saturation driven by webhook burst).

### D) Auth/session noise + aborts
- `AuthApiError ... refresh_token_not_found` appears **12** times (primarily middleware on `/auth/login` and `/`).
- `DOMException [AbortError]: This operation was aborted` appears **4** times (middleware/edge fetch aborts).
- These are “expected” in signed-out/stale-cookie states but are currently logged as errors.

### E) Background automation reliability issues
- Step-3 verifier:
  - `Step 3 verifier failed: Error: Request timed out.` (**9**)
  - `Step 3 verifier hit max_output_tokens; discarding output` (**2**)
- Slot offer ledger:
  - `P2028 ... Unable to start a transaction in the given time` (interactive transaction acquisition; **1**)

### F) Integration failures (should be bounded + actionable)
- GHL contact sync: `[GHL Contact] ... Failed to upsert contact in GHL` (**6**, low diagnostic value).
- SMS conversation sync: `Lead has no GHL contact ID` (**2** warnings; should be skipped or repaired).
- Unipile:
  - `Connection check failed (401) ... Disconnected account` (**2**)
  - `Connection check failed (422) ... Recipient cannot be reached` (**2**)

## Concurrent Phases
These phases are currently present on disk and/or overlap strongly with the same surfaces this phase must touch.

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 52 | Active/dirty (untracked on current working tree) | Domain: booking automation; Files: `lib/followup-engine.ts`, draft/booking flows | Any changes to follow-up triggers/idempotency should align with Phase 52’s booking automation requirements. |
| Phase 51 | Active/dirty (untracked on current working tree) | Domain: inbound kernels + prompt runner; Files: `lib/background-jobs/*-inbound-post-process.ts`, `lib/ai-drafts.ts`, `actions/email-actions.ts` | This phase’s webhook + AI reliability work should be designed to *fit into* Phase 51’s kernel/prompt-runner direction (avoid parallel abstractions). |
| Phase 42 | Complete/unknown deploy state | Domain: auth/session hardening + timeout reduction | Phase 53 must verify which Phase 42 mitigations are actually deployed; refresh-token noise indicates remaining gaps. |

## Objectives
* [x] Stop `/api/webhooks/email` 504/60s timeouts under burst load by making ingestion O(1) and moving heavy work off-request-path. *(Implemented; requires deploy + flag rollout.)*
* [x] Eliminate `getInboxCounts()` statement timeouts via query/index improvements and/or cached counts with safe fallbacks. *(Implemented Lead-only query + legacy fallback; requires schema/backfill.)*
* [x] Reduce `/` server-action latency (especially under webhook bursts) by lowering DB connection contention and bounding expensive work. *(Implemented: webhook queue + bounded processors; counts rewrite reduces hot-path joins.)*
* [x] Treat auth/session “expected unauth” states as normal (no error spam; no abort cascades). *(Implemented: AbortError + server-action hygiene.)*
* [x] Make AI + background jobs robust to timeouts/truncation and reduce transaction contention. *(Implemented: verifier hardening + ledger transaction removal.)*
* [x] Make GHL/Unipile failures actionable and self-limiting (health state, backoff, skip/disable, no noisy repeats). *(Implemented: Unipile health gating + per-lead quarantine; GHL upsert normalization; SMS sync noise reduction.)*
* [x] Produce a concrete verification and rollback runbook for post-deploy confirmation. *(Added runbook artifact.)*

## Constraints
- **Idempotency first**: webhook retries and cron replays must not create duplicate leads/messages/jobs.
- **No secrets in logs**: never log API keys, tokens, cookies, or raw auth headers; avoid logging full webhook bodies if they contain PII.
- **Backpressure**: bursty providers must not translate into bursty DB work. Prefer queueing + bounded processors.
- **Minimal “on-path” work**: webhook endpoints should do the minimum required to persist/dedupe and respond 2xx quickly.
- Coordinate schema changes with Phase 51/52; keep migrations small and reversible.

## Success Criteria
- `/api/webhooks/email`: 0 sustained 504s during burst conditions; p95 request duration < 1s for ingestion endpoint. *(Pending deploy + enable `INBOXXIA_EMAIL_SENT_ASYNC` after DB migration.)*
- `getInboxCounts()`: no `57014 statement timeout` cancellations in production logs; counts load reliably for large workspaces. *(Pending deploy + backfill `Lead.lastZrgOutboundAt`.)*
- `/` server action latency no longer clusters around runtime caps during webhook bursts. *(Pending deploy; expected improvement from webhook queue + counts rewrite.)*
- `refresh_token_not_found` and `AbortError` no longer appear as error-level log spam in normal signed-out navigation. *(Pending deploy; implemented log-level + classification changes.)*
- Step-3 verifier: timeout/truncation becomes rare and safe (fallback behavior); no repeated “discarding output” on typical drafts. *(Pending deploy; implemented deterministic enforcement + gated logging.)*
- Slot offer ledger increments do not trigger `P2028` transaction acquisition failures. *(Pending deploy; removed batched transaction.)*
- Unipile disconnected accounts disable LinkedIn follow-ups automatically and surface a clear remediation path; invalid-recipient cases are quarantined per-lead (no infinite retries). *(Pending deploy; enable `UNIPILE_HEALTH_GATE`.)*

## Subphase Index
* a — Incident map + instrumentation + rollout strategy
* b — Email webhook burst hardening (enqueue-first + bounded processor)
* c — Inbox counts performance hardening (indexes/precompute/cache + safe fallback)
* d — Auth/session + Server Action error hygiene (no noise, no abort cascades)
* e — AI + background job stability (timeouts, truncation, transaction contention)
* f — Integration health states (GHL + Unipile) + verification/rollback runbook

## Phase Summary
- **Webhook burst hardening:** `WebhookEvent` durable queue + bounded processor; `EMAIL_SENT` can enqueue-first behind `INBOXXIA_EMAIL_SENT_ASYNC`.
- **Inbox counts hardening:** `Lead.lastZrgOutboundAt` rollup + Lead-only counts query with legacy fallback; backfill via `scripts/backfill-lead-message-rollups.ts`.
- **Auth noise reduction:** AbortError suppression in middleware + server-action unauth hygiene (`getPendingDrafts`).
- **AI/job stability:** Step‑3 verifier made best-effort with deterministic post-pass enforcement + log gating; slot-offer ledger no longer uses a batched transaction.
- **Integrations:** Unipile 401/422 handled as control-flow with health gating (`UNIPILE_HEALTH_GATE`) and per-lead unreachable quarantine; GHL upsert response normalized; SMS sync treats email-only leads as no-op.
- **Runbook:** `docs/planning/phase-53/runbook.md` (deploy order, verification, rollback).

## Verification Results (2026-01-24)
- `npm run lint`: **pass** (0 errors, 17 pre-existing warnings)
- `npm run build`: **pass** (Next.js 16 Turbopack)
- `npm run db:push`: **pending** (schema changes require push before enabling `INBOXXIA_EMAIL_SENT_ASYNC`)
- Full review: `docs/planning/phase-53/review.md`
