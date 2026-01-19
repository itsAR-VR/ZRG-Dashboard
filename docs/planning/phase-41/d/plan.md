# Phase 41d — Tests + Verification Runbook (Jam-Aligned)

## Focus
Add minimal regression coverage for the sync flow and provide a repeatable verification checklist that mirrors what the user did in Jam.

## Inputs
- Implemented changes from Phase 41a–41c
- Existing test/build/lint conventions in the repo

## Work
- This repo does not currently have a dedicated unit/integration test runner configured in `package.json`, so regression coverage is provided via build-time checks (`lint` + `build`) plus a Jam-aligned manual verification checklist.
- Run and record:
  - `npm run lint`
  - `npm run build`
- Write a short manual verification checklist:
  - Settings → Integrations → Sync Email succeeds (valid key)
  - Invalid key produces clear error (includes 401/403)
  - Booking/campaign views show the full campaign set after sync

## Output
- Verification runbook (Jam-aligned):
  1. Open **Settings → Integrations** for a workspace configured with EmailBison.
  2. Click **Sync Email**.
     - Expected (success): toast like “Synced N email campaigns…”.
     - Expected (auth fail): toast includes `EmailBison authentication failed (401)` or `(403)` and instructs to update API key / confirm base URL.
  3. Open a campaign-driven view (e.g. **Settings → Booking → Booking Process Analytics** or **Follow-ups → Reactivations**).
     - Expected: campaigns are selectable/visible; empty states include the “Sync Email” guidance when none are present.
  4. If auth keeps failing but the key is known-good, set `EMAILBISON_BASE_URL` (default is `https://send.meetinboxxia.com`) to the correct EmailBison host for that key and retry.

- Completed checks:
  - `npm run lint` (passes; repo has pre-existing warnings)
  - `npm run build` (passes)

## Handoff
Phase 41 complete; update the root phase plan with checked success criteria and a brief phase summary.

## Review Notes

- Evidence: `docs/planning/phase-41/review.md`
- Status: Phase 41 is partially complete pending manual success-path verification (valid credentials) and confirming `EMAILBISON_BASE_URL` is correct for prod.
