# Phase 181f — Tests, Replay Manifest, NTTAN Validation, and Phase Review

## Focus
Prove the new deferral mode is correct, safe, and non-regressive across the FC dataset.

## Inputs
- Outputs from phases 181a–181e.
- Existing replay tooling and prior phase manifests:
  - `scripts/live-ai-replay.ts`
  - `lib/ai-replay/*`
  - `docs/planning/phase-179/replay-case-manifest.json`

## Work
1. Add/extend unit/integration tests for:
   - parseable broad-window deferral routing,
   - unparseable-window clarifier-only fallback,
   - due-date scheduling at `window_start - 7 days`,
   - dedupe/cancel semantics,
   - availability fetch failure fallback behavior.
2. Create a Phase 181 replay manifest focused on deferral cases:
   - mid-month windows,
   - week-of month windows,
   - next-quarter style intents,
   - coordinator mention variants,
   - outage-fallback simulations (where replay harness supports stubbing).
3. Run mandatory NTTAN validation:
   - `npm run test:ai-drafts`
   - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20`
   - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3`
4. Capture evidence in phase review:
   - artifact paths,
   - `judgePromptKey`, `judgeSystemPrompt`,
   - `failureType` and critical invariant counts.

## Output
- Test + replay evidence showing deferral flow works and preserves existing invariants.
- Phase review ready for merge/deploy decision.

## Handoff
If validated, hand off to implementation closeout and deployment runbook; if failures remain, open targeted remediation subphase with concrete failing IDs + invariants.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Corrected cross-phase dependency reference from 182x to 181x.
  - Created `docs/planning/phase-181/replay-case-manifest.json` seeded for FC future-window deferral validation.
  - Executed NTTAN validation on latest code state after shipping follow-up fixes in commit `2d132f4`.
  - Captured replay artifact + judge metadata and failure-type evidence.
- Commands run:
  - `npm run test:ai-drafts` — pass (`78/78` tests passed).
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-181/replay-case-manifest.json --dry-run` — pass; selected 12 cases; artifact: `.artifacts/ai-replay/run-2026-02-21T16-22-29-008Z.json`.
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-181/replay-case-manifest.json --concurrency 3` — pass with one judge fail; artifact: `.artifacts/ai-replay/run-2026-02-21T16-22-34-547Z.json`.
  - Replay judge metadata (from artifact):
    - `judgePromptKey`: `meeting.overseer.gate.v1`
    - `promptClientId`: `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`
    - `judgeSystemPrompt`: scheduling overseer gate prompt (`.cases[].judge.systemPrompt` in artifact).
  - Replay failure/invariant counts:
    - `failureTypeCounts`: `draft_quality_error=1`, all others `0`
    - `criticalInvariantCounts`: `slot_mismatch=0`, `date_mismatch=0`, `fabricated_link=0`, `empty_draft=0`, `non_logistics_reply=0`
- Blockers:
  - One remaining replay quality failure:
    - case `5b0874d8-e9ba-4c6e-8e21-5babaee2fe11:email`
    - failure type `draft_quality_error`
    - reason: clarifier asks for two details ("date/time") instead of one detail for mid-March window.
- Next concrete steps:
  - Tighten clarifier composition for mid-month windows so fallback copy never asks for "date/time" in a single question.
  - Re-run the same replay manifest and close the single failing case.
