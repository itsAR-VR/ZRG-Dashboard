# Phase 22d — Fix Implementation (Query/Pipeline/Schema) + Targeted Tests

## Focus
Implement the minimal fix that restores correct sentiment display and attention filtering, and add lightweight verification (tests or invariant checks) appropriate to this codebase.

## Inputs
- Root-cause decision from Phase 22c.
- Any schema adjustments required from Phase 22b.

## Work
- Implement the fix:
  - If query bug: correct scoping/joins/grouping for conversation selection + counts.
  - If sentiment persistence bug: ensure lead-level sentiment updates from the latest inbound message(s) (or update UI to use the correct derived sentiment).
  - If “re-analyze sentiment” is broken: fix the action and ensure it persists expected fields.
- Add a guardrail:
  - Prefer a small unit-level test for helper logic when patterns exist.
  - Otherwise, add a server-side invariant/log (redacted) for impossible states (e.g., counts non-zero while list query returns empty).
- If Prisma schema changes:
  - Update `prisma/schema.prisma`.
  - Run `npm run db:push` and validate expected columns/indexes exist.

## Output
- Code changes implementing the fix and any necessary data-path adjustments.
- A minimal test/guardrail preventing regression (as feasible for this repo).

## Handoff
Proceed to Phase 22e to verify across multiple workspaces, run lint/build, and document any operational notes (backfill/manual actions required).

