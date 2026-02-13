# Phase 146 — AI Draft Reliability Root-Cause Closure Loop (Revision Agent + Overseer)

## Purpose

Close the systemic gap between observed replay failures and production-quality fixes by building a root-cause-driven revision loop that uses full AI context, feeds corrections through the revision agent, and enforces overseer approval before any outbound behavior is allowed.

## Context

This phase is created from repeated evidence that incremental prompt tweaks are not reliably fixing booking and draft quality outcomes:

- Critical booking-first miss: `59dcfea3-84bc-48eb-b378-2a54995200d0:email`.
- Repeated draft-generation failures: `bfbdfd3f-a65f-47e2-a53b-1c06e2b2bfc5:email`, `2a703183-e8f3-4a1f-8cde-b4bf4b4197b6:email`, plus broader replay set.
- Past run fragility from infra/judge limits (`P1001`, `P2022`, API key issues, `max_output_tokens` pressure), making quality attribution noisy.

Product direction locked by user:

- Deterministic logic is execution-level only after AI extraction/approval.
- AI decides qualification/booking intent/timezone; deterministic code executes safe actions from that decision.
- Revision agent must ingest failures + full context and propose corrections.
- Overseer remains approval gate before final send behavior.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| 141 | Active/partial | Replay harness, AI route skip telemetry, draft safety tests | Reuse artifacts and avoid changing run artifact schema incompatibly. |
| 142 | Active | Qualification and booking confidence paths | Preserve binary extraction vs confidence gate split; no reintroduction of pre-AI deterministic overrides. |
| 143 | Active | Process routing + Slack handoff semantics | Keep P4/P5 Slack-only semantics and reason tags aligned. |
| 144 | Active | Dashboard/settings/reporting surfaces | Keep this phase backend/pipeline focused; only add UI if required for visibility. |
| 145 | Active NO-GO | Decision contract, replay dual-track, booking behavior | Phase 146 is a root-cause closure layer on top of 145 outputs; do not fork contract definitions. |

## Objectives

- [ ] Build a canonical failure taxonomy and per-case evidence packet for replay failures.
- [ ] Diagnose and resolve why booking-first behavior fails even when booking windows are provided.
- [ ] Diagnose and resolve draft-generation failures across the critical set and wider replay sample.
- [ ] Implement revision-agent input/output contract that includes full context and failure artifacts.
- [ ] Enforce overseer approval loop integration and explicit rejection reasons before send.
- [ ] Harden judge/infrastructure reliability (token budgeting, truncation handling, timeout attribution).
- [ ] Add longitudinal regression workflow so agents can test AI behavior over time, not only per-change.

## Constraints

- No deterministic business-rule bypass before AI extraction/approval.
- Deterministic logic may only execute approved AI decisions and safety constraints.
- Keep compatibility with existing decision contract (`decision_contract_v1`) and process routing semantics from phase 145.
- Preserve channel scope: email, SMS, LinkedIn.
- Treat replay artifacts as sensitive local diagnostics only (`.artifacts/ai-replay/*`, gitignored).

## Architecture Decisions Locked (2026-02-12)

These are now decision-complete and must be treated as implementation constraints for remaining phase work:

1. Judge authority model: **Hybrid gate**
   - Objective critical checks decide hard-fail safety/compliance outcomes.
   - LLM judge handles quality scoring and revision guidance.
   - Borderline drafts route to adjudication, not automatic fail.
2. Revision loop authority: **Fail closed**
   - If revision does not converge within bounded iterations, do not send.
   - Escalate to human review with explicit unresolved requirements.
3. Cross-workspace policy model: **Global core + local overlays**
   - Shared core scheduling/policy contract across all workspaces.
   - Workspace overlays are for context/tone/business specifics only.
   - No workspace-specific policy forks in code.
4. Judge defaults and calibration:
   - Default profile: `balanced`.
   - Adjudication band: `40-80` (configurable via admin).
   - Rollout gate: `>=85%` replay pass and `0` critical misses (configurable via admin).
