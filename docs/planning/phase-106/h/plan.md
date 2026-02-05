# Phase 106h — Meta: Pin Monday snapshot + de-dupe/coordination

## Focus
Make Phase 106 executable as an index by pinning stable identifiers (Monday item IDs + snapshot timestamp), ensuring the bug list is complete, and explicitly linking any items already covered by dedicated phase plans.

## Inputs
- Monday board: “AI Bugs + Feature Requests”
- Current Phase 106 index: `docs/planning/phase-106/plan.md` (subphases a–g)
- Existing overlapping phases:
  - Phase 105 — Duplicate follow-up emails
  - Phase 98 — Stop sequences on booking
  - Phase 97 — Auto-send evaluator visibility (missing AI responses Jam)
- Jam links referenced in a/c/d/e/f/g

## Work
1. Pull the Monday board snapshot (non-Done items) and record:
   - board ID, snapshot date/time, filter used
   - per item: item ID, title, status, owner, and any Jam/repro link
2. Compare the snapshot list to the Phase 106 Subphase Index:
   - If items are missing, append new subphases (next letter) using the Phase template and update the index (append-only).
   - If items map to existing dedicated phase plans (e.g., Phase 105/98/97), annotate the mapping in the root plan so we don’t re-triage.
3. For each bug subphase, ensure repro artifacts are minimally capturable:
   - channel + leadId + messageId(s) + timestamp (or a DB query to locate)
4. Record any cross-bug dependencies (e.g., prompt changes that affect availability + booking messaging).

## Output
- Updated Phase 106 root plan with:
  - a pinned snapshot timestamp + stable Monday item IDs
  - any missing bug subphases appended
  - explicit links to overlapping phase plans to avoid duplicate work

## Handoff
Proceed to implementation by priority order (either `phase-implement 106` or split high-impact bugs into dedicated fix phases).
