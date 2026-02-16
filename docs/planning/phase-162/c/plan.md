# Phase 162c — Action-Signal: Process 4 Routing + Slack Notify Reliability

## Focus
Make “call me at the number below/in my signature” reliably route to Booking Process 4 and ensure Slack notifications fire even when the signal is derived from the AI router (not from heuristics).

## Inputs
- `docs/planning/phase-162/a/plan.md` evidence
- Code:
  - `lib/action-signal-detector.ts` (heuristics + AI router + notify)
  - `lib/email-cleaning.ts` (signature stripping)
  - Tests: `lib/__tests__/action-signal-detector.test.ts`

## Work
- Improve call-intent detection while keeping “LLM-first” intent:
  - Expand call keyword heuristics to include signature-style phrases (e.g., “direct contact number below”).
  - Adjust AI router payload so boolean “has call signal/external calendar signal” lines are only included when true (avoid anchoring the model on false).
  - Update router system instructions to treat “reach me at my number below/in my signature” as Process 4.
- Ensure Slack notify is driven by structured outcomes:
  - If AI router chooses `processId=4` but no `call_requested` signal exists, synthesize a `call_requested` signal from the router decision (confidence mapping based on route confidence).
  - Keep `notifyActionSignals()` behavior unchanged, but ensure it sees `signals.length > 0` in these cases.
- Add regression tests:
  - Stripped text contains “direct contact number below”, full text includes phone, sentiment is positive: expect route `processId=4` and `signals` includes `call_requested`.
- (Optional) Add lightweight telemetry evidence in logs/AIInteraction metadata for route outcomes.

## Output
- Action-signal detector emits actionable `signals` for Process 4 and Slack notify fires (deduped) in the real pipeline.

## Handoff
- Proceed to 162d to enforce “no auto-reply” for call-intent + phone-on-file and to fix revision-agent schema 400s.
