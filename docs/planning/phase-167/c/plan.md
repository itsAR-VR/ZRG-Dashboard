# Phase 167c — Surgical Timeout Patch (Inngest/Vercel Runtime Path)

## Focus
Implement minimal timeout-related code/config updates to reduce failure risk based on verified platform constraints.

## Inputs
- Phase 167b timeout contract and file-level edit list
- Existing runtime/integration code paths in this repository

## Work
- Apply only the necessary timeout configuration updates (targeting `800s` when supported).
- If a hard cap prevents `800s`, set the maximum supported value and implement or document the smallest practical mitigation (for example workload segmentation/checkpointing) without broad refactor.
- Ensure no unrelated behavior changes in cron/auth/workflow dispatch logic.

## Output
A surgical patch with explicit before/after timeout behavior and rationale.

## Handoff
Hand off updated code/config and verification checklist to Phase 167d.
