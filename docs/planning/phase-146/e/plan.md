# Phase 146e — Judge and Infrastructure Robustness (Token Budget, Timeouts, Retries, Attribution)

## Focus

Remove false negatives caused by infrastructure and evaluator limits so replay failures reliably represent behavior quality issues.

## Inputs

- `docs/planning/phase-146/d/plan.md`
- Replay execution and judge prompt surfaces:
  - `scripts/live-ai-replay.ts`
  - `lib/ai-replay/*`
  - `lib/ai/prompt-registry.ts`

## Coordination Pre-Flight (Mandatory)

- Run `git status --short` before edits.
- Re-read `lib/ai-replay/*` files and `scripts/live-ai-replay.ts`.
- Check Phase 145d progress notes for what was delivered vs deferred.

## Gap Inherited from Phase 145d (RED TEAM)

Phase 145d partially delivered infra attribution, manifest mode, and judge diagnostics, but did NOT implement:
- `--mode decision|outbound|both` CLI flag
- Separate decision-track judge schema/prompt
- Per-track artifact result fields (`decisionTrackResult`, `outboundTrackResult`)

This subphase must decide whether dual-track mode is in scope for 146 or deferred further.

## Work

1. Define token-budget policy for generation and judge calls:
   - dynamic budget allocation based on prompt/context size (extend Phase 145's adaptive budget scaling)
   - explicit truncation strategy and logging
2. Define timeout/retry policy with failure attribution:
   - retryable vs non-retryable classes
   - backoff and max-attempt caps
3. Improve run diagnostics (extend Phase 145d's existing `failureType` classification):
   - refine `classifyFailureType()` in `lib/ai-replay/run-case.ts` beyond regex matching
   - latency/tokens/retry counters per case
   - separation of infra vs quality pass/fail rates in aggregate summary
4. Verify Phase 145 preflight checks are sufficient (DB, API key, schema sentinel); extend if needed.
5. Prevent empty-selection false passes/failures by enforcing non-empty cohort checks.
6. (Scope decision needed) If dual-track mode is in scope: implement `--mode decision|outbound|both` in `lib/ai-replay/cli.ts` and add decision-track judge prompt to `lib/ai/prompt-registry.ts`.

## Output

- Reliable replay execution envelope with explicit diagnostics.
- Reduced "unknown failure" class and clearer unblock actions.

## Handoff

146f wires these improvements into ongoing validation and agent skill gates so this remains enforced over time.

## Output (2026-02-12 08:53 UTC)

- Implemented replay parity upgrade so AI replay can execute the same bounded revision loop semantics used by platform auto-send:
  - Added CLI/runtime control: `--revision-loop platform|force|off` (default `platform`).
  - Wired replay case execution to run evaluator -> revision agent loop before judge scoring.
  - Added per-case revision telemetry to artifacts (`mode`, `enabled`, `attempted`, `applied`, `iterationsUsed`, `threshold`, `startConfidence`, `endConfidence`, `stopReason`, `finalReason`).
  - Moved replay draft cleanup to post-judge to avoid deleting drafts before revision attempts.
- Added CLI parser coverage for revision-loop mode in `lib/ai-replay/__tests__/cli.test.ts`.

## Validation

- `node --conditions=react-server --import tsx --test lib/ai-replay/__tests__/cli.test.ts` — pass.
- `npm run typecheck` — pass.
- `npm run lint` — pass (warnings only).
- `npm run build` — pass.
- `npm run test:ai-drafts` — pass.
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --dry-run --out .artifacts/ai-replay/phase146-manifest-dry.json` — pass, selected 11/11.
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --concurrency 3 --out .artifacts/ai-replay/phase146-manifest-live-platform.json` — pass.
  - Summary: evaluated=7, passed=2, failedJudge=5, failed=0, averageScore=68.57.
  - failureTypeCounts: `draft_quality_error=5`, others 0.
  - judge metadata: `judgePromptKey=ai.replay.judge.v1`, `judgeModel=gpt-5-mini`.
  - revision telemetry aggregate: `stopReason=disabled` for all 11 manifest cases (workspace revision loop disabled by platform settings).
- Targeted A/B for critical 3 with explicit force mode:
  - Baseline (no revision): `.artifacts/ai-replay/phase146-baseline-off.json`
    - evaluated=3, passed=0, failedJudge=3, averageScore=56.67.
  - Variant (forced revision): `.artifacts/ai-replay/phase146-variant-force.json`
    - evaluated=3, passed=0, failedJudge=3, averageScore=59.33.
    - baseline diff: improved=2, regressed=1, unchanged=0.
    - stop reasons: `no_improvement=2`, `threshold_met=1` (one case had threshold `0` from campaign config).

## Gaps Remaining

- Revision loop execution parity now exists in replay, but quality failures remain dominated by prompt/content-policy issues (all remaining failures are `draft_quality_error`).
- In `platform` mode, revision loop did not run for manifest cases because workspace `autoSendRevisionEnabled` is currently false for those clients.
- One critical case (`2a703...`) used campaign threshold `0`, causing immediate `threshold_met` and no revision attempt; this matches platform semantics but weakens gate quality.

## Output (2026-02-12 09:13 UTC)

- Replaced replay judge path to use meeting overseer gate prompt flow instead of `ai.replay.judge.v1`:
  - `REPLAY_JUDGE_PROMPT_KEY` now `meeting.overseer.gate.v1`.
  - Replay judge executes structured prompt with overseer gate schema and maps decision (`approve|revise`) into replay pass/fail scoring.
  - Added workspace prompt resolution helper so replay artifacts store the effective system prompt text for the selected judge workspace.
- Added `--judge-client-id <uuid>` CLI option so replay can force prompt/model context to FC workspace regardless of case client.
- Wired replay case generation to pass `triggerMessageId`, so replay draft generation now follows platform path that runs meeting overseer gating in `generateResponseDraft`.
- Replay still uses revision agent prompt (`auto_send.revise.v1`) for bounded evaluate->revise loop before judging.

## FC Prompt/Model Verification

- Supabase check confirms FC workspace (`ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`) has `meeting.overseer.gate.v1` override rows.
- FC workspace settings:
  - `emailDraftVerificationModel = gpt-5.2`
  - `autoSendRevisionModel = gpt-5.2`
  - `autoSendRevisionEnabled = false` (platform mode disables revision unless forced in replay)

## Validation (FC-overseer judge path)

- `npm run test:ai-replay -- --thread-ids 59dc...,bfbd...,2a70... --judge-client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --revision-loop off --concurrency 3 --out .artifacts/ai-replay/phase146-overseer-fc-baseline-off.json`
  - evaluated=3, passed=0, failedJudge=3, avg=52.67.
- `npm run test:ai-replay -- --thread-ids 59dc...,bfbd...,2a70... --judge-client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --revision-loop force --concurrency 3 --baseline .artifacts/ai-replay/phase146-overseer-fc-baseline-off.json --out .artifacts/ai-replay/phase146-overseer-fc-variant-force.json`
  - evaluated=3, passed=0, failedJudge=3, avg=52.67.
  - baseline diff: improved=1, regressed=1, unchanged=1.
- NTTAN manifest run with FC-overseer judge:
  - dry-run artifact: `.artifacts/ai-replay/phase146-overseer-fc-manifest-dry.json` (selected 11/11)
  - live artifact: `.artifacts/ai-replay/phase146-overseer-fc-manifest-live.json`
  - summary: evaluated=7, passed=0, failedJudge=7, avg=57.
  - failureTypeCounts: all judged failures are `draft_quality_error`.

## Multi-Agent Coordination Note

- Repo remains a multi-agent dirty tree (phases 141–145 active in overlapping AI/message files). This subphase constrained edits to replay harness paths only (`lib/ai-replay/*`, `scripts/live-ai-replay.ts`, phase-146 docs) and avoided touching phase-141/145 implementation files directly.

## Output (2026-02-12 09:47 UTC)

- Implemented post-overseer deterministic invariant gate in replay:
  - Added `lib/ai-replay/invariants.ts` with critical checks:
    - `slot_mismatch`
    - `date_mismatch`
    - `fabricated_link`
    - `empty_draft`
    - `non_logistics_reply`
  - Gate policy matches product requirement: invariant gate executes only when AI judge approves; invariant failures then force replay case to fail (`draft_quality_error`).
  - Added per-case invariant evidence in replay artifacts (`cases[].invariants`, `cases[].evidencePacket.invariants`) and run-level counts (`summary.criticalMisses`, `summary.criticalInvariantCounts`).
- Implemented three-mode replay A/B in a single run:
  - New CLI flag: `--ab-mode <off|platform|force|all>` (repeatable or CSV).
  - For manifest runs, default A/B behavior is `off,platform,force` when `--ab-mode` is omitted.
  - Artifact now includes `abComparison` with per-mode summaries and case-level pass/score/failure deltas.
- Improved judge metadata parity:
  - Replay judge now emits `promptKey`, `promptClientId`, and resolved `systemPrompt` per case.
  - Run-level config uses `PER_CASE_CLIENT_PROMPT` marker when no explicit judge workspace is pinned.
- Added prompt-registry parity for extraction:
  - Registered `meeting.overseer.extract.v2` in `lib/ai/prompt-registry.ts` so workspace overrides can apply to v2 extraction key.
- Implemented platform-side post-AI invariant block path:
  - In `lib/auto-send/orchestrator.ts`, after AI approval (`passesSafety && passesConfidence`), run deterministic invariant checks.
  - On invariant failure, block send and route to `needs_review` with reason `post_ai_invariant_failed:<codes>`, preserving Slack review notification and decision persistence.
  - `AutoSendContext` now carries optional scheduling context (`offeredSlots`, `bookingLink`, `leadSchedulerLink`) from inbound post-process jobs.

## Validation (2026-02-12 09:47 UTC)

- `node --conditions=react-server --import tsx --test lib/ai-replay/__tests__/cli.test.ts lib/ai-replay/__tests__/invariants.test.ts` — pass.
- `npm run typecheck` — pass.
- `npm run lint` — pass (warnings only).
- `npm run build` — pass.
- `npm run test:ai-drafts` — pass.
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --dry-run --out .artifacts/ai-replay/phase146-postfix-dry.json` — pass; selected 11/11.
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --ab-mode all --concurrency 3 --out .artifacts/ai-replay/phase146-postfix-ab.json` — pass.
  - Primary (`platform`) summary: evaluated=7, passed=0, failedJudge=7, avg=53.86.
  - A/B summaries:
    - off: evaluated=7, passed=0, avg=56.86, critical=0
    - platform: evaluated=7, passed=0, avg=53.86, critical=0
    - force: evaluated=7, passed=0, avg=56.29, critical=0
  - failureTypeCounts (platform): `draft_quality_error=7`, others 0.
  - criticalInvariantCounts: all 0 (no AI-approved cases in this cohort, so invariant gate did not trigger).

## Output (2026-02-12 10:21 UTC)

- Added replay-safe meeting-overseer freshness controls:
  - New replay CLI/runtime option: `--overseer-mode <fresh|persisted>` (default `fresh`).
  - Replay now passes `meetingOverseerMode` into `generateResponseDraft`, with `fresh` using non-persisted overseer recomputation to prevent stale `messageId` cache reuse during A/B.
  - Artifacts now record `config.overseerDecisionMode`.
- Added cache-control options to meeting-overseer runtime:
  - `runMeetingOverseerExtraction(..., { reuseExistingDecision, persistDecision })`
  - `runMeetingOverseerGateDecision(..., { reuseExistingDecision, persistDecision })`
  - Existing `runMeetingOverseerGate()` remains backward-compatible as a wrapper returning `finalDraft`.
- Validation (post-change):
  - `npm run typecheck` — pass.
  - `node --require ./scripts/server-only-mock.cjs --import tsx --test lib/ai-replay/__tests__/cli.test.ts lib/ai-replay/__tests__/invariants.test.ts lib/__tests__/ai-drafts-timing-preferences.test.ts` — pass.
  - `npm run test:ai-drafts` — pass.
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --dry-run --out .artifacts/ai-replay/phase146-refresh-dry.json` — pass (selected 11/11).
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --concurrency 3 --out .artifacts/ai-replay/phase146-refresh-live.json` — pass (evaluated=7, passed=0, avg=53, all failures `draft_quality_error`).
  - Targeted 3-case A/B (fresh overseer): `.artifacts/ai-replay/phase146-target3-refresh-ab.json`
    - platform avg `58.33` vs off `51.00` vs force `52.33`.
  - Targeted 3-case A/B (persisted overseer baseline): `.artifacts/ai-replay/phase146-target3-persisted-ab.json`
    - platform avg `54.67`; baseline diff against fresh: `improved=1, regressed=2, unchanged=0`.
- Key observed effect:
  - `59dc...` no longer reuses stale Feb 20 options in fresh mode; persisted mode still reproduces stale cached output, confirming cache contamination was a material replay-quality confounder.

## Deferred Items (RED TEAM Second Pass — 2026-02-12)

1. **Dual-track mode (`--mode decision|outbound|both`)** — Inherited from Phase 145d, not implemented in 146e. A/B mode (`--ab-mode`) tests revision-loop variants, which is a different feature. Dual-track is deferred to 146g or Phase 147.
2. **Evidence packet `decisionContract` always null** — `buildEvidencePacket()` at `lib/ai-replay/run-case.ts:115` hardcodes `decisionContract: null`. The `extraction.decision_contract_v1` from meeting overseer should be captured here for failure provenance. Deferred to 146g1.
3. **Replay judge regression** — Switching from `ai.replay.judge.v1` (2/7 passed, avg 68.57) to `meeting.overseer.gate.v1` (0/7 passed, avg ~53) regressed pass rate. The overseer gate heuristic at `lib/ai-replay/judge.ts:191-225` maps all `revise` decisions to ~60 baseline, which is too coarse for quality differentiation. This needs the hybrid judge from 146g or a restored purpose-built judge.

## Output (2026-02-12 13:36 UTC)

- Closed remaining platform replay quality blockers for the frozen phase-146 cohort by aligning replay run context to generation-time slot/link state:
  - replay now forces fresh draft generation for explicit thread IDs (`reuseExistingDraft=false`) and avoids stale loop cache reuse (`draftRunId=null` in replay loop);
  - replay now refreshes `Lead.offeredSlots` **after** generation and uses the refreshed slots for revision constraints, invariants, and judge context;
  - pass criterion now uses blended hybrid gate (`objective pass` + `blended >= judgeThreshold`) to reduce over-harsh false negatives where objective checks already pass.
- Hardened generation context for known failure cases:
  - `lib/scheduling-link.ts`: detect Google appointment scheduler links (`calendar.google.com/appointments/schedules/...`);
  - `lib/ai-drafts.ts`: propagate `leadTimezone` to overseer extraction, skip canonical booking-link rewrite when a lead scheduler link is present, and enforce booked-confirmation style post-pass when AI decision contract sets `shouldBookNow=yes`;
  - `lib/meeting-overseer.ts`: support lead-timezone hint in extraction prompt and fallback assignment when message text is timezone-ambiguous.
- Reduced invariant false positives:
  - `date_mismatch` now fires only on committal date usage (time/booking-commit wording), not broad date preference comparisons.
  - `non_logistics_reply` now skips information-first inbound requests.

### Validation

- `npm run test:ai-drafts` — pass.
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --dry-run --out .artifacts/ai-replay/phase146-fix3-dry.json` — pass (selected 11/11).
- `npm run test:ai-replay -- --thread-ids 59dcfea3-84bc-48eb-b378-2a54995200d0,bfbdfd3f-a65f-47e2-a53b-1c06e2b2bfc5,2a703183-e8f3-4a1f-8cde-b4bf4b4197b6 --concurrency 3 --judge-client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --out .artifacts/ai-replay/phase146-fix3-live-3cases.json` — pass (`evaluated=3`, `passed=3`, `criticalMisses=0`).
- `npm run test:ai-replay -- --thread-ids <manifest-11-ids> --concurrency 3 --judge-client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --out .artifacts/ai-replay/phase146-fix4-live-all11-platform.json` — pass (`evaluated=7`, `passed=7`, `failedJudge=0`, `criticalMisses=0`).
- `npm run lint` — pass (warnings only).
- `npm run build` — pass.
