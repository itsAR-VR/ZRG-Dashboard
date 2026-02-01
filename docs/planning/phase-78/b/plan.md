# Phase 78b — Implement DB schema compatibility utility + core route gating

## Focus

Prevent noisy Prisma P2022 failures during schema drift windows by adding explicit schema checks and returning retryable 503s on core routes.

## Inputs

- Phase 78a error→path mapping + required columns list
- Existing partial P2022 handling in:
  - `lib/webhook-events/runner.ts`
  - `actions/lead-actions.ts`

## Work

- Add `lib/db-schema-compat.ts` with:
  - detection helpers for Prisma P2021/P2022
  - `getMissingColumns()` implemented via `information_schema.columns`
  - `ensureDbCompatibleOr503()` returning `NextResponse` (503) when missing columns are detected
- Integrate into:
  - `app/api/cron/followups/route.ts` (GET/POST)
  - `app/api/webhooks/email/route.ts`
- Policy:
  - **Core drift:** return 503 + `{ missing: [...] }`
  - **Non-drift errors:** preserve existing behavior but avoid “all-or-nothing” execution in cron (collect errors and continue where safe)

## Output

- Core endpoints never surface raw P2022 stack traces; instead return structured 503 with missing schema info.

## Handoff

Phase 78c uses the same “never throw out of handler” pattern to harden non-critical cron routes.

