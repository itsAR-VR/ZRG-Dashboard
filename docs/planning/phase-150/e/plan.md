# Phase 150e — Validation, Canary, and Rollout Decision

## Focus
Prove the fixes work end-to-end for Tim first, then promote globally with explicit evidence and rollback readiness.

## Inputs
- Completed outputs from 150a–150d
- Tim canary workspace (`clientId = 779e97c3-e7bd-4c1a-9c46-fe54310ae71f`)

## Work
1. Run required quality gates:
   - `npm run lint`
   - `npm run build`
   - `npm test`
2. Run mandatory AI/message validation gates:
   - `npm run test:ai-drafts`
   - `npm run test:ai-replay -- --client-id 779e97c3-e7bd-4c1a-9c46-fe54310ae71f --dry-run --limit 20`
   - `npm run test:ai-replay -- --client-id 779e97c3-e7bd-4c1a-9c46-fe54310ae71f --limit 20 --concurrency 3`
3. Execute Tim canary verification:
   - confirm blocked LinkedIn/SMS instances are now advancing or sending correctly
   - verify no new stall loops are introduced
   - verify SMS UI failure notice clears on successful send
4. Rollout decision:
   - if canary passes thresholds from 150d, deploy globally with default-on behavior
   - keep rollback/backup window at 7 days and record rollback trigger criteria

## Output
- Go/no-go release note with command results, canary evidence, known residual risks, and rollback instructions.

## Handoff
If go, move to implementation/review execution loop. If no-go, open a follow-on phase with exact failing cases and narrowed remediation scope.
