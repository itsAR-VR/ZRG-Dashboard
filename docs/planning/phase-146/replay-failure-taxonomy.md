# Phase 146 Replay Failure Taxonomy

## Canonical Failure Types

- `decision_error`
  AI extraction/decision contract is invalid, contradictory, or missing required decision fields.

- `draft_generation_error`
  Draft generation path fails before judge scoring (for example generation returned no content, generation call fails, or draft creation path errors).

- `draft_quality_error`
  Draft generation succeeded and judge scored the output as non-pass.

- `judge_error`
  Judge invocation/output parsing failed (for example prompt runner errors, truncated judge output, invalid judge schema output).

- `infra_error`
  Environment/connectivity/runtime infrastructure failure (for example DB connectivity, schema drift, auth/API-key, DNS/network timeout).

- `selection_error`
  Replay cohort selection failed (for example no cases selected while `--allow-empty` is false).

- `execution_error`
  Unclassified execution failure not matching the above categories.

## Ownership Mapping

- Prompt/behavior owners:
  - `decision_error`, `draft_quality_error`
- Pipeline/runtime owners:
  - `draft_generation_error`, `execution_error`
- Evaluation owners:
  - `judge_error`
- Infrastructure owners:
  - `infra_error`
- Test-harness owners:
  - `selection_error`

## Expected Artifact Signals

Each replay run should expose:

- `config.judgePromptKey`
- `config.judgeSystemPrompt`
- `summary.failureTypeCounts`
- `summary.criticalMisses`
- `summary.criticalInvariantCounts`
- per-case `failureType` and `error`
- per-case `invariants` and `evidencePacket.invariants`
- optional run-level `abComparison` (`off|platform|force`) for side-by-side deltas

## Critical Invariant Codes (Post-AI Gate)

These are deterministic checks that run only after AI approval:

- `slot_mismatch` — Draft proposes times that do not match offered availability.
- `date_mismatch` — Draft references unsupported date vs offered availability.
- `fabricated_link` — Draft references scheduling link without known context.
- `empty_draft` — Draft body is empty.
- `non_logistics_reply` — Booking-intent thread drifted into non-logistics selling content.
