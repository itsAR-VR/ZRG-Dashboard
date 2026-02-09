# Phase 127b — Agent Output + Approval Logic

## Focus
Extend the revision outputs to include bounded memory proposals, implement an explicit approval gate (allowlist + thresholds, TTL cap), persist loop observability artifacts with clear stop reasons, and surface governance + observability in the Settings → Admin UI (Super Admin only).

## Inputs
- Phase 123 loop + artifacts:
  - `lib/auto-send/orchestrator.ts`
  - `lib/auto-send/revision-agent.ts`
  - `lib/draft-pipeline/types.ts`
  - `lib/draft-pipeline/validate-payload.ts`
- Durable memory:
  - `LeadMemoryEntry`, `WorkspaceMemoryEntry` + helpers (`lib/lead-memory-context.ts`, new helpers/actions)
- Settings/Admin UI patterns:
  - `components/dashboard/settings-view.tsx`
  - `components/dashboard/admin-dashboard-tab.tsx`
  - `components/dashboard/confidence-control-plane.tsx` (Super Admin gating)
  - `actions/access-actions.ts` (`getGlobalAdminStatus`)

## Work
1. Update revision prompt output schema (strict JSON) to include `memory_proposals`:
   - Add optional `memory_proposals: MemoryProposal[]` (bounded arrays, bounded strings).
   - Each proposal includes `scope: "lead" | "workspace"`.
   - Apply minimal scrub before persistence:
     - scrub emails + phone numbers
     - URLs allowed
   - Enforce bounds:
     - max proposals per revision (e.g., 10)
     - max category length (e.g., 64)
     - max content length (500)
     - ttlDays must be finite int > 0
2. Approval gate (fail-closed):
   - Allowlist categories are **UI-configurable** per workspace (stored in `WorkspaceSettings.memoryAllowlistCategories`).
   - Seed initial allowlist in code (recommended defaults):
     - `timezone_preference`
     - `scheduling_preference`
     - `communication_preference`
     - `availability_pattern`
   - Auto-approve only if:
     - category in allowlist
     - `ttlDays >= WorkspaceSettings.memoryMinTtlDays` (default 1)
     - `confidence >= WorkspaceSettings.memoryMinConfidence` (default 0.7)
   - TTL cap:
     - effective ttlDays = `min(proposedTtlDays, WorkspaceSettings.memoryTtlCapDays)` (default 90)
   - Otherwise persist as `PENDING` for Super Admin review UI.
3. Persistence:
   - Approved/Pending proposals are written to:
     - `LeadMemoryEntry` when `scope="lead"` (requires `leadId`)
     - `WorkspaceMemoryEntry` when `scope="workspace"`
   - Common fields:
     - `source = INFERENCE`
     - `status = APPROVED | PENDING`
     - `expiresAt = now + effectiveTtlDays`
     - provenance: `proposedByDraftPipelineRunId`, `proposedByDraftId` when available
   - Always persist proposals as `DraftPipelineArtifact` stage `memory_proposal` with:
     - `{ approvedCount, pendingCount, proposals: redactedProposals[] }`
     - enforce 32KB cap via `validateArtifactPayload()`
4. Loop observability:
   - In orchestrator, persist `DraftPipelineArtifact` stage `auto_send_revision_loop` with:
     - stopReason (`threshold_met`, `hard_block`, `no_improvement`, `timeout`, `exhausted`, `error`)
     - iterationsUsed
     - startConfidence/endConfidence
     - deltaConfidence
     - cacheHits (count of reused artifacts)
     - elapsedMs
     - threshold used (campaign threshold or default)
   - Also record a stats-only `AIInteraction` event for the loop summary (no raw message/draft text).
5. Evaluator model selection (UI + env fallbacks):
   - Update `lib/auto-send-evaluator.ts` to use:
     - WorkspaceSettings overrides if present (`autoSendEvaluatorModel`, `autoSendEvaluatorReasoningEffort`)
     - else env vars (`AUTO_SEND_EVALUATOR_MODEL`, `AUTO_SEND_EVALUATOR_REASONING_EFFORT`)
     - else keep current defaults (`gpt-5-mini`, `low`)
6. Settings → Admin UI (Super Admin only):
   - Add a “Memory Governance” panel:
     - edit allowlist categories (String[])
     - edit thresholds (min confidence, min ttl, ttl cap)
     - list PENDING LeadMemoryEntry + WorkspaceMemoryEntry
     - approve/reject actions
   - Add an “Auto-Send Loop Observability” panel:
     - list recent loop summaries for this workspace
     - show stopReason, iterationsUsed, confidence delta, cache hits, elapsed time
     - optional drilldown: view the underlying run artifact JSON (read-only)
   - Add a “Model Policy” section:
     - view/edit `autoSendRevisionModel` + effort (already in WorkspaceSettings)
     - view/edit evaluator model + effort
   - Server actions must enforce super-admin auth (`isGlobalAdminUser`), not client-only gating.

## Validation (RED TEAM)
- Unit tests:
  - Allowlist approval logic (approve vs pending).
  - TTL enforcement (reject ttlDays<=0).
  - Proposal redaction (emails/phones scrubbed; URLs allowed).
  - Loop stopReason correctness across branches.
- Server action tests (or integration tests) for approve/reject endpoints (Super Admin gating).
- `npm test` passes.

## Output
- Memory governance (policy + redaction + persistence):
  - `lib/memory-governance/types.ts`
  - `lib/memory-governance/redaction.ts`
  - `lib/memory-governance/policy.ts`
  - `lib/memory-governance/persist.ts`
- Revision agent now emits + persists governed memory proposals (best-effort; bounded JSON):
  - `lib/auto-send/revision-agent.ts` (parses `memory_proposals`, applies policy gate, writes `DraftPipelineArtifact` stage `memory_proposal`)
  - `lib/ai/prompt-registry.ts` (updates `AUTO_SEND_REVISE_SYSTEM` schema expectations)
- Evaluator model selection (WorkspaceSettings override + env fallback):
  - `lib/auto-send/evaluator-config.ts`
  - `lib/auto-send-evaluator.ts`
- Loop observability summary persisted per run:
  - `lib/auto-send/loop-observability.ts` (writes `DraftPipelineArtifact` stage `auto_send_revision_loop` + stats-only `AIInteraction`)
  - `lib/auto-send/orchestrator.ts` (computes stopReason/iterations/delta/cacheHits/elapsed)
- Super Admin Settings → Admin surfaces:
  - `actions/memory-governance-actions.ts` (policy CRUD + pending approve/reject)
  - `actions/auto-send-loop-observability-actions.ts` (list recent loop summaries)
  - `components/dashboard/confidence-control-plane.tsx` (Memory Governance + Loop Observability panels)
- Lead context bundle now includes ONLY approved memory (lead + workspace):
  - `lib/lead-memory-context.ts`

## Handoff
Phase 127c:
- Add pruning/retention hooks in `/api/cron/background-jobs` (run/artifact retention + expired inferred memory TTL cleanup).
- Ensure tests cover governance + observability + pruning and are wired into `npm test`.
- Update docs (README env var table) and run full quality gates (`npm test`, `npm run lint`, `npm run build`).

## Progress This Turn (Terminus Maximus)
- Work done:
  - Verified Phase 127b wiring: revision agent outputs `memory_proposals`, proposals are policy-gated + persisted, and artifacts are recorded for auditability.
  - Verified loop observability persistence and evaluator model selection.
- Commands run:
  - `npm test` — pass
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Blockers:
  - None
- Next concrete steps:
  - Complete Phase 127c plan + write `docs/planning/phase-127/review.md` with evidence.
