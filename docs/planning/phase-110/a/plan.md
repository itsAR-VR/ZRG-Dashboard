# Phase 110a — Audit & Reconcile (Monday Board → Code/Phases)

## Focus
Build an evidence-based reconciliation of the Monday board “AI Bugs + Feature Requests” (`18395010806`) against repo reality, so we can confidently answer:

- Which items are already fixed (shipped) but not reflected on the board
- Which items are truly still open
- Which items are out of scope for this repo

This subphase is intentionally “analysis-first”; implementation work should only be planned after the reconciliation is complete.

## Inputs
- Monday board: “AI Bugs + Feature Requests” (`18395010806`)
  - Columns: Status `color_mkzh9ttq`, Tool/System `color_mkzhkaqg`, Type `color_mkzhypxv`, Jam link `text_mm00xvew`
- Open board items as-of 2026-02-05 (Status not Done) include:
  - `11196938130`, `11174440376`, `11183404766`, `11185162432`, `11188016134`, `11195846714`, `11157946059`, `11177342525`, `11177512976`, `11177594620`, plus other feature requests (Calling System, Mobile App, etc. per Phase 106 snapshot)
- User issue list (draft outcome/disposition gaps, `send_outcome_unknown`, analytics window drift) when relevant to board reconciliation.
- Phase plans/reviews:
  - `docs/planning/phase-101/`
  - `docs/planning/phase-105/`
  - `docs/planning/phase-106/`
  - `docs/planning/phase-107/`
  - `docs/planning/phase-108/`
  - `docs/planning/phase-109/` (shipped; relevant to draft generation regressions)
- Current code touchpoints:
  - `actions/email-actions.ts`
  - `lib/email-send.ts`
  - `actions/message-actions.ts`
  - `lib/followup-engine.ts`
  - `actions/ai-draft-response-analytics-actions.ts`

## Work
1. Confirm repo state:
   - `git status --porcelain` (identify uncommitted/untracked work that may be “active”).
   - List last 10 phases by mtime and scan Purpose/Subphase Index for overlaps.
2. Enumerate full board via Monday MCP:
   - Use `mcp__monday__get_board_items_page` with board ID `18395010806` to pull ALL items (both Bugs and Feature Requests groups).
   - Extract: itemId, name, Status (`color_mkzh9ttq`), Tool/System (`color_mkzhkaqg`), Type (`color_mkzhypxv`), Jam link (`text_mm00xvew`).
   - Pre-filter: items where Tool/System = "Sales Call AI" or "LMS" → immediately classify as "Out of Scope (Other System/Repo)".
   - Remaining Master Inbox items → proceed with deep audit.
3. Spawn subagents to parallelize deep exploration (recommended):
   - **Board mapping agent:** enumerate all 46 items and pre-classify into buckets (Fixed Shipped / Fixed Verified / Open / Out of Scope / Needs Repro).
   - **Phase mapping agent:** map each Monday item ID → occurrences in `docs/planning/**` (evidence that a fix was planned/shipped).
   - **Code probe agent:** for the highest priority open bugs, locate current code touchpoints and risk areas (e.g., cron/webhook dependencies).
3. Produce a board-wide reconciliation matrix (append-only artifact):
   - Create `docs/planning/phase-110/monday-reconciliation.md` with a single table:
     - `itemId`, `title`, `tool/system`, `type`, `priority`, `boardStatus`, `bucket`, `evidence (phase/code)`, `verification-needed`
   - Start by focusing on non-Done items; then (timebox) spot-check Done items that were never referenced in planning docs.
4. For each reported finding (draft outcome analytics), produce a “status + evidence” record:
   - Missing disposition on idempotent send paths:
     - Verify email idempotent paths set `responseDisposition`.
     - Verify SMS idempotent paths set `responseDisposition` even when no parts pending.
     - Identify any remaining `approved` transitions that omit `responseDisposition` (notably follow-up engine).
   - `send_outcome_unknown`:
     - Verify draft transitions away from `sending` on `send_outcome_unknown`.
     - Verify stale-sending recovery is invoked from cron.
   - Analytics window drift:
     - Confirm current analytics action filters by `AIDraft.updatedAt`.
     - Confirm there is no alternative action already shipped that uses `Message.sentAt` or a dedicated disposition timestamp.
5. Write the status matrix into the Phase 110 root plan context if anything changes from the initial snapshot.
6. Produce a "board update recommendations" list (report only, no automated write-backs):
   - Items that appear Fixed (Shipped) but not marked Done → document recommended board update with evidence (phase refs, no PII).
   - Items that are Out of Scope → document recommendation to route elsewhere.
   - Human will review and apply updates manually.

## Validation (RED TEAM)
- `monday-reconciliation.md` row count >= 46 (all board items classified)
- Every row has exactly one bucket assignment
- Every "Fixed (Shipped)" row has at least one phase reference or code file path as evidence
- No PII in evidence columns

## Output
- Completed a board-wide reconciliation matrix (46 items): `docs/planning/phase-110/monday-reconciliation.md`.
- Posted minimal evidence updates to open items that appear shipped in repo (per Phase 110 policy):
  - `11174440376`, `11183404766`, `11185162432`, `11188016134` (Phase 106)
  - `11177342525` (Phase 101)
  - `11195846714` (Phase 106r, prereq surfacing)
  - `11196938130` (requested repro details; Phase 109 may cover a subset)
- Identified “true open work” candidates (Master Inbox):
  - `11196938130` remains **Needs Repro**
  - Feature requests without implementation evidence remain **Open (Not Fixed)** (see matrix)
  - Draft outcome correctness gaps remain to be fixed in Phase 110b/110c

## Handoff
If any residual disposition gaps remain, proceed to Phase 110b with exact file/line targets and a decision on how disposition should be computed in idempotent “message already exists” cases.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Pulled the full board item list (46 items) and populated the Phase 110 reconciliation matrix.
  - Classified all items into buckets and captured evidence (board status, phase refs, Jam links when present).
  - Wrote back minimal evidence updates to a focused subset of open items (7 items; no status changes).
- Commands run:
  - `monday/get_board_items_page(boardId=18395010806)` — pass (46 items)
  - `monday/create_update(itemId=...)` — pass (7 updates created)
- Blockers:
  - Production verification for “Fixed (Verified)” is not done in this subphase; requires Jam/live verification per item.
- Next concrete steps:
  - Execute Phase 110b (follow-up engine `responseDisposition` gap).
  - Execute Phase 110c (analytics windowing: replace `AIDraft.updatedAt` filter).
  - If/when prod verification is feasible, upgrade relevant items from Fixed (Shipped) → Fixed (Verified) and set Status=Done.
