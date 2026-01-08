# Phase 5d — Regression Checks + Verification Plan

## Focus
Validate fixes for formatting, global search, and sender attribution without introducing regressions.

## Inputs
- Phase 5a–5c outputs.
- Local/dev environment with test workspace data.

## Work
1. Formatting:
   - Send a multi-paragraph draft via EmailBison; verify spacing in recipient inbox and in-app rendering.
2. Search:
   - Search for a lead known to exist outside the first 50 default results by name/email.
   - Verify results are returned and capped at 50.
3. Attribution:
   - Ingest a simulated webhook where `From` ≠ original outbound `To`, with CC including original.
   - Verify lead attribution uses `From`.
4. Run `npm run lint` and `npm run build`.

## Output
- Checklist + evidence that each fix works.

## Handoff
If all checks pass, deploy and monitor live webhook logs for unexpected payload drift.

