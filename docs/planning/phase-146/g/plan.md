# Phase 146g — Scalable Prompt/Judge Architecture, Admin Governance, and Rollout Controls

## Focus

Implement the architecture decisions locked in Phase 146 so quality improvements are durable across all workspaces, not FC-only.

## Inputs

- `docs/planning/phase-146/plan.md` (Architecture Decisions Locked section)
- `docs/planning/phase-146/replay-case-manifest.json`
- Replay/judge/prompt/runtime surfaces:
  - `lib/ai-replay/judge.ts`
  - `lib/ai-replay/types.ts`
  - `lib/ai-replay/cli.ts`
  - `lib/meeting-overseer.ts`
  - `lib/auto-send/revision-agent.ts`
  - `lib/auto-send/orchestrator.ts`
  - `lib/ai/prompt-registry.ts`
- Admin/workspace settings surfaces:
  - `actions/settings-actions.ts`
  - `components/dashboard/settings-view.tsx`
  - `components/dashboard/settings/*`
  - `prisma/schema.prisma` (if new settings fields required)

## Coordination Pre-Flight (Mandatory)

- Run `git status --short` before edits.
- Re-read all target files fresh (9+ files have uncommitted modifications from phases 141-146e).
- For `lib/ai-drafts.ts`: symbol-anchored edits only (7+ phase hot spot).
- Record merge conflicts in progress notes.
- Verify 146c and 146d completion status — both are prerequisites for this subphase.

## Prerequisites

- **146c** must be executed (failure cluster analysis feeds judge threshold tuning and revision-agent contracts).
- **146d** design decision (A/B/C for revision↔overseer integration) must be resolved.
- All 11 schema fields must be added to `prisma/schema.prisma` and pushed with `npm run db:push` before implementation.

## Feasibility Notes (RED TEAM)

### Schema migration required

All 11 fields are missing from `WorkspaceSettings` (`prisma/schema.prisma:321-393`). Add to `prisma/schema.prisma`:
- `judgeProfile String @default("balanced")` — `strict|balanced|lenient`
- `judgeThreshold Float @default(70)`
- `adjudicationBandMin Float @default(40)`
- `adjudicationBandMax Float @default(80)`
- `rolloutKPITarget Float @default(85)`
- `rolloutKPICriticalMissTolerance Int @default(0)`
- `promptPublishApprovalEnabled Boolean @default(false)`
- `policyVersionId String?`
- `workspaceOverlayVersionId String?`
- `artifactRetentionDays Int @default(90)`
- `rolloutStageName String @default("canary")`

Run `npm run db:push` after schema changes.

### Two-person approval is NEW capability

No dual-approval pattern exists in the codebase. Nearest existing patterns:
- `MessagePerformanceProposal` (`schema.prisma:886-916`): `approvedByUserId`, `approvedByEmail`, `approvedAt`
- `ConfidencePolicyProposal` (`schema.prisma:963-985`): same approval fields
- Slack approval recipients UI (`settings-view.tsx:2019-2035`)

Required new work: DB schema extension (approval state + dual-approver tracking), server action middleware, UI workflow (draft → pending_approval_1 → pending_approval_2 → published), audit trail. Estimated: ~200-300 LOC backend + ~300-500 LOC UI.

### Prompt override versioning gap

`PromptOverride` (`schema.prisma:2039-2055`) lacks `publishedAt`, `rollbackTarget`, `versionNumber`. `PromptOverrideRevision` (`schema.prisma:2074-2095`) links approval indirectly via `proposalId`. Must extend with direct governance fields before UI work.

### Scope warning

This subphase contains work equivalent to a full phase (hybrid judge + revision contracts + policy model + admin UI + two-person approval + retention + rollout). Consider promoting to Phase 147 with g1/g2/g3 as its subphases.

## Goals

1. Replace single-path judge decisions with hybrid gate evaluation (objective critical checks + LLM quality + adjudication band).
2. Make revision loops fail closed with explicit unresolved requirement reporting.
3. Establish global core policy + workspace overlays model, no workspace code forks.
4. Add admin controls for judge profile/threshold/adjudication band and prompt governance metadata.
5. Ensure prompt publishing is two-person approved with audit log and rollback target.
6. Ship phased rollout controls for all workspaces using shared architecture.

## Work

1. Hybrid judge pipeline:
   - Add layered scoring in replay/runtime artifacts:
     - objective critical result
     - LLM quality score
     - blended final score
     - adjudication status
   - Define adjudication invocation within configurable band (`40-80` default).
   - Keep objective critical checks as hard-fail unless human override is explicitly applied.
2. Revision loop contract hardening:
   - Standardize overseer-to-revision payload:
     - failure codes
     - required changes
     - forbidden changes
     - final draft candidate
   - Standardize revision response:
     - applied changes
     - unresolved requirements
     - confidence deltas
   - Enforce fail-closed at max iteration with explicit reason and review-required state.
3. Workspace-scalable policy model:
   - Define core policy version and workspace overlay references in telemetry/artifacts.
   - Ensure FC uses workspace overlay only (no FC-special case branches).
4. Admin controls and governance:
   - Expose editable controls:
     - judge profile (`strict|balanced|lenient`)
     - judge threshold
     - adjudication band
     - rollout KPI target
   - Add prompt editor publish workflow with two-person approval state model.
   - Add visible policy/prompt version and last-publish metadata.
5. Retention and audit:
   - Document/enforce 90-day full artifact retention.
   - Add long-term summary archive fields (metrics, decisions, audit trail pointers).
6. Rollout controls:
   - Add phased workspace rollout flags.
   - Add KPI gate checks (`>=85%` pass, zero critical misses) before broader stage progression.

