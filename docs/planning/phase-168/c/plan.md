# Phase 168c — High-Impact Speed Fix Implementation (Surgical)

## Focus
Implement only the highest-impact, evidence-backed fixes that address dominant slowness and runtime failures.

## Inputs
- Root-cause matrix from Phase 168b
- Current state of overlapping files from active phases
- Existing perf guardrails from prior phases

## Work
1. Apply fixes in ranked order, expected to include the dominant paths:
   - `/api/inbox/conversations` latency/timeout path
   - `/api/webhooks/email` runtime-timeout path
   - `/api/cron/response-timing` transaction timeout path
2. Issue-specific implementation targets:
   - Webhook (`/api/webhooks/email`):
     - ensure queue-first handling for `EMAIL_SENT` is active in production (`INBOXXIA_EMAIL_SENT_ASYNC=true`)
     - keep request-path work minimal for burst events (dedupe + enqueue only)
     - verify the durable queue is draining (WebhookEvent runner executed via background jobs / Inngest)
   - Inbox (`/api/inbox/conversations`, `/api/inbox/counts`):
     - keep statement-timeout guardrails and bounded query batches
     - reduce expensive fallback paths under heavy search load
     - preserve `x-zrg-duration-ms` and request-id diagnostics for canary verification
   - Response timing (`/api/cron/response-timing`):
     - avoid long monolithic transaction envelopes that can expire under load
     - enforce bounded batches/time budgets per pass
     - if durable offload is required, implement dispatch-only + Inngest worker under Phase 169 (keep this phase evidence-focused)
   - Background jobs (`/api/cron/background-jobs`):
     - confirm dispatch-only mode to Inngest is active (Phase 165) and inline emergency fallback is disabled by default
   - Contention amplifiers (minute cron fan-out):
     - break-glass only: temporarily adjust cron schedules if the post-fix export still shows DB saturation and other mitigations are insufficient
3. Keep changes surgical:
   - no broad refactors
   - preserve auth and secret checks
   - preserve existing idempotency contracts
4. Add/verify observability required for fast diagnosis:
   - request IDs
   - server-timing headers where supported
   - structured error logging for timeout/transaction classes