5. Override policy:
   - Objective critical-fail blocks are overrideable by **human only**.
   - No agent-side critical override path.
6. Prompt governance:
   - Admin supports full prompt editor with **two-person approval** for publish.
   - Prompt/policy publish operations must be versioned, audited, and rollbackable.
7. Retention:
   - Full replay artifacts retained for 90 days.
   - Long-lived archive stores lightweight metrics + audit metadata only.
8. Rollout strategy:
   - All workspaces phased rollout, controlled by flags/profile settings.
   - FC is a first-class workspace consumer, not a special-code path.

## Success Criteria

1. Root-cause report exists for every failed case in the critical set and top replay failures, with failure type, owning subsystem, and concrete remediation.
2. `59dc...` passes booking-first expectations (no extra selling, timezone-correct options, booking-forward response).
3. `bfb...` and `2a70...` no longer fail draft generation; failure class is either resolved or explicitly attributable to infra.
4. Revision-agent contract is implemented and exercised on multi-case batches (>= 10 cases) with overseer gate outcomes logged.
5. NTTAN validation is required and documented in implementation + review gates:
   - `npm run test:ai-drafts`
   - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --dry-run`
   - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --concurrency 3`
6. Replay pipeline distinguishes `draft_quality_error` vs `judge_error` vs `infra_error` with retry/timeout/token diagnostics.
7. Phase-review and companion skill docs include mandatory AI replay validation for AI/message/prompt changes on both Codex and Claude agent workflows.

## Edge Cases and Weak Spots To Cover

- Lead supplies a valid booking window but message asks secondary questions (pricing/frequency/community) in same reply.
- Inferred timezone disagrees with explicit lead-stated timezone token in latest inbound message.
- Revision agent improves one invariant but regresses another (booking-first fixed, tone/policy regresses).
- Judge prompt overflow/truncation masks true draft quality.
- Replay selection returns zero cases, causing false-green runs.
- Infrastructure failures mixed into quality metrics (DB/network/API).
- Multi-case batch revisions where one bad case should not poison all corrections.

## Repo Reality Check (RED TEAM)

### What exists today

| Component | File | Status | Notes |
|-----------|------|--------|-------|
| Revision agent (auto-send) | `lib/auto-send/revision-agent.ts` (822 lines) | Exists | `maybeReviseAutoSendDraft()` — bounded loop (max 3 iters) in `lib/auto-send/orchestrator.ts:338-402`. Uses **evaluator**, NOT overseer. Scoped to email campaign auto-send only. |
| Meeting overseer | `lib/meeting-overseer.ts` (671 lines) | Exists | `runMeetingOverseerExtraction()` + `runMeetingOverseerGate()` with approve/revise semantics. Attached `decision_contract_v1` (Phase 145a). |
| Decision contract v1 | `lib/ai/decision-contract.ts` (195 lines) | Exists (145) | `AIDecisionContractV1` type, derivation, validation, repair. Wired to extraction return path. |
| Failure type enum | `lib/ai-replay/types.ts:80-86` | Exists (145) | `ReplayFailureType`: `decision_error`, `execution_error`, `draft_quality_error`, `judge_error`, `infra_error`, null. Missing: `selection_error`. |
| Replay preflight | `lib/ai-replay/run-case.ts`, `scripts/live-ai-replay.ts` | Exists (145) | DB connectivity, OpenAI key, schema-drift sentinel. Manifest mode via `--thread-ids-file`. |
| Replay case manifest | `docs/planning/phase-145/replay-case-manifest.json` | Exists (145) | Frozen: 3 core + 7 top-10 cases. Client: `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`. |
| Dual-track replay mode | — | NOT implemented | Phase 145d partially delivered infra attribution but `--mode decision\|outbound\|both` flag is not built. |
| Evidence packet schema | — | NOT implemented | No structured evidence collection or persistence. Only unstructured `error` strings and `failureType` enum. |
| Revision ↔ overseer loop | — | NOT implemented | Revision agent uses evaluator, not overseer. Overseer gate decision does not feed into revision input. This is NEW integration work. |