## Validation

- `npm run lint`
- `npm run build`
- `npm run test:ai-drafts`
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --dry-run`
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --concurrency 3 --judge-client-id <workspaceId>`
- Targeted A/B on core trio with fresh overseer mode and FC judge-client:
  - `npm run test:ai-replay -- --thread-ids 59dcfea3-84bc-48eb-b378-2a54995200d0,bfbdfd3f-a65f-47e2-a53b-1c06e2b2bfc5,2a703183-e8f3-4a1f-8cde-b4bf4b4197b6 --judge-client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --overseer-mode fresh --ab-mode all --concurrency 3`

## Acceptance Criteria

1. Replay artifacts expose hybrid judge fields (`objective`, `llm`, `blended`, `adjudicated`) and no ambiguity in failure provenance.
2. Unresolved revision loops never auto-send and produce human-review-ready diagnostics.
3. Workspace settings can tune judge behavior without code changes.
4. Prompt publish requires dual-approval and leaves an auditable, versioned trail.
5. FC and at least one non-FC workspace run on the same core policy path with only overlay differences.
6. Phase NTTAN runs show reduced false-negative judging while preserving zero critical invariant tolerance.

## Handoff

If accepted, split implementation into:
- 146g1: runtime contracts + hybrid judge plumbing
- 146g2: admin settings + governance workflow
- 146g3: rollout/retention + calibration reporting

## Output (2026-02-12 11:27 UTC)

- Delivered 146g1 runtime contract updates for hybrid judging in replay:
  - Added judge profile + threshold + adjudication controls to replay CLI and run config:
    - `--judge-profile strict|balanced|lenient`
    - `--judge-threshold <0..100>`
    - `--adjudication-band <min,max>`
    - `--adjudicate-borderline|--no-adjudicate-borderline`
  - Added hybrid judge fields to replay artifact types and schema:
    - `judgeMode`, `judgeProfile`, `judgeThreshold`
    - `llmPass`, `llmOverallScore`
    - `objectivePass`, `objectiveOverallScore`, `objectiveCriticalReasons`
    - `blendedScore`, `adjudicated`, `adjudicationBand`
  - Implemented borderline adjudication in `runReplayJudge` with second-pass overseer call and averaged scoring.
  - Updated replay case scoring to hard-fail objective critical invariants while preserving LLM quality diagnostics:
    - final pass condition: `objectivePass && llmPass`
    - final score: blended (`0.7 * llm` + `0.3 * objective`)
  - Updated artifacts to persist hybrid config and evidence across preflight/selection/live outputs.

## Validation (2026-02-12 11:27 UTC)

- Unit + contract checks:
  - `node --import tsx --test lib/ai-replay/__tests__/cli.test.ts lib/ai-replay/__tests__/invariants.test.ts lib/ai-replay/__tests__/judge-schema.test.ts` — pass.
  - `npm run typecheck` — pass.
- NTTAN gate:
  - `npm run test:ai-drafts` — pass.
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --dry-run --out .artifacts/ai-replay/phase146g-hybrid-dry.json` — pass (selected 11/11).
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --concurrency 3 --out .artifacts/ai-replay/phase146g-hybrid-live.json` — pass (run completed, evaluated 7).
- General quality gates:
  - `npm run lint` — pass (warnings only).
  - `npm run build` — pass.

## NTTAN Evidence Snapshot

- Artifact: `.artifacts/ai-replay/phase146g-hybrid-live.json`
- Prompt metadata:
  - `judgePromptKey = meeting.overseer.gate.v1`
  - `judgeSystemPrompt = PER_CASE_CLIENT_PROMPT`
- Summary:
  - `evaluated=7`, `skipped=4`, `passed=0`, `failedJudge=7`, `averageScore=41.14`
  - `failureTypeCounts`: `draft_quality_error=7`, all other classes 0
  - critical invariants: `slot_mismatch=4`, `fabricated_link=3`, `date_mismatch=0`, `empty_draft=0`, `non_logistics_reply=0`
- A/B mode aggregate:
  - `off`: avg `42.14` (critical `7`)
  - `platform`: avg `41.14` (critical `7`)
  - `force`: avg `44.57` (critical `8`)

## Case Notes (Core Trio)

- `59dcfea3-84bc-48eb-b378-2a54995200d0:email`:
  - No critical invariant miss.
  - Still failed on overseer quality criteria (ack-only/format expectations), score `69`, pass=false.
- `bfbdfd3f-a65f-47e2-a53b-1c06e2b2bfc5:email`:
  - Critical `slot_mismatch` persisted.
  - LLM score `52`, objective critical fail forced final fail (`overall=36`).
- `2a703183-e8f3-4a1f-8cde-b4bf4b4197b6:email`:
  - Critical `slot_mismatch` persisted.
  - LLM score `55`, objective critical fail forced final fail (`overall=39`).

## Remaining Gaps After 146g1

1. Hybrid judging and adjudication are now wired, but prompt/policy quality issues still dominate (`draft_quality_error=7`).
2. Revision-loop and overseer convergence for slot-aligned booking replies is still required in 146d/146g2 follow-on work.
3. Admin governance surfaces (dual-approval publish, workspace tuning UI, rollout controls) remain pending for 146g2/146g3.

## Multi-Agent Coordination Note

- Repo remains a multi-agent dirty tree with overlapping AI/message edits from active phases 141-146.
- This execution constrained code changes to replay-specific surfaces (`lib/ai-replay/*`, `scripts/live-ai-replay.ts`) and phase-146 docs to reduce cross-phase merge risk.
