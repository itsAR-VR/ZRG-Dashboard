# Phase 41a — Reproduce + Add Safe Diagnostics for Sync Email

## Focus
Turn the Jam symptom (“Sync Email → 401 Unknown error”) into a reproducible, diagnosable failure with safe logs and clear failure classification.

## Inputs
- Jam: `914c06b0-c672-4658-bf3b-e5f20567c426` (Settings → Integrations → Sync Email → 401 toast)
- Current code:
  - `components/dashboard/settings/integrations-manager.tsx`
  - `actions/email-campaign-actions.ts`
  - `lib/emailbison-api.ts`

## Work
- Add/standardize logging around email campaign sync attempts:
  - provider (`EMAILBISON|SMARTLEAD|INSTANTLY`)
  - workspace/client id (safe)
  - upstream HTTP status code (safe)
  - upstream error payload (redacted / size-limited / best-effort JSON)
- Ensure server action returns an error string that preserves the status code and a human-readable cause for common auth failures (401/403).
- Confirm UI toast shows the returned server-action error verbatim (no lossy “Unknown error” fallback).

## Output
- Implemented safe diagnostics and clearer failure mapping for “Sync Email”:
  - `lib/emailbison-api.ts`: campaign fetch now logs `{ status, baseUrl, error }` (no secrets) and maps `401/403` to an actionable message that includes the status code; upstream text bodies are truncated before logging.
  - `actions/email-campaign-actions.ts`: EmailBison campaign sync logs start/failure/success with `{ clientId, provider, synced }` (no secrets).
  - `components/dashboard/settings/integrations-manager.tsx`: “Sync Email” handler is now `try/catch/finally` so the button can’t get stuck in a loading state on thrown errors; thrown errors surface via toast.
- Added support for configurable EmailBison host via `EMAILBISON_BASE_URL` (default remains `https://send.meetinboxxia.com`) to aid diagnosis when keys are bound to a specific upstream URL.

## Coordination Notes
- Repo had unrelated in-progress changes from Phase 40/42 in the working tree; Phase 41a changes were limited to the email sync flow and avoided `scripts/crawl4ai/*`.

## Handoff
Proceed to Phase 41b to make EmailBison sync succeed end-to-end with valid credentials (and confirm whether `EMAILBISON_BASE_URL` must be set in prod), then ensure downstream campaign-driven views update correctly.
