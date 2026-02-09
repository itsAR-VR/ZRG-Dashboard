# Phase 125 — Review

## Summary
- Shipped indexless availability refresh replacements (model returns `{ oldText, newText }` only) and deterministic locate-based validation to eliminate brittle index drift.
- Added non-PII logging for refresh failures (ids + meta only).
- Updated unit tests for the new validator and ran quality gates.
- Remaining:
  - Verify the Jam repro on a deployed environment (or locally with real DB/auth), since we did not run the live UI flow in this review.
  - Re-run repo-wide gates after reconciling unrelated concurrent working-tree edits (`prisma/schema.prisma`, `lib/workspace-capabilities.ts`) that appeared after the initial verification run.

## What Shipped
- `lib/availability-refresh-ai.ts`
  - AI response contract changed from index-based `{ startIndex, endIndex, ... }` to indexless `{ oldText, newText }`.
  - `validateAvailabilityReplacements()` now locates unique `oldText` occurrences in the current draft to compute ranges and fails closed on ambiguity.
- `lib/draft-availability-refresh.ts`
  - Added safe failure logging for refresh failures (no draft content, no slot labels).
- `lib/__tests__/availability-refresh-ai.test.ts`
  - Updated tests for the new indexless validator input and added coverage for `old_text_not_found` / `old_text_not_unique`.

## Verification

### Commands
- `npm test` — pass (Mon Feb 9 13:01:09 EST 2026)
- `npm run lint` — pass (warnings only, pre-existing) (Mon Feb 9 13:01:09 EST 2026)
- `npm run build` — pass (Mon Feb 9 13:01:09 EST 2026)
- `npm run db:push` — skip (no Prisma schema changes in this phase)
- `npx prisma validate` — **fail** (Mon Feb 9 13:03:11 EST 2026) (working tree contains invalid `DraftPipelineRun` references)

### Notes
- Lint emitted existing warnings (React hooks deps, `<img>` usage, etc.) but no errors.
- Next build emitted existing CSS optimization warnings about unexpected tokens in generated selectors; build still completed successfully.
- **Multi-agent note:** After the verification run, the working tree changed (unrelated edits in `prisma/schema.prisma` and `lib/workspace-capabilities.ts`). Those changes were not part of Phase 125 and were not re-verified here.
  - `npx prisma validate` currently fails with `P1012` because `DraftPipelineRun` is referenced but not defined in `prisma/schema.prisma`.

## Success Criteria → Evidence

1. Clicking "Refresh availability times" on a draft containing outdated time offers succeeds in normal cases (no `validation_failed:*`), and updates the draft content.
   - Evidence: `lib/availability-refresh-ai.ts` removed index requirements and now validates by locating `oldText` in the current draft; unit tests cover the validator behavior in `lib/__tests__/availability-refresh-ai.test.ts`.
   - Status: **partial** (logic verified; live UI/Jam repro not executed in this review)

2. If the draft has no time offers, refresh returns the existing "No time options found..." message (no behavior regression).
   - Evidence: `lib/availability-refresh-ai.ts` still returns `no_time_offers` when `hasTimeOffers=false` and replacements are empty; `lib/draft-availability-refresh.ts:mapRefreshError()` still maps `no_time_offers` to the same user-facing string.
   - Status: **partial** (code-level verification; no end-to-end UI run)

3. If the draft is edited in a way that makes replacements ambiguous (e.g., `oldText` appears multiple times), refresh fails closed with the existing generic safety error (no partial/unsafe edits).
   - Evidence:
     - `lib/availability-refresh-ai.ts` emits `validation_failed:old_text_not_unique` when `oldText` occurs multiple times.
     - `lib/__tests__/availability-refresh-ai.test.ts` covers the `old_text_not_unique` failure.
     - `lib/draft-availability-refresh.ts:mapRefreshError()` maps `validation_failed:*` to the generic "Could not safely refresh availability..." message.
   - Status: **met**

4. Quality gates pass: `npm test`, `npm run lint`, `npm run build`.
   - Evidence: commands executed successfully (see Verification section).
   - Status: **met**

## Plan Adherence
- Planned vs implemented deltas:
  - Validation error codes: plan drafts originally used `old_text_empty`/`old_text_ambiguous`; implementation uses `invalid_old_text`/`invalid_new_text` and `old_text_not_unique`. Impact: internal-only error strings; user-facing messaging unchanged.
  - Manual Jam repro: not performed (requires deploy or local app run with real DB/auth).

## Risks / Rollback
- Risk: if the model returns an `oldText` that appears multiple times (or not at all), refresh will fail closed and ask for regeneration.
  - Mitigation: this is an explicit safety tradeoff; safer than silently replacing the wrong occurrence.
- Rollback: revert the changes in `lib/availability-refresh-ai.ts` and `lib/draft-availability-refresh.ts` (no migrations).

## Follow-ups
- Verify Jam `ff2470b8-f70d-49e5-ad96-e12b27f3f1ba` repro after deploying this change (production or preview).
- Optional: add an integration-ish test by factoring `validateAvailabilityReplacements()` to accept a draft + AI pair list and asserting `refreshAvailabilityInDraftViaAi()` applies replacements across multiple passes (requires mocking `runStructuredJsonPrompt`).
