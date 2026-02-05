# Phase 106c — Bug: Missing AI responses

## Focus
Investigate missing AI responses for inbound messages and define a fix that restores draft generation/auto-send behavior.

## Inputs
- Monday item: “Missing AI responses”
- Jam: https://jam.dev/c/678ee571-e8e8-458b-a9af-c815a1e37dfc
- AI pipeline: `lib/ai-drafts.ts`, `lib/ai/prompt-registry.ts`, `lib/auto-reply-gate.ts`
- Ingestion: `app/api/webhooks/email/route.ts`, `app/api/webhooks/ghl/sms/route.ts`

## Work
1. Reproduce via Jam and identify the lead/thread and channel.
2. Check whether an `AIDraft` was created and why it might be blocked (gate or failure).
3. Inspect `AIInteraction` telemetry for timeouts/errors and compare to prompt runner.
4. Trace the decision path for auto-send vs draft-only, including campaign mode.
5. Define fix (gate criteria, retry behavior, or pipeline errors) and validation steps.

## Output
- Written fix plan including root-cause hypothesis, target files, and test plan.

## Handoff
Implement the fix after confirmation; validate via Jam repro and log checks.
