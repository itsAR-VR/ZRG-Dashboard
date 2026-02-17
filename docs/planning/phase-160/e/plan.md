# Phase 160e — Live Canary Matrix + Deployment Parity Unblock

## Focus
Close the final Phase 160 success criterion by validating the signed-upload path on a deployment that actually contains the Phase 160 code.

## Inputs
- `docs/planning/phase-160/plan.md` (remaining unchecked success criterion + open question)
- `docs/planning/phase-160/d/plan.md` (automated validation evidence)
- `artifacts/live-env-playwright/phase160-live-home-2.png`
- `artifacts/live-env-playwright/phase160-live-upload-matrix-fail.png`
- `artifacts/phase160-upload-files/phase160-10mb.txt`
- `artifacts/phase160-upload-files/phase160-25mb.txt`
- `artifacts/phase160-upload-files/phase160-100mb.txt`
- `artifacts/phase160-upload-files/phase160-501mb.txt`

## Work
1. Deployment parity precheck:
   - confirm the target deployment exposes the Phase 160 upload UX/behavior (signed uploads only for files above 12MB).
   - if precheck fails (still old 12MB-only behavior), do not mark matrix results as Phase 160 validation.
2. Run live matrix on the correct deployment:
   - `10MB` file: legacy small-file path still works.
   - `25MB` file: direct signed upload succeeds and finalize returns notes-needed guidance.
   - `100MB` file: direct signed upload succeeds end-to-end without HTTP 413.
   - `501MB` file: blocked by configured upload cap with clear error.
3. Capture evidence:
   - screenshots of upload dialog and result toasts/states.
   - network/console confirmation that large uploads are not sent via Next Server Action payload.
4. Coordination + rollout closeout:
   - document which deployment URL was validated and by whom.
   - if production still lags Phase 160, record deploy owner handoff and expected rerun timing.

## Output

## Handoff

## Validation (RED TEAM)
- Deployment parity check:
  - target deployment no longer shows legacy “max 12MB only” gating for all files.
- Matrix outcomes:
  - `10MB` succeeds with small-file behavior.
  - `25MB` and `100MB` succeed via signed upload with no HTTP 413.
  - `501MB` rejects with explicit max-upload messaging.
- Success criteria closeout:
  - root phase success criteria updated from observed canary evidence.

## Assumptions / Open Questions (RED TEAM)
- Should deploy owner trigger a fresh production deploy before rerunning this matrix?
  - Why it matters: current production alias already points to latest deployment but still shows legacy 12MB behavior.
  - Current default: rerun canary only after a newly confirmed production deployment that includes Phase 160 signed-upload code.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Navigated live app (`https://zrg-dashboard.vercel.app/`) and reached `Settings -> AI Personality -> Add Knowledge Asset`.
  - Confirmed live dialog copy still advertises legacy limit (`max 12MB`) and not the Phase 160 signed-upload behavior.
  - Executed canary attempts with generated files:
    - `10MB` upload failed with `Failed to upload file` and observed HTTP `413`.
    - `25MB`, `100MB`, `501MB` uploads were blocked with `File is too large to upload (max 12MB)`.
  - Captured evidence screenshots and staged this subphase to isolate deployment-parity unblock work.
  - Coordination note: live behavior matches Phase 159-era constraints, so Phase 160 canary evidence must wait for deployment parity.
  - Queried Vercel deployment state; `zrg-dashboard.vercel.app` currently aliases the latest production deployment (`zrg-dashboard-6ajm367gg-zrg.vercel.app`, created 2026-02-16 19:00:30Z), confirming canary failures are from current production code rather than a stale alias pointer.
- Commands run:
  - `mcp__playwright__browser_navigate("https://zrg-dashboard.vercel.app/")` — pass.
  - Playwright interaction sequence (`Settings`, `AI Personality`, `Add Knowledge Asset`, file uploads) — pass; captured legacy-limit failures.
  - `ls -lh artifacts/live-env-playwright artifacts/phase160-upload-files` — pass (evidence artifacts present).
  - `vercel whoami` — pass (`itsar-vr`).
  - `vercel list --environment production --status READY --yes` — pass (latest production deployment discovered).
  - `vercel inspect zrg-dashboard.vercel.app` — pass (alias points to latest production deployment).
- Blockers:
  - Current production deployment appears to be pre-160 for Knowledge Asset uploads, preventing valid signed-upload canary evidence.
  - Final success criterion cannot be closed until canary runs on a deployment that includes Phase 160 changes.
- Next concrete steps:
  - Select source-of-truth deployment URL for Phase 160 canary (production after deploy, or phase-specific preview).
  - Re-run matrix on that deployment and update root success criteria based on actual signed-upload outcomes.
