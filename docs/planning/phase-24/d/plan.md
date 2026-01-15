# Phase 24d — UX + admin recovery (ETA, warnings, tooling)

## Focus
Improve the Insights Console UX so users understand build scope and progress, and admins can recover from failures without data loss.

## Inputs
- Updated worker behavior and configurable knobs from Phase 24b/24c
- Existing Insights Console UI (sessions list, status bar, model/effort selectors, recompute/regenerate)

## Work
- UX improvements:
  - Show expected thread count before starting (single-campaign 75; multi-campaign ~30/campaign × selected/cap).
  - Show progress + ETA derived from recent extraction latencies.
  - Make it explicit that builds continue in the background; reduce “looks stuck” moments.
- Admin recovery:
  - Add visible audit trail (who recomputed/regenerated/deleted/restored).
  - Provide “retry seed answer” when pack is complete but answer generation failed.
  - Ensure delete is soft-delete; restore action available; session list reflects this clearly.

## Output
- A more ChatGPT-like, legible Insights experience with clear status/progress and admin recovery controls.

## Handoff
- Ready for implementation rollout and verification against production scenarios.

