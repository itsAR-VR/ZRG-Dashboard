# Phase 112d — Enterprise Confidence System (Telemetry Metadata + Calibration Runs + Proposals + Audit/Rollback)

## Focus
Implement the "enterprise-grade" confidence governance loop for AI gating decisions:
- **Telemetry metadata plumbing** (`AIInteraction.metadata`) so we can observe bundle composition + truncation without PII.
- **DB-backed calibration runs** (no filesystem artifacts) that compute evidence-based recommendations.
- **DB-backed proposals + approvals + apply + rollback** for thresholds/budgets, gated by super-admin.

This phase is backend-first; the UI control plane is 112g.

**Execution note**: This subphase is split into two execution chunks:
1. **112d-schema** (runs before 112b): Prisma changes (`AIInteraction.metadata`, confidence models) + telemetry plumbing (`recordInteraction`/`trackAiCall`/runner metadata threading) + `sanitizeMetadata()`.
2. **112d-calibration** (runs after 112c): Calibration runner + proposal workflow actions.

## Inputs
- Telemetry:
  - `lib/ai/openai-telemetry.ts` (`recordInteraction`)
  - `lib/ai/prompt-runner/types.ts`
  - `lib/ai/prompt-runner/runner.ts`
  - `prisma/schema.prisma` (`AIInteraction`)
- Existing “enterprise eval → proposals → apply → revision history” pattern:
  - `lib/message-performance-eval.ts`
  - `actions/message-performance-eval-actions.ts`
  - `actions/message-performance-proposals.ts`
  - `MessagePerformanceEvalRun`, `MessagePerformanceProposal`, `PromptOverrideRevision`, `KnowledgeAssetRevision`
- Domains that consume confidence thresholds:
  - Auto-send evaluator: `lib/auto-send-evaluator.ts`, `lib/auto-send-evaluator-input.ts`
  - Meeting overseer: `lib/meeting-overseer.ts`
  - Followup auto-booking: `lib/followup-engine.ts`
- Auth helpers:
  - `lib/workspace-access.ts` (`requireClientAdminAccess`, `isTrueSuperAdminUser`)

## Decisions (Locked 2026-02-06)
- Telemetry must be **stats-only** (no raw message bodies, no unredacted memory, no knowledge asset contents).
- Calibration runs and proposals are **stored in DB** (no local `scripts/` datasets).
- Threshold/budget changes are **never auto-applied**:
  - approval step (workspace admin OK)
  - apply/rollback step (super-admin only)

## Work
1. Add `AIInteraction.metadata` (telemetry foundation) — **112d-schema chunk**
   - Prisma: add `metadata Json?` to `model AIInteraction`.
   - No backfill required; older rows keep `metadata=null`.
   - **Full metadata threading path** (all links must accept optional `metadata`):
     1. Caller builds metadata object (e.g. `{ leadContextBundle: bundle.stats }`)
     2. Passes to prompt runner via opts: `runPrompt({ ..., metadata })`
     3. Runner passes to `trackAiCall({ ..., metadata })` in `lib/ai/openai-telemetry.ts`
     4. `trackAiCall` passes to private `recordInteraction({ ..., metadata })`
     5. `recordInteraction` calls `sanitizeMetadata(metadata)` then persists via Prisma create
   - **Add `sanitizeMetadata()` function** in `lib/ai/openai-telemetry.ts`:
     - Allowlisted top-level keys: `leadContextBundle`, `followupParse`, `bookingGate`
     - Strip any key not in allowlist; strip any value that is a string longer than 200 chars (catches accidental raw text)
     - Hard rule: never persist raw text into metadata
     - Add unit tests for `sanitizeMetadata`: rejects unknown keys, truncates long strings, passes valid stats

2. Add DB models for confidence governance (enterprise-grade) — **112d-schema chunk**
   - Add these Prisma models (naming can be adjusted for consistency):
     - `ConfidenceCalibrationRun`
     - `ConfidencePolicy`
     - `ConfidencePolicyProposal`
     - `ConfidencePolicyRevision`
   - Required behaviors:
     - `ConfidenceCalibrationRun` stores:
       - window/time range, status, model/version, computedBy, output metrics snapshot (Json), error (Text)
       - counts (samples, proposalsCreated)
     - `ConfidencePolicy` stores the active config per workspace and per policy key (Json config).
     - `ConfidencePolicyProposal` stores recommended changes + evidence Json, with approval/apply timestamps + actors.
     - `ConfidencePolicyRevision` stores immutable audit snapshots on apply/rollback (mirrors prompt/asset revision patterns).
   - Indexing:
     - `@@index([clientId])` for all, and `@@index([status])` for runs/proposals.
     - **Compound indexes for calibration queries**: `@@index([clientId, createdAt])` on `AIInteraction`, `AIDraft`, and `MeetingOverseerDecision` (needed by calibration runner in step 4).
     - Uniqueness:
       - `ConfidencePolicy` unique per `(clientId, policyKey)`.

