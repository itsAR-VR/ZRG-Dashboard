# Phase 166d — NTTAN Replay Validation + Evidence Packet

## Focus
Run the NTTAN validation gates and capture evidence that slot-mismatch “hallucination” confirmations are eliminated for the target workspace.

## Inputs
- Updated runtime + revision constraints from Phases 166b/166c.
- Target client/workspace id: `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e` (Founders Club).

## Work
- Run unit gate:
  - `npm run test:ai-drafts`
- Run replay gates:
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20`
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3`
- If failures occur, classify by invariant/judge reason and loop back to 166b/166c with minimal fixes.
- Capture a short evidence packet:
  - case IDs before vs after,
  - counts of `slot_mismatch`/`date_mismatch` and any new failures introduced.

## Output
- Replay runs pass (or remaining failures are triaged into concrete follow-up tasks) and evidence packet recorded.

## Handoff
- If replay gates pass, Phase 166 closes. If not, open a follow-up phase for remaining failure modes.