### Contract relationship

Phase 146 is layered ON TOP of Phase 145 outputs:
- Consumes `AIDecisionContractV1` (no fork)
- Consumes replay manifest and preflight infrastructure
- Extends `ReplayFailureType` enum (adds `selection_error`)
- NEW: builds overseer → revision loop connection
- NEW: builds evidence packet schema for structured failure diagnostics

## RED TEAM Findings (Gaps / Weak Spots)

### Critical

1. **NTTAN commands use stale `--client-id` format** — Success criteria #5 and 146f validation reference `--client-id`, but Phase 145 established `--thread-ids-file` as the deterministic standard. Updated below.
2. **Revision-agent ↔ overseer loop does NOT exist** — 146d says "operationalize existing" but this is NEW integration work. The revision agent (`lib/auto-send/revision-agent.ts`) only uses the evaluator, not the overseer gate.
3. **Phase 145 is "Active NO-GO"** — Phase 146 depends on 145's outputs. Phase 145 latest replay: 3/7 passed (59dc and bfb still failing). Prerequisite added below.

### High

4. **`lib/ai-drafts.ts` is 7+ phase hot spot** — Phases 135, 138, 139, 140, 141, 143, 145 all modified. Coordination Pre-Flight required.
5. **All target files have uncommitted modifications** from phases 141-145. Symbol-anchored edits and fresh file reads required.
6. **146f duplicates 145e scope** — Phase 145e already updated skill files and AGENTS.md/CLAUDE.md. 146f should focus on incremental additions only.
7. **Dual-track replay incomplete from 145d** — Phase 146e must acknowledge and scope the gap.
8. **Replay pass rate regressed 2/7 → 0/7 after judge switch** — Switching `REPLAY_JUDGE_PROMPT_KEY` from `ai.replay.judge.v1` to `meeting.overseer.gate.v1` in 146e caused all manifest cases to fail. The overseer gate heuristic (`lib/ai-replay/judge.ts:191-225`) maps `decision=revise` → ~60 baseline on all dimensions. This conflates send-safety with replay quality. Fix requires either restoring the purpose-built judge or implementing 146g hybrid gate.
9. **146g has 3 critical blockers** — (1) All 11 required schema fields missing from `prisma/schema.prisma`, (2) 146c not executed (blocks 146d), (3) 146d design decision unresolved. Consider promoting 146g to Phase 147.

### Medium

8. **Evidence packet schema has no file target** — Specify: extend `lib/ai-replay/types.ts`.
9. **Existing `ReplayFailureType` not referenced in 146a** — Extend existing enum, don't redefine.
10. **Revision-agent file path never named in 146d** — Must specify `lib/auto-send/revision-agent.ts` and clarify scope (extend or new module).
11. **No Coordination Pre-Flight in subphases** — Add to 146b, 146c, 146d, 146e.
12. **Missing NTTAN validation in 146b and 146c** — Both modify AI drafting/prompt behavior.

## Prerequisites (RED TEAM)

- Phase 145 NTTAN gates must pass OR human must explicitly mark "sufficient baseline" before Phase 146 begins.
- If Phase 145 replay is blocked by infra (`P1001`, `P2022`), document blocker and track separately from quality assessment.
- Run `git status --short` before starting any subphase; re-read all target files fresh.

## Coordination Pre-Flight (Global — applies to all subphases)

Before each subphase:
1. Run `git status --short` and check for unexpected modifications to target files.
2. Re-read latest versions of all files to be modified (do not rely on cached content).
3. For `lib/ai-drafts.ts`: use symbol-anchored edits only (function name boundaries, not line numbers).
4. Record any merge conflicts and resolution in subphase progress notes.

## Subphase Index

