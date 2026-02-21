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
  - Deferred NTTAN execution until implementation pass stabilizes and replay manifest is prepared.
- Commands run:
  - none
- Blockers:
  - Replay manifest for phase 181 not yet written.
  - NTTAN commands not yet executed in this turn.
- Next concrete steps:
  - Run NTTAN commands and capture artifact + judge metadata in Output.
