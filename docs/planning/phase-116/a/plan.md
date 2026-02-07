# Phase 116a — Acceptance Tests + Launch Checklist

## Focus
Make Phase 116 decision-complete by defining concrete acceptance tests, smoke steps, and rollback/monitoring criteria for the auto-send revision feature (and any adjacent launch blockers surfaced during audit).

## Inputs
- `docs/planning/phase-115/plan.md`
- `docs/planning/phase-115/review.md`
- `lib/auto-send/orchestrator.ts` (revision trigger)
- `lib/auto-send/revision-agent.ts` (revision pipeline + DB writes)
- `prisma/schema.prisma` (`AIDraft` model)
- `components/dashboard/admin-dashboard-tab.tsx` (admin health snapshot display)

## Work
1. Pre-flight conflict check
   - `git status --porcelain` must be clean (or explicitly understand/coordinate any changes).
   - Scan last 10 phases for file overlap with: `prisma/schema.prisma`, `lib/auto-send/*`, `actions/admin-dashboard-actions.ts`.

2. Lock acceptance tests (must pass before launch)
   - Revision triggers only when:
     - `(evaluation.source ?? "model") !== "hard_block"`
     - `typeof evaluation.confidence === "number"`
     - `evaluation.confidence < threshold`
     - revision kill-switch is not enabled (`AUTO_SEND_REVISION_DISABLED !== "1"`)
     - workspace rollout is enabled (`WorkspaceSettings.autoSendRevisionEnabled === true`)
   - Revision does not run more than once per `draftId` even on retries.
   - Revised draft is persisted only when the re-eval confidence improved (existing behavior).
   - Revision tracking fields persist:
     - attempted-at timestamp
     - original confidence
     - revised confidence (even if not applied)
     - applied boolean and selectorUsed boolean

3. Lock smoke checklist (local + deploy)
   - Local: `npm test`, `npm run lint`, `npm run build`, `npm run typecheck`
   - DB schema: columns exist after `npm run db:push`
   - Runtime: with `AUTO_SEND_REVISION_DISABLED=1`, evaluator still runs and nothing attempts revision.
   - Runtime: with revision enabled globally (kill-switch off) but workspace toggle OFF, low-confidence cases do NOT attempt revision.
   - Runtime: with workspace toggle ON, low-confidence cases attempt revision once and then settle to send/review.

4. Rollback levers (explicit)
   - First-line rollback: set `AUTO_SEND_REVISION_DISABLED=1` (revision off).
   - If needed: set `AUTO_SEND_DISABLED=1` (auto-send off globally).

## Output
- A single checklist referenced by Phase 116e (smoke + rollout + rollback + monitoring).

## Handoff
- Phase 116b implements schema exactly as specified and verifies DB columns exist.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Executed the Phase 116 quality gates and schema sync to validate launch readiness. (tests/lint/build/typecheck/db push)
- Commands run:
  - `npm run typecheck` — pass
  - `npm test` — pass
  - `npm run lint` — pass (warnings only, pre-existing)
  - `npm run build` — pass
  - `npm run db:push` — pass
- Blockers:
  - Canary rollout not executed in production yet (manual operator step).
- Next concrete steps:
  - Follow Phase 116e canary checklist in prod and confirm attempted/applied metrics populate as expected.
