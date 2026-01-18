# Phase 31 — Review

## Summary
- Reviewed on `main` @ `442cacfe56ce0a1cec30af9a78d812f246b49114` with a dirty working tree (`45` modified, `17` untracked).
- Quality gates passed: `npm run lint` (warnings only), `npm run build`, `npm run db:push` (already in sync).
- Code changes align with Phase 31 goals (P2002 dedupe safety, fetch abort/retry hardening, Insights cron P1001 handling, Unipile disconnect health tracking), but production verification is still required for the “no more errors in logs” criteria.
- User-visible Unipile alerting is Slack-backed + persisted in DB, and an in-app banner was added post-review.

## What Shipped (evidence in working tree)
- Prisma error helpers + retry: `lib/prisma.ts`
- Email webhook: fast-path + P2002 race handling + background job enqueue + `maxDuration = 60`: `app/api/webhooks/email/route.ts`
- SMS webhook: P2002 guard in historical import + AI draft timeout handling: `app/api/webhooks/ghl/sms/route.ts`
- EmailBison fetch hardening (timeout default 30s, GET-only retries, abort classification): `lib/emailbison-api.ts`
- Insights context-pack cron hardening (P1001 retry + circuit breaker + smaller batch cap + 503 on DB unreachable): `app/api/cron/insights/context-packs/route.ts`
- Unipile disconnect detection + persisted workspace health + deduped Slack notification: `lib/unipile-api.ts`, `lib/workspace-integration-health.ts`, `lib/followup-engine.ts`, `prisma/schema.prisma`

## Verification

### Commands
- `npm run lint` — pass (warnings only) (`2026-01-17T12:42:51Z`)
- `npm run build` — pass (`2026-01-17T12:43:16Z`)
- `npm run db:push` — pass (`2026-01-17T12:43:55Z`) (DB already in sync)

### Notes
- Lint: `0` errors, `17` warnings (mostly `@next/next/no-img-element` + hooks deps warnings).
- Build: succeeds; Next.js warns about multiple lockfiles and deprecated middleware convention.
- Post-review follow-up edits:
  - `npm run typecheck` passed (`2026-01-17T13:54:48Z`)
  - `npm run lint` passed (warnings only) (`2026-01-17T13:56:50Z`)
  - `npm run build` re-run was blocked by `.next/lock` being held by another process (no compile error observed).

## Success Criteria → Evidence

1. No P2002 errors on `emailBisonReplyId` in production logs
   - Evidence: P2002 is handled in webhook message inserts via `isPrismaUniqueConstraintError` and try/catch paths (`lib/prisma.ts`, `app/api/webhooks/email/route.ts`, plus other webhook handlers listed in `docs/planning/phase-31/f/plan.md`).
   - Status: partial (code fix present; requires prod log verification after deploy).

2. EmailBison fetch errors are caught and logged without crashing the request
   - Evidence: EmailBison wrapper now classifies aborts, retries GET-only, and returns structured `{ success: false, error }` on failures (`lib/emailbison-api.ts`).
   - Status: partial (implementation present; needs runtime validation under real API slowness/cancellation).

3. AI draft generation failures don't block webhook response
   - Evidence: Email webhook enqueues background post-process and returns quickly; AI sentiment classification moved to background worker (`app/api/webhooks/email/route.ts`, `lib/background-jobs/email-inbound-post-process.ts`).
   - Status: partial (design aligns; needs prod timing confirmation and verification that no slow path is still on critical path).

4. Unipile disconnected accounts trigger a user-visible notification (schema-consistent: UI banner and/or Slack) with dedupe
   - Evidence: Workspace health persisted on `Client` + deduped Slack notification via `updateUnipileConnectionHealth` (`prisma/schema.prisma`, `lib/workspace-integration-health.ts`, `lib/followup-engine.ts`).
   - Status: partial (Slack + persisted state implemented; UI banner added post-review in `app/page.tsx`).

5. Insights Cron completes without P1001 errors under normal load; retries/early-exit behavior is explicit when DB is unreachable
   - Evidence: `withDbRetry` + `isPrismaConnectionError` + circuit breaker + 503 “db_unreachable” behavior (`lib/prisma.ts`, `app/api/cron/insights/context-packs/route.ts`).
   - Status: partial (code hardening present; needs prod observation).

6. Email webhook returns 200 OK quickly (target: <5–10s) and never hits the 800s runtime timeout
   - Evidence: Email webhook `maxDuration` reduced to `60` and slow work is deferred via background jobs (`app/api/webhooks/email/route.ts`).
   - Status: partial (local code indicates fast-path; needs prod timing confirmation).

7. AbortError/DOMException aborts are classified (timeout vs caller cancel) and do not trigger unsafe retries
   - Evidence: Abort classification + “never retry caller cancellation” + GET-only retries in `lib/emailbison-api.ts` (and referenced by phase notes as applied elsewhere).
   - Status: partial (implementation present; no explicit simulation/repro in this review).

8. `npm run lint` + `npm run build` pass
   - Evidence: commands executed successfully (see Verification section).
   - Status: met.

## Plan Adherence
- Implemented the core hardening patterns described in the subphases (P2002 catch-and-dedupe, webhook fast-path, retry/circuit breaker for P1001).
- Deviations / gaps:
  - Production monitoring for “no more errors in logs” criteria is manual and still pending.

## Risks / Rollback
- Email webhook `maxDuration` lowered to 60s: if any slow work accidentally remains on the critical path, requests may fail sooner; rollback would be reverting `maxDuration` and/or removing any remaining slow awaits from webhook handlers.
- EmailBison GET retries can increase upstream load during outages; mitigated by low retry cap + GET-only rule.
- Insights cron retry/circuit breaker can mask intermittent DB issues; mitigated by explicit counters + 503 on initial DB unreachable.

## Follow-ups
- Deploy and monitor prod logs for 24–48h to validate reductions in: `P2002`, `P1001`, webhook runtime timeouts, and abort spam. (manual)
- Dashboard UI banner for Unipile disconnect: done (`app/page.tsx`, `actions/client-actions.ts`).
- Document new env vars/tuning knobs in `README.md`: done (`README.md`).
- P2002 regression test: skipped (no test harness in `package.json`).

## Follow-Up Automation Snapshot (Separate from Phase Follow-ups)
- DB snapshot time: `2026-01-17 13:41:35+00`
- Follow-up processing readiness:
  - Eligible due instances (matches cron selection predicate): `0`
  - Active instances overdue by time alone (`nextStepDue <= now()`): `85`, and all `85` are excluded because `Lead.autoFollowUpEnabled = false`
  - `FollowUpTask` created today (`2026-01-17`): `0`
  - Instances with `lastStepAt` today: `0` (no follow-up steps executed today)
- Workspace health:
  - Workspaces marked `unipileConnectionStatus = 'DISCONNECTED'`: `0`
- Cron side effect observed:
  - Availability caches refreshed since `2026-01-17T12:40:00Z`: `39` (latest `fetchedAt` around `13:40Z`)
