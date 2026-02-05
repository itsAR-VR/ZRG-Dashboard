# Phase 106g — Bug: AI Bad Response For Meeting Request

## Focus
Improve AI responses to meeting requests so they align with booking workflow expectations and do not produce incorrect or off-tone replies.

## Inputs
- Monday item: “AI Bad Response For Meeting Request”
- Jam: https://jam.dev/c/479a2962-1f36-47b6-915d-b620395e0671
- Draft generation: `lib/ai-drafts.ts`, `lib/ai/prompt-registry.ts`
- Sentiment/intent: `lib/sentiment.ts`, `lib/snooze-detection.ts`

## Work
1. Reproduce the bad response via Jam and classify the intent (meeting request vs general inquiry).
2. Review prompt instructions around meeting requests and booking link inclusion.
3. Check verifier/guardrails to see why the response passed.
4. Define prompt/verification improvements and any additional intent checks.
5. Plan regression tests using a meeting-request fixture.

## Output
- Fix plan with prompt changes, guardrail additions, and validation steps.

## Handoff
Proceed to implementation and verify by re-running the Jam flow.
