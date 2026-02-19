# Phase 174a — AI Timing Extraction Contract + Prompt + Normalization

## Focus
Replace deterministic quarter/date scheduling logic for this feature path with a dedicated AI extractor contract that returns follow-up timing in local-time semantics, ready for downstream scheduling.

## Inputs
- Root scope and decision locks: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-174/plan.md`
- Existing timing/timezone references:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/snooze-detection.ts`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/timezone-inference.ts`
- Existing structured AI extraction patterns:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/followup-engine.ts`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/timezone-inference.ts`

## Work
1. Add a dedicated extractor module (planned: `lib/followup-timing-extractor.ts`) with strict output shape:
   - `isValid`, `localDate`, `localTime`, `timezone`, `rationale`, `normalizedText`.
2. Implement extractor prompt contract for defer scheduling intent:
   - fixed model `gpt-5-mini`,
   - prompt key namespace (planned: `followup.extract_timing.v1`),
   - strict schema validation (invalid shape => extractor miss).
3. Normalize extractor output:
   - require concrete date to be considered valid,
   - if time missing, default to `09:00` local,
   - keep timezone optional at this stage (resolved downstream using fallback chain).
4. Ensure this new extractor path does not modify legacy deterministic parser behavior used elsewhere.

## Validation
- Unit tests cover valid extraction, malformed output rejection, and ambiguous-message fail-closed behavior.
- Contract tests prove model output must match strict schema before scheduling can proceed.
- Legacy parser behavior remains unchanged for non-phase-174 scheduling surfaces.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/followup-timing-extractor.ts` with strict structured-output validation and fail-closed behavior.
  - Locked extractor runtime contract to `featureId=followup.extract_timing`, `promptKey=followup.extract_timing.v1`, and model `gpt-5-mini`.
  - Added normalization for `localDate` (`YYYY-MM-DD`), `localTime` (`HH:MM`), and optional timezone/rationale fields.
- Commands run:
  - `npm run build` — pass.
  - `npm run lint` — pass (warnings only).
- Blockers:
  - None.
- Next concrete steps:
  - Use validated extractor output to drive lead snooze + scheduled follow-up upsert across inbound paths.

## Output
- Shipped: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/followup-timing-extractor.ts`.
- Extraction is strict-schema and fail-closed; malformed/missing concrete date output cannot schedule tasks.

## Handoff
Proceed to **174b** to convert validated extractor output into snooze/task upsert behavior across inbound processing flows.
