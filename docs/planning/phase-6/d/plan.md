# Phase 6d — Verification Checklist + Monitoring

## Focus
Verify the fixes end-to-end and ensure we can detect regressions quickly.

## Inputs
- Phase 6a–6c changes.
- Local/dev webhook simulation ability (or staging logs).

## Work
1. Re-run the repro harness and confirm:
   - Truncated/malformed AI output no longer breaks the pipeline.
   - Outcomes are categorized (no silent failure).
2. Simulate inbound email webhook processing with a sanitized payload:
   - Confirm signature extraction runs (or falls back) and does not default to “not from lead”.
3. Add/verify monitoring:
   - Count of signature extraction failures by category over time.
   - Alert threshold suggestion (e.g., spike in `invalid_json`).
4. Run `npm run lint` and `npm run build`.

## Output
- Repro harness confirms behavior for truncated/non-JSON outputs:
  - `node scripts/repro-signature-ai-parse.js` shows the “balanced” extractor detects incomplete JSON and avoids false-positive parsing.
- Validation:
  - `npm run lint` passes (warnings only).
  - `npm run build` succeeds (note: Next build is configured to skip type validation).
  - `npx tsc -p tsconfig.json --noEmit` still fails due to pre-existing type errors in `actions/crm-actions.ts` and `components/dashboard/sidebar.tsx` (not introduced by Phase 6).
- Monitoring hook:
  - Track occurrences of `[SignatureExtractor] Failed to parse AI JSON output` and group by `error` (`no_json_object_found`, `incomplete_json_object`, etc.) plus `summary.incomplete=...` when present.

## Handoff
Deploy, then watch webhook logs for one business day; if parse-failure categories spike, capture only sanitized metadata (error category + response summary) and iterate on prompt/budget.
