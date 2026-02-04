# Phase 105 — Duplicate Follow-Up Emails: Evidence + Robust Idempotency (Consolidated)

## Purpose
Capture the Jam link + evidence and formalize the robust idempotency/single-flight fix that prevents “extra follow-ups being sent per thread.”

## Context
- Original Jam link: `https://jam.dev/c/1bdce0a8-ce7e-4a4b-9837-34321eaef8c1`
- Jam MCP tools return `Auth required` in this environment; Jam evidence was captured via Playwright.
- Playwright snapshot at 0:23 shows the affected thread with duplicate follow-up content visible; Jam metadata timestamp: **February 3, 2026 at 3:18 PM EST** (artifact: `.codex-artifacts/jam-video-0m23s.png`).
- DB evidence (2026-02-03) showed burst outbound email `Message` rows within seconds and multiple `FollowUpTask` rows for the same `instanceId + stepOrder` (re-entrant processing).
- Root cause: follow-up email step was not idempotent, draft sending was not single-flight, and post-send failure handling could re-trigger sends.

## Concurrent Phases
Git status was **not** run per user request; uncommitted changes may exist. Based on recent phase plans, the following may overlap with email send/follow-up paths:

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 101 | Planning | `actions/email-actions.ts`, `lib/email-send.ts` | Ensure outcome-tracking changes align with single-flight + idempotent draft send flow. |
| Phase 103 | Complete | `lib/ai/prompt-runner/runner.ts` | Independent; avoid mixing prompt-runner changes with follow-up send fixes. |
| Phase 98 | Complete | `lib/followup-engine.ts`, follow-up cron | Ensure idempotency changes don’t conflict with booking-stop behavior. |
| Phase 104 | Planning | Workspace settings UI | Independent; avoid touching settings UI in this phase. |

## Objectives
* [x] Record Jam evidence and incident context (including link and snapshot)
* [x] Enforce idempotent follow-up email draft creation per `(instanceId, stepOrder)`
* [x] Enforce single-flight draft sending with atomic `pending -> sending` claim
* [x] Harden send failure semantics to avoid re-sends when outcome is uncertain
* [x] Update shared error typing so orchestrators compile cleanly
* [x] Validate with `npm test`, `npm run lint`, `npm run build`

## Constraints
- No Prisma schema changes.
- Prefer “at-most-once external send” semantics; duplicates are worse than a missed send.
- Jam MCP authentication may be unavailable; rely on Playwright + DB evidence if needed.

## Success Criteria
- [x] A single follow-up email step (same `instanceId + stepOrder`) cannot produce multiple provider sends.
- [x] Concurrent follow-up processing does not create duplicate approval/completion tasks for the same step.
- [x] If provider send likely succeeded but persistence fails, automation pauses instead of re-sending.
- [x] Jam link + evidence are captured in the phase record.
- [x] Quality gates pass (`npm test`, `npm run lint`, `npm run build`).

## Repo Reality Check (RED TEAM)

- What exists today:
  - Follow-up engine logic in `lib/followup-engine.ts` with `executeFollowUpStep`.
  - Email send entry points in `actions/email-actions.ts` (`sendEmailReply`) and `lib/email-send.ts` (`sendEmailReplySystem`, `sendEmailReplyForDraftSystem`).
  - Shared send typing in `actions/message-actions.ts` (`SendMessageResult`).
- What the plan assumes:
  - `AIDraft.triggerMessageId` can be reused as an idempotency key for follow-up steps.
  - Follow-up tasks can be deduped by `(leadId, instanceId, stepOrder, status)`.
  - Email send paths can be single-flighted via `pending -> sending` claims on `AIDraft`.
- Verified touch points:
  - `lib/followup-engine.ts` → `executeFollowUpStep`
  - `actions/email-actions.ts` → `sendEmailReply`
  - `lib/email-send.ts` → `sendEmailReplySystem`, `sendEmailReplyForDraftSystem`
  - `actions/message-actions.ts` → `SendMessageResult`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Prisma client types stale after schema changes → re-run `prisma generate` before `npm run build` (captured in Phase 105d).
- Provider send succeeded but DB write failed → treat as `send_outcome_unknown` and pause follow-up instance (implemented).

### Missing or ambiguous requirements
- None identified for Phase 105 scope.

### Performance / timeouts
- Follow-up cron is re-entrant; draft/task dedupe must be O(1) queries on indexed keys (use `triggerMessageId + channel` and `status` lookups).

### Security / permissions
- Follow-up cron still requires `CRON_SECRET` at the route level; no additional auth needed in engine.

### Testing / validation
- Quality gates required for combined working tree; warnings accepted but no new errors.

## Phase Summary

- Shipped:
  - Follow-up email steps now use deterministic draft keys and task dedupe, preventing duplicate follow-up drafts/tasks under re-entrant cron. (files: `lib/followup-engine.ts`)
  - Email draft sends enforce single-flight claims and safer failure semantics that avoid re-sends on uncertain outcomes. (files: `actions/email-actions.ts`, `lib/email-send.ts`)
  - Shared send error typing updated to include `draft_already_sending` + `send_outcome_unknown`. (files: `actions/message-actions.ts`, `lib/email-send.ts`)
- Verified:
  - `npm test`: pass
  - `npm run lint`: pass (warnings only)
  - `npm run build`: pass
- Notes:
  - Build initially failed due to stale Prisma types; rerunning after `prisma generate` resolved it.

## Phase Summary (running)
- 2026-02-04 — Captured validation results, added RED TEAM checks, and marked success criteria complete. (files: `docs/planning/phase-105/plan.md`, `docs/planning/phase-105/a/plan.md`, `docs/planning/phase-105/b/plan.md`, `docs/planning/phase-105/c/plan.md`, `docs/planning/phase-105/d/plan.md`)

## Subphase Index
* a — Evidence capture (Jam + DB)
* b — Follow-up idempotency implementation
* c — Single-flight send + safe failure semantics
* d — Validation + rollout/monitoring notes
