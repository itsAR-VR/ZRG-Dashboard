# Phase 108b — Dataset Extraction + Export (Repeatable, Workspace-Scoped)

## Focus
Implement a repeatable way to extract a workspace-scoped dataset that ties outbound messages (setter vs AI) to outcomes (booked vs not booked), suitable for both quantitative metrics and qualitative synthesis.

## Inputs
- Phase 108a spec (labeling + attribution).
- Existing insights infrastructure:
  - `app/api/cron/insights/booked-summaries/route.ts`
  - `app/api/cron/insights/context-packs/route.ts`
  - `lib/insights-chat/*` (thread selection, extraction, synthesis)
- Existing analytics patterns (Phase 101) for sender attribution and “disposition” metadata.

## Work
1. **Choose the persistence format (minimal-first):**
   - Option A (preferred): store a “Message Performance” report as an `InsightContextPack` artifact, with:
     - cohort/window parameters
     - selected thread/message references
     - aggregate counts
     - synthesis outputs (Phase 108c)
   - Option B: introduce a new table for “message performance runs” only if `InsightContextPack` can’t represent what we need.
2. **Build the extractor (server-only):**
   - A single entrypoint that takes `{ clientId, windowStart, windowEnd, channels? }`.
   - Produces a deterministic list of dataset rows (message refs + computed labels + segmentation fields).
   - Records validation stats (dropped rows + why).
3. **Export mechanism (repeatable):**
   - Provide a CLI script or admin endpoint that exports a CSV/JSON for offline review.
   - Ensure exports are admin-gated and redact PII by default (configurable for internal-only workflows).
4. **Sampling controls (make it practical):**
   - Cap rows per run (e.g., 2k) with stable ordering to avoid timeouts.
   - Provide “balanced sampling” mode: equal counts across AI/setter and booked/not booked, to avoid class imbalance dominating synthesis.
5. **Verification:**
   - Unit tests for the attribution query logic (pure functions).
   - A “dry run” mode that prints counts-only summary without exporting content.

## Output
- Workspace-scoped dataset extractor implemented in `lib/message-performance.ts` with cross/within-channel attribution + stats.
- Evidence sampler + report persistence in `lib/message-performance-report.ts` (stores metrics + rows in `InsightContextPack`).
- Admin actions for running reports and fetching evidence (`actions/message-performance-actions.ts`).

## Handoff
Phase 108c uses the stored metrics + evidence samples from the report pack to generate synthesis.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented dataset extraction + metrics (cross/within attribution) in `lib/message-performance.ts`.
  - Added evidence sampling + report persistence helpers in `lib/message-performance-evidence.ts` and `lib/message-performance-report.ts`.
  - Wired server actions for report runs + evidence retrieval in `actions/message-performance-actions.ts`.
- Commands run:
  - `rg -n "buildMessagePerformanceDataset" lib/message-performance.ts` — verified dataset entrypoints.
- Blockers:
  - None.
- Next concrete steps:
  - Generate synthesis output and integrate into the report pack (Phase 108c).
