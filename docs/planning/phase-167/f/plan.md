# Phase 167f — Timeout Contract Verification (Vercel + Inngest + Prisma Runtime Semantics)

## Focus
Verify the effective timeout contracts for each failure class before any code/config changes.

## Inputs
- Phase 167e failure-class attribution matrix
- In-repo runtime configuration:
  - `vercel.json`
  - `app/api/webhooks/email/route.ts`
  - `app/api/inbox/conversations/route.ts`
  - `app/api/cron/response-timing/route.ts`
  - `app/api/cron/background-jobs/route.ts`
  - `lib/response-timing/processor.ts`
  - `lib/inngest/client.ts`
  - `lib/inngest/functions/process-background-jobs.ts`
  - `lib/inngest/functions/background-maintenance.ts`
- Current docs (Vercel + Inngest) for function duration/timeout behavior.

## Work
1. Confirm route-level duration controls and caps for deployed runtime.
2. Confirm Inngest function/invoke timeout semantics and whether they apply to each failing path.
3. Confirm internal timeout envelopes in code (transaction timeout, statement timeout, batch budget) and identify which ones currently trigger first.
4. Produce a per-path contract table:
   - configured timeout,
   - effective timeout owner,
   - cap/source,
   - required change,
   - fallback when cap is lower than desired behavior.
5. Convert the contract table into a file-level patch list with explicit before/after expectations.

## Validation (RED TEAM)
- Every failure path from Phase 167e has a contract row and mapped control point.
- No proposed change is a no-op (for example re-setting `maxDuration=800` where already present).
- Contract statements cite the exact file/function/env that enforces them.

## Output
Verified timeout contract + concrete patch list:

| Path | Pre-change owner | Contract finding | Change |
|---|---|---|---|
| `/api/webhooks/email` | Route `maxDuration=60` | Route-level runtime ceiling was explicitly lower than desired target and matched timeout signature. | Set `maxDuration=800` in `app/api/webhooks/email/route.ts`. |
| `/api/inbox/conversations` | No explicit route max in file (runtime observed 300s timeout) + interactive transaction waits in action path | Route-level headroom and DB transaction envelope both matter for heavy list scans. | Add `maxDuration=800` in route + raise interactive tx `timeout/maxWait` in `actions/lead-actions.ts`. |
| `/api/inbox/counts` | No explicit route max in file (runtime observed 300s timeout) | Counts route also benefits from explicit long-runtime config parity. | Add `maxDuration=800` in `app/api/inbox/counts/route.ts`. |
| `/api/cron/response-timing` | Route already `maxDuration=800`, but processor tx default still near 5000ms | Effective owner was Prisma interactive transaction timeout, not route max duration. | Add transaction `timeout/maxWait` controls in `lib/response-timing/processor.ts`. |
| `/api/cron/emailbison/availability-slot` | Route `maxDuration=60` | Route-level cap unnecessarily low for burst windows. | Set `maxDuration=800`. |
| `/api/cron/availability` | Route `maxDuration=60` + budget clamp effectively ~55s | Route-level cap and budget clamp constrained longer refresh windows. | Set `maxDuration=800` and raise configurable budget cap to 10m in route clamp logic. |
| `/api/inngest` | Already `maxDuration=800` | No incident evidence in export that this path is primary timeout source. | No change (no-op avoided). |

Doc/runtime verification notes:
- Context7 Vercel docs confirm App Router route-level `maxDuration` export is the supported control surface for function duration.
- Inngest path in this export had no direct timeout evidence (`/api/inngest` absent), so no Inngest runtime changes were required in this patch.

## Handoff
Pass the file-level patch list + acceptance checks to Phase 167g for surgical implementation.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Verified per-endpoint timeout owner and eliminated no-op assumptions.
  - Confirmed that DB interactive transaction timeout was the first failing envelope in response-timing/inbox paths.
  - Confirmed Inngest route already had `maxDuration=800` and was not evidenced as primary.
- Commands run:
  - `rg -n "maxDuration|timeout|transaction" app lib actions vercel.json` — pass (control points mapped).
  - `sed -n '1,260p' app/api/webhooks/email/route.ts` and related route files — pass (pre-change runtime contracts read).
  - `mcp__context7__resolve-library-id` + `mcp__context7__query-docs` for Vercel duration config — pass (contract source verified).
- Blockers:
  - None for contract mapping.
- Next concrete steps:
  - Implement exact patch list without touching unrelated auth/idempotency logic (Phase 167g).
