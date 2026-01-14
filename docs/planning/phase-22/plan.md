# Phase 22 — Inbox Sentiment + Attention Filters Regression (Multi-Workspace)

## Purpose
Restore correct sentiment labeling and “Requires Attention” / “Previously Required Attention” filtering for the Master Inbox.

## Context
- In at least one workspace, leads that appear “interested” are displaying sentiment as `New`, and the “Requires Attention” and “Previously Required Attention” tabs show unexpectedly low counts.
- A Jam screenshot recorded on **January 14, 2026** shows:
  - A workspace selected in the left sidebar
  - A lead conversation showing sentiment tag “New” despite content indicating positive intent
  - Sidebar filter counts showing “Requires Attention” and “Previously Required Attention” both as `1`
  - A server action returning counts `{ allResponses: 1048, requiresAttention: 1, previouslyRequiredAttention: 1, ... }` and another server action returning `conversations: []` for a query that should populate the list
- This appears to be a regression after recent code changes and may affect multiple workspaces, so we need to confirm whether the issue is:
  - UI/rendering,
  - query/filter logic,
  - sentiment pipeline persistence (lead sentiment not being updated), and/or
  - Prisma schema/data-shape mismatches.

## Objectives
* [ ] Reproduce the issue reliably and capture ground-truth data (UI + server responses)
* [ ] Verify DB truth for affected leads (sentiment/status/attention rollups) vs what UI shows
* [ ] Identify the exact code path + regression source for sentiment display and attention filters
* [ ] Implement a minimal, correct fix (schema/query/pipeline) without breaking other workspaces
* [ ] Verify across multiple workspaces and lock in with tests/guards where appropriate

## Constraints
- Multi-tenant correctness: all inbox queries and counts must remain workspace-scoped.
- No secrets or personal data written to the repo; redact identifiers when recording artifacts.
- Prefer existing utilities in `lib/` for sentiment/status decisions.
- If Prisma schema changes, run `npm run db:push` against the correct DB before closing.

## Success Criteria
- [ ] For the affected workspace(s), positive-intent leads show the correct sentiment (e.g., “Interested” when applicable) instead of defaulting to `New`.
- [ ] “Requires Attention” and “Previously Required Attention” lists and counts match the intended business rules and match what the DB indicates for the same workspace.
- [ ] Behavior is consistent across multiple workspaces (no regressions in other clients).
- [ ] `npm run lint` and `npm run build` pass locally after the fix.

## Subphase Index
* a — Repro + evidence bundle (Jam + live app observations)
* b — DB truth audit (lead/message sentiment + attention rollups)
* c — Codepath + regression hunt (filters/counts/sentiment derivation)
* d — Fix implementation (query/pipeline/schema) + targeted tests
* e — Verification + rollout notes (cross-workspace smoke checks)

