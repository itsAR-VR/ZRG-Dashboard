# Phase 146f — Longitudinal Validation and Phase Skill Gate Updates (Codex + Claude)

## Focus

Institutionalize AI behavior validation so future agents must run robust replay checks for AI/message changes and phase reviews cannot pass without evidence.

## Inputs

- `docs/planning/phase-146/e/plan.md`
- Skill docs and repo agent guidance:
  - `AGENTS.md`
  - `CLAUDE.md`
  - `/Users/AR180/.codex/skills/phase-review/SKILL.md`
  - `/Users/AR180/.codex/skills/terminus-maximus/SKILL.md`

## Scope Clarification (RED TEAM)

Phase 145e already updated skill files (phase-review, phase-gaps, terminus-maximus) and AGENTS.md/CLAUDE.md with manifest-driven NTTAN. This subphase should focus on **incremental additions only**:
- Revision-agent workflow documentation
- Longitudinal regression cadence guidance
- Evidence packet / failure taxonomy references
- Do NOT re-do the skill gate updates already completed in 145e.

## Work

1. Verify Phase 145e skill gate updates are present in:
   - `/Users/AR180/.codex/skills/phase-review/SKILL.md`
   - `/Users/AR180/.codex/skills/phase-gaps/SKILL.md`
   - `/Users/AR180/.codex/skills/terminus-maximus/SKILL.md`
   - Claude-side mirrors
   If present, skip redundant updates. If missing, apply them.
2. Add revision-agent workflow guidance to skill docs:
   - when to use revision loop (failed critical cases)
   - expected evidence packet inputs
   - overseer approval semantics
3. Update NTTAN gate documentation to use manifest-driven commands:
   - `npm run test:ai-drafts`
   - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-145/replay-case-manifest.json --dry-run`
   - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-145/replay-case-manifest.json --concurrency 3`
4. Add longitudinal cadence guidance:
   - per-change gate (run on every AI/message change)
   - periodic wider replay runs (weekly/bi-weekly with `--client-id --limit 50`)
   - baseline-vs-current comparison requirements (use `--baseline` flag)
5. Add explicit guidance for selecting valid replay client IDs and handling no-case cohorts.
6. Ensure Codex and Claude-side guidance is aligned (no split-brain process).

## Validation

- `npm run lint`
- `npm run build`
- `npm run test:ai-drafts`
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-145/replay-case-manifest.json --dry-run`
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-145/replay-case-manifest.json --concurrency 3`
- Verify skill files contain manifest-driven NTTAN commands and revision-agent workflow guidance.
- Verify AGENTS.md and CLAUDE.md reference longitudinal cadence and baseline comparison.

## Output

- Durable, enforceable AI regression process documented in both skill and repo guidance surfaces.

## Handoff

Return to root phase summary with completion status, evidence links, and open blockers requiring human decisions.

## Output (2026-02-12 10:21 UTC)

- Updated repository agent guidance to include replay overseer decision mode controls:
  - `AGENTS.md`: added `--overseer-mode fresh|persisted` commands and guidance that `fresh` is recommended for replay validation.
  - `CLAUDE.md`: mirrored the same commands and rationale to keep Codex/Claude guidance aligned.
- This closes a recurring weak spot where replay A/B could be biased by persisted message-level overseer cache entries.

## Output (2026-02-12 10:49 UTC)

- Re-ran NTTAN evidence set with current environment:
  - `npm run test:ai-drafts` (pass)
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --dry-run --out .artifacts/ai-replay/phase146-rerun-dry.json` (11/11 selected)
  - Targeted critical-3 live A/B with FC judge prompts:
    - `npm run test:ai-replay -- --thread-ids 59dcfea3-84bc-48eb-b378-2a54995200d0,bfbdfd3f-a65f-47e2-a53b-1c06e2b2bfc5,2a703183-e8f3-4a1f-8cde-b4bf4b4197b6 --judge-client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --overseer-mode fresh --ab-mode all --concurrency 3 --out .artifacts/ai-replay/phase146-rerun-target3-fresh-ab.json`
    - Persisted-mode compare:
      - `npm run test:ai-replay -- --thread-ids 59dcfea3-84bc-48eb-b378-2a54995200d0,bfbdfd3f-a65f-47e2-a53b-1c06e2b2bfc5,2a703183-e8f3-4a1f-8cde-b4bf4b4197b6 --judge-client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --overseer-mode persisted --ab-mode all --concurrency 3 --baseline .artifacts/ai-replay/phase146-rerun-target3-fresh-ab.json --out .artifacts/ai-replay/phase146-rerun-target3-persisted-ab.json`
  - Full manifest live with FC judge prompts:
    - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --judge-client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --overseer-mode fresh --concurrency 3 --out .artifacts/ai-replay/phase146-rerun-manifest-live-fcjudge.json`
- Latest FC-judge live summary (`phase146-rerun-manifest-live-fcjudge.json`):
  - `judgePromptKey=meeting.overseer.gate.v1`
  - `judge.promptClientId=ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`
  - `evaluated=7`, `skipped=4`, `passed=0`, `failedJudge=7`, `averageScore=53.14`
  - `failureTypeCounts`: `draft_quality_error=7`, all infra/judge/decision failures `0`
  - critical invariants all `0` (`slot_mismatch`, `date_mismatch`, `fabricated_link`, `empty_draft`, `non_logistics_reply`)
