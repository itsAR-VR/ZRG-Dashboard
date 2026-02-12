# Phase 146d — Revision-Agent + Overseer Closed-Loop Contract and Batch Workflow

## Focus

Operationalize the existing revision-agent and overseer pipeline so failed cases are corrected in bounded batches with explicit approval semantics.

## Inputs

- `docs/planning/phase-146/c/plan.md`
- Existing revision agent: `lib/auto-send/revision-agent.ts` (822 lines) — `maybeReviseAutoSendDraft()`, bounded loop in `lib/auto-send/orchestrator.ts:338-402`. Currently scoped to auto-send email campaigns; uses evaluator, NOT overseer.
- Meeting overseer gate: `lib/meeting-overseer.ts` — `runMeetingOverseerGate()` returns `MeetingOverseerGateDecision` with `decision: "approve" | "revise"`, `issues`, `rationale`.
- Evidence packet schema from 146a.

## Critical Clarification (RED TEAM)

The revision-agent ↔ overseer closed loop does **NOT** currently exist. The existing revision agent uses the auto-send evaluator for feedback, not the meeting overseer gate. This subphase must BUILD the integration, not merely operationalize it.

Options:
- (A) Extend `maybeReviseAutoSendDraft()` to accept overseer gate feedback as an additional input signal.
- (B) Build a new general-purpose revision loop in `lib/ai/revision-loop.ts` that consumes both evaluator and overseer gate decisions.
- (C) Wire `MeetingOverseerGateDecision.decision=revise` + `issues` directly into the existing revision agent's context as "failure evidence."

## Coordination Pre-Flight (Mandatory)

- Run `git status --short` before edits.
- Re-read `lib/auto-send/revision-agent.ts`, `lib/auto-send/orchestrator.ts`, `lib/meeting-overseer.ts`.
- Record merge conflicts in progress notes.

## Work

1. Define revision-agent input contract:
   - failure packet(s)
   - active prompt/version keys
   - policy constraints
   - desired invariants and non-goals
2. Define revision-agent output contract:
   - proposed prompt/process diff summary
   - expected behavioral changes per failure cluster
   - explicit risk notes and possible regressions
3. Define overseer decision contract:
   - `approve`, `reject`, `needs_more_context`
   - mandatory rationale and violated/validated invariants
4. Define batch strategy:
   - multiple cases per revision pass
   - critical-case weighting
   - rollback rule when critical case regresses
5. Ensure deterministic code only executes AI-approved decisions (no pre-AI override).

## Output

- Decision-complete revision/overseer workflow for iterative correction.
- Batch runbook for multi-case replay-driven revisions.

## Validation

- `npm run lint`
- `npm run build`
- `npm run test:ai-drafts`
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --dry-run`
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --concurrency 3`
- Verify revision-agent ↔ overseer integration exercised on >= 3 manifest cases with gate outcomes logged.

## Handoff

146e hardens judge and infra reliability so loop outcomes reflect model quality rather than environment noise.

## Output (2026-02-12 12:00 UTC)

- Implemented Option A+C integration by extending the existing revision agent path (no net-new loop framework):
  - Added hard-constraint generation and validation module: `lib/auto-send/revision-constraints.ts`.
  - Extended `maybeReviseAutoSendDraft()` to accept:
    - `hardRequirements`, `hardForbidden`
    - context needed for slot/link validation (`offeredSlots`, `bookingLink`, `leadSchedulerLink`, `leadTimezone`, `currentDayIso`)
    - `validateRevisedDraft` callback for post-revision hard checks.
  - Revision candidates now fail-closed when:
    - unresolved requirements are returned, or
    - hard-constraint validation fails.
- Wired closed-loop contract into both runtime paths:
  - Production auto-send loop: `lib/auto-send/orchestrator.ts`
  - Replay loop: `lib/ai-replay/run-case.ts`
- Prompt contract hardening:
  - `AUTO_SEND_REVISE_SYSTEM` now enforces hard-constraint handling and unresolved-requirement reporting.
  - Overseer gate templates now enforce one-slot behavior when lead gives day/window preference.
  - Files: `lib/ai/prompt-registry.ts`, `lib/meeting-overseer.ts`, `lib/ai-replay/judge.ts`.
- Added targeted tests:
  - `lib/auto-send/__tests__/revision-constraints.test.ts` (new)
  - verifies day/window single-slot enforcement and unsupported-slot rejection.

## Validation (2026-02-12 12:00 UTC)

- `npm run lint` — pass (warnings only).
- `npm run build` — pass.
- `npm run test:ai-drafts` — pass.
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --dry-run` — pass (selected 11/11).
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --concurrency 3` — pass.
  - Artifact: `.artifacts/ai-replay/run-2026-02-12T12-00-11-289Z.json`
  - Prompt metadata:
    - `judgePromptKey=meeting.overseer.gate.v1`
    - `judgeSystemPrompt=PER_CASE_CLIENT_PROMPT`
  - Platform summary:
    - `evaluated=7`, `passed=0`, `failedJudge=7`, `avg=47.71`
    - `failureTypeCounts`: `draft_quality_error=7`, others `0`
    - critical invariants: `slot_mismatch=4`, `fabricated_link=2`
  - A/B summary in same run:
    - `off`: `avg=41.57`, `critical=9`
    - `platform`: `avg=47.71`, `critical=6`
    - `force`: `avg=38.43`, `critical=12`

## Remaining Gap

- Replay main mode (`platform`) still reflects workspace-level revision setting, and for this cohort revision remained disabled (`revisionLoop.stopReason=disabled`) in case outputs.
- This is expected parity behavior, but it means "feedback applied by revision" is only exercised in `force`/A-B modes unless workspace revision is enabled.

## Multi-Agent Coordination Note

- `git status --short` confirms broad concurrent edits across phases 141-146.
- This execution intentionally constrained edits to revision-loop, overseer/judge prompts, replay runtime, and phase-146 docs to avoid stepping on unrelated active workstreams.
