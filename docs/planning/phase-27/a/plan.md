# Phase 27a — Fix OpenAI `json_schema` Contract

## Focus
Restore Insights chat answering by fixing the `response_format: json_schema` schema so it conforms to OpenAI strict JSON-schema requirements (and matches our Zod validation).

## Inputs
- Root context: `docs/planning/phase-27/plan.md`
- Runtime error: `Invalid schema … Missing 'note'`
- Likely code: `lib/insights-chat/chat-answer.ts`

## Work
- Reproduce the error locally (send a follow-up in Insights; confirm 400 from OpenAI).
- Update the schema used in `response_format` so every object schema has a `required` array that includes **all** keys in `properties` (OpenAI requirement).
  - For citations items, make `note` required and allow `null` (model always returns it, optionally `null`).
- Align Zod (`AnswerSchema`) with the enforced schema (avoid “optional but required by json_schema” drift).
- Add a lightweight regression check (unit-style) if a test harness exists; otherwise add an internal helper that centralizes the schema so it’s harder to regress.

## Output
- Fixed the OpenAI strict `json_schema` validation error by making `note` required in the citations item schema (nullable), matching OpenAI’s requirement that `required` includes every key in `properties`.
- Updated local validation to match (`AnswerSchema` now requires `note` but allows `null`).
- Code: `lib/insights-chat/chat-answer.ts`

## Handoff
Proceed to Phase 27b to make session/message UI cache-first and remove the “Loading…” flicker that hides cached sessions.