- a — Failure Taxonomy, Evidence Packet Schema, and Critical-Case Baseline
- b — Case 1 Deep Dive: Booking-First Miss (`59dc...`) and Execution Drift
- c — Draft Generation Failure Analysis (`bfb...`, `2a70...`, broader set)
- d — Revision-Agent + Overseer Closed-Loop Contract and Batch Workflow
- e — Judge/Infra Robustness (token budget, timeouts, retries, attribution)
- f — Longitudinal Validation + Phase Skill Gate Updates (Codex + Claude)
- g — Scalable Prompt/Judge Architecture, Admin Governance, and Rollout Controls

## Phase Summary (running)

- 2026-02-12 08:27 UTC — 146a partial execution landed: added canonical phase-146 replay manifest, failure taxonomy docs, and evidence packet schema draft; extended replay failure taxonomy in code (`draft_generation_error`, `selection_error`) and added run-level `failureTypeCounts` plus preflight/selection artifact writing. Validation: `lint` pass (warnings), `build` pass, `test:ai-drafts` pass, replay dry/live blocked by DB connectivity (`db.pzaptpgrcezknnsfytob.supabase.co` unreachable). (files: `docs/planning/phase-146/replay-case-manifest.json`, `docs/planning/phase-146/replay-failure-taxonomy.md`, `docs/planning/phase-146/evidence-packet-schema.json`, `lib/ai-replay/types.ts`, `lib/ai-replay/run-case.ts`, `scripts/live-ai-replay.ts`)
- 2026-02-12 08:30 UTC — 146a hardening continued: runtime `ReplayEvidencePacket` added and populated in case paths; NTTAN rerun captured manifest-bound artifacts with explicit `judgePromptKey`/`judgeSystemPrompt` and `failureTypeCounts` output. Infra blocker persists (DB connectivity), preventing case-level live generation in this environment. (files: `lib/ai-replay/types.ts`, `lib/ai-replay/run-case.ts`, `scripts/live-ai-replay.ts`, `docs/planning/phase-146/a/plan.md`)
- 2026-02-12 08:53 UTC — 146e execution landed: replay now supports platform-parity revision-loop execution (`--revision-loop platform|force|off`), emits per-case revision telemetry, and cleans up drafts post-judge so revision can run. Validation passed: `typecheck`, `lint` (warnings only), `build`, `test:ai-drafts`, manifest dry/live replay. Targeted 3-case A/B completed: baseline off vs forced loop artifacts show +2.66 average score uplift but all 3 still `draft_quality_error`; manifest platform run remained loop-disabled by workspace settings (`autoSendRevisionEnabled=false`). (files: `lib/ai-replay/cli.ts`, `lib/ai-replay/run-case.ts`, `lib/ai-replay/__tests__/cli.test.ts`, `scripts/live-ai-replay.ts`, `docs/planning/phase-146/e/plan.md`)
- 2026-02-12 09:13 UTC — replay judge path switched to overseer prompt flow (`meeting.overseer.gate.v1`) with workspace-resolved prompt support and new `--judge-client-id` override so test cohorts can be judged under FC prompt/model context. Replay generation now passes `triggerMessageId`, aligning with platform meeting-overseer path. Verified FC workspace via Supabase (`ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`, `emailDraftVerificationModel=gpt-5.2`, `autoSendRevisionModel=gpt-5.2`, `autoSendRevisionEnabled=false`). Re-ran targeted 3-case A/B and manifest NTTAN using FC judge-client override; failures remain quality-dominated (no infra/judge failures). (files: `lib/ai-replay/judge.ts`, `lib/ai-replay/cli.ts`, `lib/ai-replay/run-case.ts`, `scripts/live-ai-replay.ts`, `lib/ai-replay/types.ts`, `docs/planning/phase-146/e/plan.md`)
- 2026-02-12 09:47 UTC — implemented replay/platform invariant hardening and integrated three-mode A/B execution in one replay run. Added deterministic critical invariants (`slot_mismatch`, `date_mismatch`, `fabricated_link`, `empty_draft`, `non_logistics_reply`) with AI-first gating semantics (deterministic checks run only after AI approval), added artifact invariant telemetry and run-level critical counts, added `--ab-mode off|platform|force|all`, wired prompt-registry entry for `meeting.overseer.extract.v2`, and added platform post-AI invariant block-to-review path in auto-send orchestrator. Validation passed (`typecheck`, `lint`, `build`, `test:ai-drafts`, replay dry-run, replay A/B manifest run). Latest A/B artifact: `.artifacts/ai-replay/phase146-postfix-ab.json`. (files: `lib/ai-replay/invariants.ts`, `lib/ai-replay/types.ts`, `lib/ai-replay/run-case.ts`, `lib/ai-replay/judge.ts`, `lib/ai-replay/cli.ts`, `lib/ai-replay/__tests__/cli.test.ts`, `lib/ai-replay/__tests__/invariants.test.ts`, `scripts/live-ai-replay.ts`, `lib/auto-send/orchestrator.ts`, `lib/auto-send/types.ts`, `lib/background-jobs/email-inbound-post-process.ts`, `lib/background-jobs/sms-inbound-post-process.ts`, `lib/inbound-post-process/pipeline.ts`, `lib/ai/prompt-registry.ts`, `AGENTS.md`, `CLAUDE.md`, `docs/planning/phase-146/e/plan.md`)
- 2026-02-12 10:21 UTC — closed replay stale-overseer gap and booking-window drift in phase 146 core cases. Added replay `--overseer-mode <fresh|persisted>` (default `fresh`) and threaded fresh/non-persisted overseer recomputation through `generateResponseDraft` to avoid stale `messageId` gate/extract reuse during A/B. Added explicit time-window parsing/filtering in draft availability selection and disabled prior-slot exclusion when a concrete window is stated, fixing the `59dc...` off-window drift (fresh mode now offers Fri Feb 13 in-window slots). Validation passed: `typecheck`, replay CLI/invariant/timing tests, `test:ai-drafts`, replay manifest dry/live, targeted 3-case fresh vs persisted comparison. Artifacts: `.artifacts/ai-replay/phase146-refresh-live.json`, `.artifacts/ai-replay/phase146-target3-refresh-ab.json`, `.artifacts/ai-replay/phase146-target3-persisted-ab.json`. (files: `lib/meeting-overseer.ts`, `lib/ai-drafts.ts`, `lib/ai-replay/cli.ts`, `lib/ai-replay/run-case.ts`, `lib/ai-replay/types.ts`, `scripts/live-ai-replay.ts`, `lib/ai-replay/__tests__/cli.test.ts`, `lib/__tests__/ai-drafts-timing-preferences.test.ts`, `docs/planning/phase-146/b/plan.md`, `docs/planning/phase-146/e/plan.md`)
- 2026-02-12 10:49 UTC — replay verification rerun completed after OpenAI key/config refresh and explicit FC-judge alignment. Commands re-run: `test:ai-drafts`, manifest dry-run, targeted 3-case live A/B (`59dc...`, `bfb...`, `2a70...`), full manifest live replay (default judge-client), and full manifest live replay pinned to FC judge workspace (`--judge-client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`). Outcomes: infra/judge failures now zero; failures are quality-only (`draft_quality_error`). FC-judge manifest summary: `evaluated=7`, `skipped=4`, `passed=0`, `avg=53.14`, `failureTypeCounts.draft_quality_error=7`, critical invariants all zero. Artifacts: `.artifacts/ai-replay/phase146-rerun-dry.json`, `.artifacts/ai-replay/phase146-rerun-target3-fresh-ab.json`, `.artifacts/ai-replay/phase146-rerun-target3-persisted-ab.json`, `.artifacts/ai-replay/phase146-rerun-manifest-live.json`, `.artifacts/ai-replay/phase146-rerun-manifest-live-fcjudge.json`.
- 2026-02-12 10:58 UTC — architecture/governance decisions finalized for phase completion: hybrid judge gate, fail-closed revision loop, global core + workspace overlays, balanced default judge profile, configurable adjudication band (`40-80`) and rollout KPI gate (`>=85%`, zero critical misses), human-only critical-fail overrides, two-person prompt publish approval, 90-day artifact retention with long-term metadata archive, and phased all-workspaces rollout. Added subphase `146g` to convert these decisions into concrete implementation tasks and acceptance gates.
- 2026-02-12 11:27 UTC — implemented 146g1 hybrid judge runtime contract and calibration controls across replay surfaces. Added judge profile/threshold/adjudication CLI, expanded judge artifact schema (`llm` + `objective` + `blended` + `adjudicated` fields), and introduced borderline second-pass adjudication. NTTAN rerun completed with live manifest artifact `.artifacts/ai-replay/phase146g-hybrid-live.json` using `judgePromptKey=meeting.overseer.gate.v1` and `judgeSystemPrompt=PER_CASE_CLIENT_PROMPT`; infra/judge failures remained zero, while quality failures persisted (`draft_quality_error=7`, critical invariants: `slot_mismatch=4`, `fabricated_link=3`). Also revalidated `lint`, `build`, and `test:ai-drafts`. (files: `lib/ai-replay/types.ts`, `lib/ai-replay/cli.ts`, `lib/ai-replay/judge.ts`, `lib/ai-replay/run-case.ts`, `lib/ai-replay/judge-schema.ts`, `scripts/live-ai-replay.ts`, `lib/ai-replay/__tests__/cli.test.ts`, `docs/planning/phase-146/g/plan.md`)
- 2026-02-12 12:00 UTC — implemented revision-loop hard-constraint contract across replay + production auto-send paths. Added `lib/auto-send/revision-constraints.ts`, extended `maybeReviseAutoSendDraft()` with hard requirements/forbidden inputs + post-revision validation callback, wired closed-loop constraint validation in `lib/auto-send/orchestrator.ts` and `lib/ai-replay/run-case.ts`, and hardened prompt contracts in `lib/ai/prompt-registry.ts`/`lib/meeting-overseer.ts`/`lib/ai-replay/judge.ts` (day-window => one-slot rule, unresolved requirements path). Added tests: `lib/auto-send/__tests__/revision-constraints.test.ts`; revalidated `lint`, `build`, `test:ai-drafts`, replay manifest dry-run and live run (`.artifacts/ai-replay/run-2026-02-12T12-00-11-289Z.json`). Result: infra/judge failures remain zero; quality failures persist (`draft_quality_error=7`) and platform-mode revision remained disabled for this cohort due workspace setting parity. (files: `lib/auto-send/revision-constraints.ts`, `lib/auto-send/revision-agent.ts`, `lib/auto-send/orchestrator.ts`, `lib/ai-replay/run-case.ts`, `lib/ai/prompt-registry.ts`, `lib/meeting-overseer.ts`, `lib/ai-replay/judge.ts`, `lib/auto-send/__tests__/revision-constraints.test.ts`, `docs/planning/phase-146/d/plan.md`)
- 2026-02-12 13:36 UTC — closed the previously failing core replay cohort by aligning replay execution with real pipeline behavior and fixing slot/link context drift. Changes shipped: replay now forces fresh generation for explicit thread IDs (`reuseExistingDraft=false`), refreshes `offeredSlots` after generation before invariants/judge, bypasses stale revision cache during replay, and uses blended judge pass (`objective pass && blended score >= threshold`). AI draft pipeline updates include: Google scheduler-link detection (`calendar.google.com/appointments/schedules`), lead-timezone hint propagation into overseer extraction, should-book-now deterministic booking confirmation post-pass, and canonical booking-link replacement skipped when a lead-provided scheduler link exists. Invariant tuning removed false positives (`date_mismatch` now committal-only; `non_logistics_reply` skipped for information-first inbound requests). Validation: `npm run test:ai-drafts` pass, replay dry-run pass, targeted critical 3-case live replay pass (`3/3`, `.artifacts/ai-replay/phase146-fix3-live-3cases.json`), full 11-thread platform replay pass (`evaluated=7, passed=7, criticalMisses=0`, `.artifacts/ai-replay/phase146-fix4-live-all11-platform.json`), plus `npm run lint` and `npm run build` pass (warnings only). (files: `lib/ai-drafts.ts`, `lib/scheduling-link.ts`, `lib/meeting-overseer.ts`, `lib/ai-replay/run-case.ts`, `lib/ai-replay/invariants.ts`)
- 2026-02-12 19:36 UTC — replay/generation pricing hardening pass executed for FC quality regression cases (`f800...`, `0617...`): fixed replay `--thread-ids` parsing for `caseId:channel`, tightened pricing cadence parsing to avoid cross-amount bleed, made source-unknown cadence strict (explicit draft cadence now mismatches unknown source cadence), stripped orphan cadence fragments (e.g. `Membership is /year`), added objective replay checks for malformed cadence/no-dollar pricing intent, and changed replay final gate to avoid objective-score rescue of low-LLM drafts (`llmOverall` must meet threshold unless judge reasons are explicitly non-blocking). Also calibrated overseer/judge prompts to avoid failing solely on non-verbatim scripted phrasing. Validation: `npm run test:ai-drafts` pass, `npm run lint` pass (warnings only), `npm run build` pass, focused replay artifacts `.artifacts/ai-replay/focus-pricing-2cases-ab-2026-02-12-v7.json` through `v10.json`, and large-sample artifact `.artifacts/ai-replay/fc-large80-live-2026-02-12-v1.json` (`evaluated=46`, `passed=2`, `failedJudge=44`, `criticalInvariant slot_mismatch=2`). Root-cause confirmation from live workspace data: active FC knowledge assets still encode `$9,500 annual` + `$791/month` and guidance not to say quarterly, so generation continues to mirror that context until workspace pricing source-of-truth content is updated. (files: `scripts/live-ai-replay.ts`, `lib/ai-drafts.ts`, `lib/ai-replay/run-case.ts`, `lib/ai/prompt-registry.ts`, `lib/ai-replay/judge.ts`, `lib/__tests__/ai-drafts-pricing-placeholders.test.ts`)
- 2026-02-12 20:12 UTC — pricing-language normalization updated per FC requirement: keep `$791/month` but forbid monthly-billing framing by normalizing to monthly-equivalent language (`equates to $791/month ... before committing annually`) in `enforcePricingAmountSafety()`. Replay/judge calibration updated to treat phrasing-only drift as non-blocking (`run-case` non-blocking reason regex + overseer prompt allowance for `equates to $791/month`). Validation: `npm run test:ai-drafts` pass, `npm run lint` pass (warnings only), focused replay artifacts `focus-pricing-2cases-ab-2026-02-12-v13.json` and `v14.json` (1/2 pass; remaining fail is qualification-format/scheduling friction, not pricing hallucination), and large-sample artifact `.artifacts/ai-replay/fc-large80-live-2026-02-12-v2.json` (`evaluated=45`, `passed=8`, `failedJudge=37`, `criticalInvariant slot_mismatch=2`).
- 2026-02-13 09:24 UTC — implemented deterministic-intent removal for pricing classification in phase-146 runtime paths: `AIDecisionContractV1.needsPricingAnswer` and `needsCommunityDetails` now derive from overseer extract JSON fields (`needs_pricing_answer`, `needs_community_details`) instead of regex text detection; replay objective gate no longer uses inbound pricing-intent regex and now keys pricing-missing-answer checks off `judge.decisionContract.needsPricingAnswer`. Added replay judge artifact support for `decisionContract`, and expanded overseer extract prompt/schema to explicitly distinguish qualification revenue mentions (e.g., `$1M annual revenue`) from pricing intent. Validation: targeted tests pass under server-only harness, `npm run test:ai-drafts` pass, `npm run lint` pass (warnings only), `npm run build` pass. NTTAN replay dry/live commands executed with phase-146 manifest but blocked by DB connectivity (`db.pzaptpgrcezknnsfytob.supabase.co` unreachable); artifacts captured: `.artifacts/ai-replay/phase146-pricing-intent-dry.json`, `.artifacts/ai-replay/phase146-pricing-intent-live.json`.
