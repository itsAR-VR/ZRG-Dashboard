# Phase 22c — Codepath + Regression Hunt (Filters/Counts/Sentiment Derivation)

## Focus
Locate and understand the code paths that compute:
1) displayed sentiment for a conversation/lead, and
2) “Requires Attention” / “Previously Required Attention” counts and filtering,
then identify what changed recently to cause incorrect behavior.

## Inputs
- Repro + DB truth outputs from Phase 22a–22b.
- Relevant areas:
  - `components/dashboard/` (Inbox UI)
  - `actions/` (server actions used by inbox filters)
  - `lib/` (sentiment + rollups + inbox query helpers)

## Work
- Identify the inbox data-fetch and count computations:
  - The server action returning sidebar counts.
  - The query used to fetch conversations for each tab and filter preset.
- Confirm intended business rules:
  - What qualifies as “requires attention” and “previously required attention”.
  - Whether these rules should be sentiment-gated or purely message-direction/recency based.
- Find the regression window:
  - Use `git log` / `git blame` on the key files to identify recent changes affecting sentiment tagging, rollups, or filter clauses.
- If code is correct but data is not:
  - Identify where sentiment/rollups are supposed to be updated (webhook ingestion, sync actions, re-analyze action) and what might have stopped firing.

## Output
- A short root-cause hypothesis list (1–3 items), each mapped to specific code locations and DB fields.
- The chosen fix approach (query change vs pipeline update vs schema correction) with rationale.

## Handoff
Proceed to Phase 22d to implement the minimal fix and add a guardrail/test so this doesn’t regress again.

