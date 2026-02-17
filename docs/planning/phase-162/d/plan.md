# Phase 162d — Auto-Send Safety: Phone-On-File + Call-Intent Policy + Revision Schema Fix

## Focus
Enforce the user-approved policy: when call intent is detected, do not auto-send an outbound reply; notify only (regardless of whether a phone number is on file) and apply this globally across workspaces. Also fix the `auto_send_revise` structured output schema so revision loop requests stop failing with 400 schema errors.

## Inputs
- `docs/planning/phase-162/c/plan.md` (action-signal outputs)
- Code:
  - `lib/auto-send/orchestrator.ts`
  - `lib/auto-send/types.ts`
  - `lib/auto-send-evaluator.ts`
  - `lib/auto-send-evaluator-input.ts`
  - `lib/auto-send/revision-agent.ts`
  - Inbound pipelines that call `executeAutoSend()`:
    - `lib/inbound-post-process/pipeline.ts`
    - `lib/background-jobs/email-inbound-post-process.ts`
    - `lib/background-jobs/sms-inbound-post-process.ts`

## Work
- Ensure evaluator has correct “phone on file” context:
  - Load `Lead.phone` in `loadAutoSendWorkspaceContext()` and propagate `lead_phone_on_file` into evaluator input.
  - Pass action-signal booleans + a compact route summary into `evaluateAutoSend()` so the judge understands call intent vs scheduling intent.
- Enforce “no auto-reply on call intent”:
  - In `executeAutoSend()`, short-circuit to `{ action: "skip" }` when `actionSignalCallRequested=true` (phone on file or missing).
  - Keep call-task creation sentiment-gated (`Call Requested` only) as requested.
- If call intent is detected but phone is missing:
  - Trigger phone enrichment (best-effort) via the existing Clay enrichment stream so ops can call without asking for a number in the reply.
  - Apply call-intent-only dedupe: do not retrigger Clay for the same lead/channel inside 24 hours.
- Fix revision-agent schema 400s:
  - Ensure the `auto_send_revise` JSON schema includes all keys in `required` (including `unresolved_requirements`, `memory_proposals`).
  - Ensure fallback system prompt and validator logic match the schema.
- Tests:
  - Orchestrator test: call intent + phone on file => skip auto-send.
  - Orchestrator test: call intent + phone missing => skip auto-send.
  - Evaluator input test: lead phone on file is correctly reflected.
  - Revision agent test: schema strict mode passes (no missing required keys).

## Output
- Auto-send will not send redundant “which number should we call?” messages when a phone exists; Slack notifications handle the ops handoff.
- When call intent is detected and phone is missing, inbound pipelines will suppress AI draft generation (notify-only policy) and trigger enrichment instead.
- Revision loop no longer fails due to invalid json_schema.

## Handoff
- Proceed to 162e to ensure drafting prompt/context never asks for phone when it already exists and to add no-PII output guardrails.
