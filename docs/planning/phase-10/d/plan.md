# Phase 10d — Validate with Examples + Monitor Impact

## Focus
Confirm the prompt edits reduce the “not ready → unqualified” failure mode and improve downstream booking outcomes.

## Inputs
- Updated prompt text from Phase 10b
- Updated reply strategy from Phase 10c
- Phase 10a example set (regression cases)
- AI Observability views + CRM outcomes for affected leads

## Work
1. Sanity-check prompt + schema wiring:
   - `Follow Up` exists as an allowed classification in sentiment + email inbox analysis.
   - Email webhook mapping supports `Follow Up`.
2. Validate build/lint to ensure changes are deploy-safe.
3. Provide a lightweight monitoring checklist for the team (AI observability + CRM outcomes).

## Output
- **Regression set:** `docs/planning/phase-10/examples.md`
- **Wiring validated (compile/build):**
  - `Follow Up` is now supported in email inbox analyze end-to-end (prompt + schema + mapping): `lib/ai/prompt-registry.ts`, `lib/sentiment.ts`, `app/api/webhooks/email/route.ts`
  - Draft generation runs for `Follow Up` and avoids auto-offering availability: `lib/ai-drafts.ts`
- **Local checks:** `npm run lint` (warnings only) + `npm run build` succeeded
- **Monitoring checklist (24–72h):**
  - In AI Observability, spot-check samples containing “not ready”, “not right now”, “next year”, “couple years” → should classify as `Follow Up`
  - Confirm `Follow Up` drafts ask for timing + permission to check back (no meeting-time push)
  - Confirm “not looking to sell / don’t want to sell” stays a hard decline path (and is not being treated as `Follow Up`)
  - Track whether fewer leads are manually moved to `unqualified` for timing-only deferrals

## Handoff
Proceed to Phase wrap-up: check off root success criteria, summarize changes, and keep `docs/planning/phase-10/examples.md` as a lightweight regression suite for future prompt tweaks.
