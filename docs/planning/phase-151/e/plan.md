# Phase 151e — Validation (NTTAN) + Canary Checklist + Rollout/Monitoring Runbook

## Focus
Prove the changes are correct and safe through mandatory validation gates and a Tim-first canary, then roll out globally with clear monitoring and rollback instructions.

## Inputs
- Completed outputs from 151a–151d
- Tim canary workspace:
  - `clientId = 779e97c3-e7bd-4c1a-9c46-fe54310ae71f`

## Work
1. **Local quality gates**
   - `npm run lint`
   - `npm run build`
   - `npm test`

2. **Mandatory AI/message validation (NTTAN)**
   - `npm run test:ai-drafts`
   - `npm run test:ai-replay -- --client-id 779e97c3-e7bd-4c1a-9c46-fe54310ae71f --dry-run --limit 20`
   - `npm run test:ai-replay -- --client-id 779e97c3-e7bd-4c1a-9c46-fe54310ae71f --limit 20 --concurrency 3`

   Preflight requirement:
   - Ensure DB connectivity from the runner environment (`DATABASE_URL`/`DIRECT_URL` correct and reachable).
   - If replay infra fails, capture the infra error artifacts and resolve connectivity before shipping.

3. **Tim canary checklist (24 hours)**
   - Post-migration: confirm columns exist and app deploy is using the migrated DB.
   - After Tim-only backfill:
     - `0` leads with `/company/…` in `Lead.linkedinUrl` for Tim.
   - LinkedIn follow-ups:
     - company-only leads skip-and-advance; Clay LinkedIn enrichment triggers without stalling.
   - Manual LinkedIn send:
     - profile leads can send; company-only leads show clear error.
   - SMS:
     - banner appears on send blockers with reason + consecutive count.
     - banner clears after a successful send.

4. **Global rollout**
   - Run global LinkedIn backfill after canary passes.
   - Monitor error rates and blocked counters.

5. **Monitoring queries (runbook)**
   - Global: company URLs still in `linkedinUrl`:
     - `SELECT count(*) FROM "Lead" WHERE "linkedinUrl" ILIKE '%/company/%';`
   - Tim: same query with `clientId` filter.
   - SMS blocked leads:
     - `SELECT count(*) FROM "Lead" WHERE "smsLastBlockedAt" IS NOT NULL AND ("smsLastSuccessAt" IS NULL OR "smsLastBlockedAt" > "smsLastSuccessAt");`

6. **Rollback**
   - LinkedIn backfill rollback within 7 days:
     - restore `Lead.linkedinUrl` from `_phase151_linkedin_backfill_backup` for affected rows.
   - Keep backup table for 7 days, then drop if no rollback required.

## Output
- Validation logs/artifacts recorded (lint/build/test/ai-drafts/ai-replay).
- Tim canary results documented; go/no-go recorded.
- Global rollout completed or explicitly blocked with a concrete infra/root-cause report.

### Execution status (2026-02-16)
- `npm run lint`: pass (warnings only, no failures).
- `npm run build`: pass.
- `npm test`: pass (`387` tests, `77` suites, `0` failed).
- `npm run test:ai-drafts`: pass (`68` tests, `3` suites, `0` failed).
- `npm run test:ai-replay -- --client-id 779e97c3-e7bd-4c1a-9c46-fe54310ae71f --dry-run --limit 20`: pass (`evaluated=0`, `failed=0`).
- `npm run test:ai-replay -- --client-id 779e97c3-e7bd-4c1a-9c46-fe54310ae71f --limit 20 --concurrency 3`: pass (`evaluated=16`, `passed=14`, `failedJudge=2`, `failed=0`).
- Tim 24-hour canary monitoring and linked global rollout checklist still pending.

## Handoff
If go: proceed to implementation execution loop. If no-go: create a follow-on phase with the failing cases and narrowed remediation scope.
