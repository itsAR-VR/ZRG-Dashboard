# Phase 106a — Bug: 6 follow up emails sent

## Focus
Diagnose why the system sends an unexpected batch of follow-up emails (six) and define a fix that preserves idempotency and correct scheduling.

## Inputs
- Monday item: “6 follow up emails sent”
- Jam: https://jam.dev/c/1bdce0a8-ce7e-4a4b-9837-34321eaef8c1
- Follow-up cron: `app/api/cron/followups/route.ts`
- Follow-up engine: `lib/followup-engine.ts`, `lib/followup-automation.ts`

## Work
1. Reproduce using Jam details; identify the lead/thread and exact timestamps of sends.
2. Trace follow-up processing path in cron: ensure advisory lock + idempotency checks.
3. Audit `FollowUpInstance`/`FollowUpTask` creation and send gating (status transitions, lastSentAt).
4. Identify whether duplicate tasks are created (e.g., multiple triggers or backfill paths).
5. Define fix (dedupe, guardrails, or task selection constraints) and decide tests.

## Output
- Written fix plan including suspected root cause, candidate files, and a verification checklist.

## Handoff
Proceed to implement the dedupe/guardrail changes once plan is approved.
