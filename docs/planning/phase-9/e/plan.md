# Phase 9e — Switch AI Draft Creation to gpt-5-mini (High Reasoning) + Wire in Knowledge Context

## Focus
Move AI draft generation to **gpt-5-mini (high reasoning)** and incorporate Knowledge Asset outputs (file extractions + website summaries) so outbound drafts reflect the target company accurately.

## Inputs
- Draft generation logic: `lib/ai-drafts.ts` (and any related AI utilities)
- Knowledge Assets retrieval APIs/queries (from Phase 9c/9d)
- Existing safety gates (auto-reply gate, opt-out rules, channel constraints)

## Work
1. Update the model used for AI draft creation:
   - Set to `gpt-5-mini` with **high reasoning**.
2. Expand the draft prompt context:
   - Include structured company summary + key facts (Phase 9d).
   - Include file-derived facts (Phase 9c) with citations/attribution fields when possible.
3. Prompt + output format:
   - Ensure deterministic output schema for drafts (subject/body, channel variants, call-to-action).
   - Keep safety constraints explicit (no claims not supported by knowledge; no sensitive data).
4. Regression checks:
   - Generate drafts for a lead with/without knowledge assets; verify quality increases and no formatting regressions.
5. Run `npm run lint` and `npm run build`.

## Output
### Implemented
- AI draft generation now uses `gpt-5-mini` with **high** reasoning effort:
  - `lib/ai-drafts.ts`
- Knowledge context wiring already consumes Knowledge Assets’ `textContent`, so the new file + website ingestion summaries are available to drafts without additional changes.

### Validation Notes
- `npm run lint` / `npm run build` executed at end of Phase 9 (see root wrap-up).

## Handoff
Phase wrap-up: verify end-to-end (status dropdown, calendar links, knowledge uploads, website scrape) and run lint/build.
 