3. Implement policy resolution helper (runtime read path) — **112d-schema chunk**
   - Create `lib/confidence-policy.ts` (planned) with a narrow API:
     - `getConfidencePolicy(clientId, policyKey)` → returns config (or defaults).
     - `resolveThreshold(clientId, policyKey, field)` → returns number with fallback.
   - Do not add caching until correctness is proven; DB reads are acceptable for v1.

4. Implement calibration runner (DB-only artifacts) — **112d-calibration chunk**
   - Create `lib/confidence-calibration.ts` (planned) similar to `lib/message-performance-eval.ts`.
   - Input: `clientId`, `windowFrom`, `windowTo`, optional feature scope.
   - Data sources (no raw text persistence):
     - Auto-send: `AIDraft.autoSendConfidence/Action/Threshold` + outcomes derived from next inbound sentiment (existing tables).
     - Overseer: `MeetingOverseerDecision.confidence` + decision rates.
     - Followup auto-book: booking outcomes + parse confidence (derived; see 112f for metadata).
   - Output:
     - store aggregated calibration curves (buckets) + “recommended thresholds” in `ConfidenceCalibrationRun.output`.
     - generate `ConfidencePolicyProposal` rows with evidence (stats + bucket deltas), not raw messages.

5. Implement proposal workflow (approve/apply/rollback) — **112d-calibration chunk**
   - Create `actions/confidence-policy-actions.ts` (planned) mirroring `actions/message-performance-proposals.ts`:
     - `listConfidencePolicyProposals(clientId)` (workspace admin can view)
     - `approveConfidencePolicyProposal(clientId, proposalId)` (workspace admin)
     - `rejectConfidencePolicyProposal(clientId, proposalId)` (workspace admin)
     - `applyConfidencePolicyProposal(clientId, proposalId)` (super-admin only)
     - `rollbackConfidencePolicyRevision(clientId, revisionId)` (super-admin only)
   - Apply behavior:
     - Upsert the `ConfidencePolicy` row.
     - Write a `ConfidencePolicyRevision` with `action="APPLY_PROPOSAL"`.
     - Mark proposal as `APPLIED` with actor/timestamps.
   - Rollback behavior:
     - Revert `ConfidencePolicy.config` to a selected prior revision snapshot.
     - Write a new revision with `action="ROLLBACK"`.

6. Validation (RED TEAM)
   - Prisma:
     - `npm run db:push` (against the correct DB).
     - Verify tables/columns exist, and old AIInteraction rows still query with `metadata=null`.
   - Safety:
     - Add unit tests for:
       - metadata allowlist enforcement (no raw text keys)
       - proposal apply/rollback creating revisions
   - Performance:
     - Ensure calibration queries are windowed and indexed; add indexes as needed before UI lands.

## Output
- `AIInteraction.metadata` exists and can store stats-only metadata.
- DB models exist for calibration runs + confidence policies + proposals + revisions.
- Server actions exist for listing/approving/applying/rolling back confidence proposals.

## Handoff
112e defines rollout/killswitch controls; 112f wires thresholds + booking gate into `lib/followup-engine.ts`; 112g adds the super-admin control plane UI to run calibration and manage proposals.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented confidence policy resolution + defaults (`lib/confidence-policy.ts`).
  - Implemented deterministic calibration runner with bootstrap proposals (`lib/confidence-calibration.ts`).
  - Added server actions for calibration runs (`actions/confidence-calibration-actions.ts`).
  - Added server actions for proposals + apply/rollback + revision history (`actions/confidence-policy-actions.ts`).
  - Added unit tests for policy config coercion/resolution (`lib/__tests__/confidence-policy.test.ts`) and wired into `scripts/test-orchestrator.ts`.
  - Fixed a Next.js typecheck failure in bundle builder fetch path (replaced dynamic Prisma select with two typed queries) (`lib/lead-context-bundle.ts`).
- Commands run:
  - `npm test` — pass
  - `npm run build` — pass
  - `npm run lint` — pass (warnings only)
- Blockers:
  - None
- Next concrete steps:
  - Wire control plane UI surfaces to these actions (Phase 112g).
  - Use `resolveThreshold(...)` for followup auto-book threshold (Phase 112f).