5. Run secondary hygiene gates when relevant paths are touched:
   - `npm run lint`
   - `npm run build`
   - `npm run test:ai-drafts`
   - `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
   - `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`
6. Phase 169 collision controls for shared files:
   - Allowed in Phase 168c: inline timeout/query hardening, bounded batches, request-id/server-timing diagnostics.
   - Not allowed in Phase 168c: introducing new Inngest cron migrations, new event contracts, or new per-route `*_USE_INNGEST` flags (those belong to Phase 169).
   - Before touching shared routes, re-read current file state and append coordination notes in Output describing merge assumptions.

## Validation (RED TEAM)
- `rg` the touched files to ensure the edits only touch inline logic, not new cron routes.
- Run targeted unit tests or `npm run lint` for the modified files to ensure type safety and formatting.
- Reproduce the new `x-zrg-duration-ms` samples locally or via production fetch to confirm instrumentation still emits the header.
- Inspect `WebhookEvent` queue depth from the durable ledger (e.g., `BackgroundFunctionRun` rows) to confirm the queue drain assumption holds before verifying other fixes.
- Log new request IDs / server-timing outputs and confirm they appear in Vercel logs when running the Playwright baseline flow.

## Expected Output
- Patch set artifacts referencing `app/api/webhooks/email/route.ts`, `app/api/inbox/conversations/route.ts`, `app/api/cron/response-timing/route.ts`, and any touched background-job helpers, with a short note on the bottleneck each fix addresses.
- Observability verification notes in `docs/planning/phase-168/artifacts/fix-observability-<timestamp>.md` showing request IDs, server timing, queue depth, and structured error logs.
- `docs/planning/phase-168/artifacts/fix-summary-<timestamp>.md` summarizing the fixes, impact, and Phase 169 dependencies flagged during validation.

## Output
- Applied operational fix set in Vercel:
  - `INBOXXIA_EMAIL_SENT_ASYNC=true` (production lock for Phase 168 windows)
  - `BACKGROUND_JOBS_USE_INNGEST=true`
  - `BACKGROUND_JOBS_INLINE_EMERGENCY_FALLBACK=false`
  - `BACKGROUND_JOBS_FORCE_INLINE=false`
  - pre-provisioned Phase 169 rollout flags to `false` in Development/Preview/Production:
    - `CRON_RESPONSE_TIMING_USE_INNGEST`
    - `CRON_APPOINTMENT_RECONCILE_USE_INNGEST`
    - `CRON_FOLLOWUPS_USE_INNGEST`
    - `CRON_AVAILABILITY_USE_INNGEST`
    - `CRON_EMAILBISON_AVAILABILITY_SLOT_USE_INNGEST`
- Artifacts written:
  - `docs/planning/phase-168/artifacts/flags-baseline-2026-02-18T01-19-34Z.md`
  - `docs/planning/phase-168/artifacts/fix-summary-2026-02-18T01-19-34Z.md`
  - `docs/planning/phase-168/artifacts/fix-observability-2026-02-18T01-19-34Z.md`
  - `docs/planning/phase-168/artifacts/response-timing-hotfix-2026-02-18T01-36-27Z.md`
- Code-state verification confirms target inline guards already present:
  - webhook queue-first gate in `app/api/webhooks/email/route.ts`
  - request/duration headers in `app/api/inbox/conversations/route.ts` and `app/api/inbox/counts/route.ts`
  - statement-timeout guardrails in `actions/lead-actions.ts` and `lib/response-timing/processor.ts`
- Runtime bug fix applied:
  - patched `lib/response-timing/processor.ts` to clamp response-millisecond values before `Int` cast/write, preventing `22003 integer out of range` failures in `/api/cron/response-timing`.
- Coordination constraint maintained:
  - no new Inngest route migrations/events were added in Phase 168c (left to Phase 169)

## Expected Handoff
Deliver patch summary, observability artifact, and coordination notes to Phase 168d.

## Handoff
- Phase 168d should use the new artifacts as the pre-fix implementation proof set and run the matched-window live verification loop.
- Runtime note for 168d:
  - `INNGEST_SIGNING_KEY` is now present in Production and no longer a migration precondition blocker.
- Keep Phase 169 boundaries unchanged while collecting 168d verification packets.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Applied the requested Vercel variable set for Phase 168 + pre-provisioned Phase 169 flags.
  - Verified target code paths already contain inline hardening and observability needed for 168d.
  - Captured live cron probes, identified `/api/cron/response-timing` `500` (`integer out of range`), patched `lib/response-timing/processor.ts`, redeployed production, and confirmed endpoint recovery to `200`.
  - Generated fix summary, flag baseline, observability, and hotfix verification artifacts for handoff.
- Commands run:
  - `vercel whoami` — pass (`itsar-vr`).
  - `vercel env update <name> <environment> -y` / `vercel env add <name> <environment>` — pass for requested boolean/flag set.
  - `vercel env pull /tmp/... --environment preview` + `vercel env add INNGEST_SIGNING_KEY production` — pass (production signing key synced).
  - `vercel env ls {production,preview,development} --no-color | rg "<target vars>"` — pass (presence verified across target environments).
  - `rg`/`sed` inspection on webhook/inbox/response-timing files — pass (guards and headers verified).
  - `curl ... /api/cron/response-timing` (pre-fix) — pass with `500` and `22003 integer out of range` evidence.
  - `vercel --prod --yes --no-color` — pass (fresh production deploy with env + hotfix).
  - `curl ... /api/cron/response-timing` (post-fix) — pass with `200` response.
- Blockers:
  - Live packet verification remains operator-run in this environment.
- Next concrete steps:
  - Execute Phase 168d matched-window production verification using the new baseline artifacts.
  - Produce explicit verdict (`confirmed` / `partially confirmed` / `rejected`) and move to 168e closeout thresholds.
