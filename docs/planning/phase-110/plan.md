# Phase 110 — Verify Draft Outcome Fixes + Stabilize Analytics Windowing

## Purpose
Verify whether the reported disposition/sending/analytics issues are already fixed in the repo, de-dupe against existing phase plans, and plan the remaining work to make AI draft outcome analytics windowing stable and correct.

## Context
User-provided findings to verify:
1. **Missing `AIDraft.responseDisposition` on idempotent send paths** (analytics undercount + inconsistent audit trail).
2. **`send_outcome_unknown` leaves drafts stuck in `sending`** with no reconciliation path.
3. **Outcome analytics windows use `AIDraft.updatedAt`**, which can drift after disposition is set.
4. Monday backlog items (IDs: `11174440376`, `11183404766`, `11185162432`, `11188016134`, `11195846714`, feature requests `11157946059`, `11177342525`).

### Repo Reality Check (Verified)
Status snapshot based on current filesystem + code:

| Finding | Status | Evidence (Code) | Evidence (Plans/Tests) |
| --- | --- | --- | --- |
| (1) Disposition missing on idempotent paths (email/sms) | **Mostly fixed; residual gap in follow-up engine** | Email idempotent paths compute/persist disposition: `actions/email-actions.ts` + `lib/email-send.ts`. SMS approvals always persist disposition: `actions/message-actions.ts`. **Follow-up email path still marks drafts `approved` without disposition**: `lib/followup-engine.ts` (sending + message exists branch). | Phase 106s claims fix + adds static regression tests: `docs/planning/phase-106/s/plan.md`, `lib/__tests__/response-disposition-idempotent.test.ts`. Follow-up engine gap is not covered by those tests. |
| (2) `send_outcome_unknown` drafts stuck in `sending` | **Fixed** | Server/system email send set draft to `approved` on `send_outcome_unknown`: `actions/email-actions.ts`, `lib/email-send.ts`. Stale `sending` drafts reconciled in cron: `app/api/cron/background-jobs/route.ts` → `lib/ai-drafts/stale-sending-recovery.ts`. | Phase 105 + 106t: `docs/planning/phase-105/*`, `docs/planning/phase-106/t/plan.md`. Static tests: `lib/__tests__/send-outcome-unknown-recovery.test.ts`, `lib/__tests__/stale-sending-recovery.test.ts`. |
| (3) Analytics window uses `AIDraft.updatedAt` | **Still open** | `actions/ai-draft-response-analytics-actions.ts` filters `d."updatedAt"` for window. | Phase 101c includes that query shape in the plan; no later phase replaces it. |
| (4) Monday backlog items | **Covered by prior phases; confirm any remaining live-only verification** | Website + booking/overseer/blank-slot fixes are in code (Phase 106). Edited vs auto-sent vs approved analytics feature implemented (Phase 101). | Phase 106 is the canonical backlog plan; Phase 101 implements item `11177342525`. |

## Concurrent Phases
Recent phases (last 10 by mtime) include work in overlapping domains.

| Phase | Status | Overlap | Coordination |
| --- | --- | --- | --- |
| Phase 109 | **Untracked / likely active** | AI draft generation + webhook/cron hardening (`lib/ai-drafts.ts`, webhook routes) | Avoid overlapping edits unless explicitly required; re-read files before touching. |
| Phase 108 | Shipped | Insights/reporting + schema changes | Analytics changes here should avoid reworking the message-performance pipeline. |
| Phase 107 | Shipped (live verification pending) | `lib/email-send.ts` + evaluator context | If we touch email send paths, ensure we don’t regress reply payload changes. |
| Phase 106 | Shipped | Disposition idempotency + send recovery + overseer/booking | Treat as source-of-truth for prior fixes; only patch uncovered gaps. |
| Phase 105 | Shipped | Email single-flight/idempotency + `send_outcome_unknown` typing | Reuse patterns; don’t reintroduce duplicate sends. |
| Phase 101 | Shipped | `AIDraft.responseDisposition` + outcome analytics action | We’ll likely update `actions/ai-draft-response-analytics-actions.ts`. |

## Objectives
* [ ] Produce a de-duped status map for each reported issue (fixed vs partially fixed vs open)
* [ ] Close the residual `responseDisposition` gap in follow-up idempotent paths (if confirmed necessary)
* [ ] Replace analytics windowing logic so it is stable (no `updatedAt` drift) and aligns with actual send time
* [ ] Add regression coverage for the analytics windowing logic
* [ ] Run repo quality gates relevant to any changes (`npm test`, `npm run lint`, `npm run build`; `npm run db:push` only if schema changes)

## Constraints
- Keep behavior multi-tenant safe and workspace-scoped.
- Avoid schema changes unless required for correctness and long-term stability.
- Do not log PII in actions/cron.
- Follow AGENTS.md: validate secrets before reading bodies; keep actions returning `{ success, data?, error? }`.

## Success Criteria
1. We can point to concrete evidence for each finding:
   - Fixed (code + test + phase reference), or
   - Still open (exact file/line + proposed fix).
2. Outcome analytics windowing no longer depends on `AIDraft.updatedAt`; it uses a stable send-time anchor (e.g., derived from `Message.sentAt` per draft).
3. Follow-up “draft already sent” idempotent paths persist `responseDisposition` (if the gap is confirmed reachable).
4. Added regression coverage that would fail if analytics reverts to `updatedAt` filtering.
5. Quality gates pass for the touched surface area.

## Subphase Index
* a — Audit & de-dupe: map findings → code + phase plans, identify remaining gaps
* b — Close remaining disposition gaps (follow-up idempotency + any approved-but-null disposition states)
* c — Stabilize analytics windowing (replace `updatedAt` filter with stable send-time anchor)
* d — Regression coverage + validation checklist (tests/lint/build; db push if needed)

