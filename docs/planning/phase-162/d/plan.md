# Phase 162d — Auto-Send Safety: Phone-On-File + Call-Intent Policy + Revision Schema Fix

## Focus
Enforce the user-approved policy: when call intent is detected and the lead has a phone number on file, do not auto-send an outbound reply; notify only. Also fix the `auto_send_revise` structured output schema so revision loop requests stop failing with 400 schema errors.

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
- Enforce “no auto-reply on call intent + phone on file”:
  - In `executeAiAutoSendPath()`, short-circuit to `{ action: "skip" }` when `actionSignalCallRequested=true` and the lead has a stored phone.
  - Keep call-task creation sentiment-gated (`Call Requested` only) as requested.
- Fix revision-agent schema 400s:
  - Ensure the `auto_send_revise` JSON schema includes all keys in `required` (including `unresolved_requirements`, `memory_proposals`).
  - Ensure fallback system prompt and validator logic match the schema.
- Tests:
  - Orchestrator test: call intent + phone on file => skip auto-send.
  - Evaluator input test: lead phone on file is correctly reflected.
  - Revision agent test: schema strict mode passes (no missing required keys).

## Output
- Auto-send will not send redundant “which number should we call?” messages when a phone exists; Slack notifications handle the ops handoff.
- Revision loop no longer fails due to invalid json_schema.

## Handoff
- Proceed to 162e to ensure drafting prompt/context never asks for phone when it already exists and to add no-PII output guardrails.
