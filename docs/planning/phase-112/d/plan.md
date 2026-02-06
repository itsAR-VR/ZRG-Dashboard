# Phase 112d — Evaluation + Confidence Calibration Loop

## Focus
Turn “confidence” from a self-reported number into a measured signal:
- Define rubrics and offline evaluation datasets.
- Measure calibration and recommend thresholds per feature (auto-send, overseer, auto-book parsers).

## Inputs
- Existing confidence-gated systems:
  - Auto-send evaluator: `lib/auto-send-evaluator.ts`, `lib/auto-send/orchestrator.ts`
  - Meeting overseer: `lib/meeting-overseer.ts`
  - Proposed-times parser: `lib/followup-engine.ts` (`parseProposedTimesFromMessage`)
- Existing evaluation plumbing:
  - Message performance eval: `lib/message-performance-eval.ts`
  - Prompt runner telemetry: `lib/ai/openai-telemetry.ts`, AIInteraction tables

## Work
1. Define evaluation targets + labels (ground truth)
   - Auto-send: “regret” label (human edited after auto-send, or negative outcome) vs “good auto-send”.
   - Overseer gate: revision correctness (did it remove unsafe booked claims, reduce post-yes overexplaining, etc.).
   - Auto-book parsers: correctness label (booked at correct time vs not).

2. Build a dataset extractor
   - Pull historical samples by window and clientId.
   - Persist a small frozen dataset (IDs + redacted snippets) for repeatable runs.

3. Rubric + judge design (advanced evaluation)
   - Use direct scoring for objective checks (policy compliance, format constraints).
   - Use pairwise comparison when choosing between candidate drafts.
   - Mitigate biases:
     - Position swap for pairwise.
     - Explicitly penalize verbosity/length.
     - Require evidence-based justification.

4. Calibration analysis
   - For each feature, compute calibration curves (confidence buckets vs observed correctness).
   - Identify default thresholds that hit target risk (e.g., < 1% auto-send regret).

5. Operationalization
   - Decide where thresholds live (global default vs per-client setting).
   - Add a workflow to update thresholds safely (human-approved changes only).

## Output
- A runnable script (or cron-safe job) that:
  - extracts dataset
  - runs evaluation
  - writes a calibration report (markdown + JSON)
- Recommended threshold changes (if any) with evidence.

## RED TEAM Refinements (added 2026-02-05)

### R-1: Dataset persistence and PII safety
- **Location:** `scripts/calibration/datasets/` (add to `.gitignore`)
- **Redaction:** Use `buildLeadMemoryContextFromEntries({ redact: true })` for memory fields. Strip message bodies to first/last 50 chars with `[...]` placeholder. Never write full message text to disk.
- **Per-client isolation:** Datasets are extracted and stored per `clientId` in separate subdirectories.
- **Cleanup:** Add a `--prune` flag to delete datasets older than 30 days.

### R-2: Define "regret" label operationally
The plan says `"regret" label (human edited after auto-send, or negative outcome)` but doesn't specify how to detect this from the data. Concrete definition:
- **Auto-send regret:** An `AIDraft` with `sentVia: "auto_send"` where EITHER (a) the lead's next reply has sentiment in `["Not Interested", "Do Not Contact", "Unsubscribe"]` OR (b) a human manually sent a correction message within 30 minutes.
- **Good auto-send:** Auto-sent draft where the lead's next reply has sentiment in `["Interested", "Meeting Requested", "More Info"]` or no negative follow-up within 24 hours.
- Document this definition in the script and in the calibration report header.

### R-3: Script runner environment
Clarify where the script runs:
- **Local dev:** `npx tsx scripts/calibration/run.ts --clientId=xxx --window=30d`
- **NOT as a Vercel cron:** The script needs unbounded execution time and produces filesystem output.
- **DB access:** Uses `DATABASE_URL` (read-only queries only; no writes to production tables).
- **Output:** Writes `report.md` + `report.json` to dataset directory.

### R-4: Judge model and cost considerations
Pairwise comparison + direct scoring across hundreds of samples will consume significant tokens. Specify:
- Judge model: use `gpt-5.2` (same as production pipeline) for consistency with production behavior.
- Cost estimate: include in script output so users understand the API spend.
- Sampling: For initial calibration, 100-200 samples per confidence bucket per feature should suffice. Don't require exhaustive evaluation.

### R-5: Threshold operationalization is a separate execution phase
The plan correctly says "if thresholds change, implement in follow-up execution phase." Reinforce: **this subphase produces a report and recommendation only.** No threshold values are changed in code. The report should include a clear "recommended action" section with exact code locations and values to change.

## Handoff
If thresholds or gating logic change, implement in a follow-up execution phase with regression tests + rollout/monitoring notes.
