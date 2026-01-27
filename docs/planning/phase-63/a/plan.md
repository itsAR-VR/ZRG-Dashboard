# Phase 63a — Tooling: Add Logs Regression Check

## Focus
Add a small local script to scan exported Vercel logs and fail when known “must-fix” error signatures are present.

## Inputs
- `logs_result copy.json`
- `logs_result.json`

## Work
- [ ] Implement `scripts/logs/assert-known-errors.ts` to scan error-level messages for known signatures.
- [ ] Add `npm run logs:check` script entry.

## Output
- Added `scripts/logs/assert-known-errors.ts` which scans a Vercel-exported JSON log file and fails CI/local runs when known error signatures are present.
- Added `npm run logs:check` (`package.json`) to run the scanner (defaults to `logs_result copy.json`, or pass a filepath).

## Handoff
Proceed to Phase 63b to clear invalid Supabase auth cookies in `lib/supabase/middleware.ts` when `refresh_token_not_found` (and similar) is detected.
