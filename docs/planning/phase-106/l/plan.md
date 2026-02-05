# Phase 106l — Implementation: Draft Gate (Overseer Review) + Post‑Yes Concision

## Focus
Insert an overseer “gate” after draft generation to enforce scheduling logic and concise post‑acceptance replies.

## Inputs
- Draft generation: `lib/ai-drafts.ts`
- Prompt registry: `lib/ai/prompt-registry.ts`
- Overseer logic: `lib/meeting-overseer.ts`

## Work
1. Add a meeting gate prompt (`meeting.overseer.gate.v1`) with strict JSON schema.
2. Apply gate for scheduling‑related inbounds; override/shorten drafts after acceptance.
3. Reuse Step‑3 verifier model selection for gate model selection.
4. Persist gate decisions per message (stage = `gate`).

## Output
- Drafts for accepted meetings are concise, and no longer over‑explain or ask new questions.

## Handoff
Proceed to blank‑slot guard + tests (Phase 106m).
