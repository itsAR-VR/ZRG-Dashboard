# Phase 112 — Shared LeadContextBundle + Enterprise Confidence Calibration (Drafting, Overseer, Auto-Send, Followups)

## Purpose
Unify AI context assembly into one shared **LeadContextBundle** so drafting, meeting overseer, auto-send evaluation, and followup/booking gates all see consistent verified workspace context + lead memory policy. Add an **enterprise-grade** confidence calibration + policy management loop (proposals, approvals, audit log, rollback) with a super-admin control plane section in Settings.

## Summary (Decisions Locked 2026-02-06)
- Shared bundle serialization: **plain-text sections** (Markdown-friendly); no JSON-as-canonical.
- Auto-send evaluator includes **redacted** lead memory.
- **Drafting memory is unredacted** (`draft` profile uses `redact: false`; all other profiles use `redact: true`).
- Meeting overseer **extraction stays lean** (no memory); gate uses memory.
- Rollout: **DB-backed per-workspace toggle (super-admin only)** + **env kill-switch**.
- Telemetry sink: **AIInteraction metadata** (requires schema + plumbing).
- Followup-engine is **in-scope now**: bundle injection + configurable thresholds + booking gate.
- Threshold/budget changes are **never auto-applied**: generate proposals, approve/apply in UI, audit + rollback.
- Control plane visibility: **super-admin only**.
- Confidence policy scope: **per-feature policies** (auto-send vs followup auto-book vs overseer).
- **Execution order** (reordered for dependency correctness): 112a → 112d-schema → 112b → 112c → 112d-calibration → 112e → 112f → 112g.

## Context
Repo reality (as of 2026-02-06): the “multi-agent” system is implemented as a multi-step prompt pipeline (planner/writer/verifier/gate) plus deterministic orchestrators, not a generic supervisor framework.

Key runtime components:
- Draft generation: `lib/ai-drafts.ts` (`generateResponseDraft`) + Step 3 verifier (`draft.verify.email.step3.v1`).
- Meeting overseer: `lib/meeting-overseer.ts` with:
  - Extract: `meeting.overseer.extract.v1`
  - Gate: `meeting.overseer.gate.v1`
  - Persistence: `MeetingOverseerDecision` in `prisma/schema.prisma`
- Auto-send:
  - Orchestrator: `lib/auto-send/orchestrator.ts`
  - Evaluator: `lib/auto-send-evaluator.ts` + input builder `lib/auto-send-evaluator-input.ts`
- Followup/booking automation:
  - Proposed-times parse: `lib/followup-engine.ts` (`parseProposedTimesFromMessage`)
  - Auto-book flow uses overseer extraction and confidence gates.

## Concurrent Phases
| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Working tree | Check at execution time | Whatever `git status` shows | Do not mix unrelated changes into Phase 112; if shared surfaces (`prisma/schema.prisma`, `lib/ai/*`, `lib/followup-engine.ts`) are already modified, reconcile intent first. |
| Phase 108 | Shipped | Overseer/memory/eval themes | Build on existing primitives (lead memory, message-performance eval). Avoid re-introducing parallel context builders. |
| Phase 107 | Shipped | Auto-send evaluator context builder | Preserve `auto_send.evaluate.v1` behavior + prompt override compatibility; integrate changes via shared context bundle. |
| Phase 106 | Shipped | Meeting overseer semantics + persistence | Preserve scheduling semantics; gate remains enforcement point. |
| Phase 109 | Shipped | Meeting overseer made non-fatal for draft creation | Preserve non-fatal behavior (gate failures must not block draft creation). |
| Phase 110 | Shipped | Followup-engine idempotency + disposition persistence | Re-read `lib/followup-engine.ts` before edits; preserve idempotency/disposition fixes and existing cron invariants. |

## Repo Reality Check (Current, Verified 2026-02-06)
- Context primitives exist (token/byte budgeting):
  - `lib/knowledge-asset-context.ts` (`buildKnowledgeContextFromAssets`)
  - `lib/lead-memory-context.ts` (`getLeadMemoryContext({ redact })`)
- Shared bundle builder exists:
  - `lib/lead-context-bundle.ts` (`buildLeadContextBundle`)
- Bundle is wired (gated + safe fallback):
  - Drafting: `lib/ai-drafts.ts` (uses bundle when enabled; legacy slice path remains as fallback)
  - Meeting overseer: `lib/meeting-overseer.ts` (gate consumes bundle memory; extraction remains lean)
  - Auto-send evaluator: `lib/auto-send-evaluator.ts`, `lib/auto-send-evaluator-input.ts` (additive `lead_memory_context`)
  - Followups/booking: `lib/followup-engine.ts` (bundle injection + booking gate when enabled)
- Telemetry foundation exists:
  - Prisma: `AIInteraction.metadata Json?` (`prisma/schema.prisma`)
  - Metadata threading: `lib/ai/prompt-runner/*` → `lib/ai/openai-telemetry.ts`
  - Stats-only allowlist: `sanitizeAiInteractionMetadata()` in `lib/ai/openai-telemetry.ts`
- Followup prompts are registry-backed (override-compatible):
  - `lib/ai/prompt-registry.ts` (`followup.parse_proposed_times.v1`, `followup.booking.gate.v1`)
- Rollout + control plane exists (super-admin only):
  - Rollout actions: `actions/lead-context-bundle-rollout-actions.ts`
  - Confidence actions: `actions/confidence-policy-actions.ts`, `actions/confidence-calibration-actions.ts`
  - Per-call inspector actions: `actions/ai-interaction-inspector-actions.ts`
  - UI: `components/dashboard/confidence-control-plane.tsx` (mounted via `components/dashboard/admin-dashboard-tab.tsx`)
- Confidence governance schema exists:
  - Prisma: `Confidence*` models + `WorkspaceSettings` rollout fields (`prisma/schema.prisma`)

## Objectives
1. Define `LeadContextBundle` contract (format, redaction, budgets, injection mapping).
2. Implement shared bundle builder and remove duplicated context assembly across:
   - drafting (`lib/ai-drafts.ts`)
   - meeting overseer gate (`lib/meeting-overseer.ts` call site)
   - auto-send evaluator (`lib/auto-send-evaluator-input.ts`)
   - followup-engine parsing + booking gate (`lib/followup-engine.ts`)
3. Add bundle composition telemetry (stats-only: tokens/bytes/truncation) and make it queryable in the admin UI.
4. Add enterprise confidence calibration + policy management:
   - calibration runs stored in DB
   - proposals generated from evidence
   - super-admin approve/apply
   - audit log + rollback
5. Add super-admin control plane section in Settings to:
   - enable/disable bundle per workspace
   - tune budgets/thresholds
   - run calibration on-demand
   - review/apply/rollback proposals
   - inspect per-call telemetry (stats-only)

## Scope
In scope:
- Drafting: `lib/ai-drafts.ts`
- Meeting overseer: `lib/meeting-overseer.ts` (gate only; extraction stays lean)
- Auto-send evaluator: `lib/auto-send-evaluator.ts`, `lib/auto-send-evaluator-input.ts`
- Followup engine + booking automation: `lib/followup-engine.ts` (context injection + booking gate)
- Telemetry: `lib/ai/openai-telemetry.ts`, prompt runner plumbing, `AIInteraction` schema
- Settings / admin UI: `components/dashboard/settings-view.tsx` and a new super-admin control plane component
- New schema + actions for confidence policies/proposals/calibration

Out of scope:
- Prompt key bumps for existing prompts (no `auto_send.evaluate.v2`).
- Storing raw message bodies or unredacted lead memory in telemetry or calibration artifacts.
- Auto-applying threshold changes.

## Constraints
- Multi-tenant safety: never mix data across `clientId`.
- PII hygiene:
  - never log raw message bodies/memory
  - lead memory injected to LLMs is **redacted for all profiles except drafting** (`draft` profile uses `redact: false` to match current behavior)
- Prompt override compatibility:
  - keep `auto_send.evaluate.v1` key and evaluator top-level keys stable
- Preserve "no default to website" behavior:
  - keep `Primary: Website URL` out of generic `knowledge_context`
- Performance:
  - shared builder should accept preloaded settings/assets when available (avoid extra queries)
  - **bundle builder must complete within 500ms**; fall back to pre-existing path on timeout
  - AI calls: explicit budgets + timeouts; bounded retries
- If schema changes: **must** run `npm run db:push`.

## RED TEAM Findings (Gaps / Weak Spots) — Updated 2026-02-06

### Highest-risk failure modes
- **PII leakage** via telemetry/calibration artifacts → enforce **stats-only** `AIInteraction.metadata` (allowlisted keys only via `sanitizeMetadata()` function), and store only redacted/minimized evidence in calibration runs/proposals.
- **Silent behavior regressions** in `auto_send.evaluate.v1` → keep prompt key stable and preserve evaluator payload keys; add regression tests that assert the key set.
- **Token budget regression** (evaluator sees less verified context than before) → per-profile budgets with defaults matching current evaluator (8000/1600), plus telemetry to detect truncation spikes.
- **Bundle builder failures block core flows** → bundle build must be best-effort with hard fallback to pre-existing context assembly; never block draft creation or booking decisions. Log failures at WARN level.
- **Unauthorized policy/toggle changes** → server-side `isTrueSuperAdminUser` enforcement for apply/toggles; approvals can be workspace-admin, but apply/rollback is super-admin only.
- **Drafting token overflow** — switching from `slice(0, 1000)` to token-budgeted knowledge can pass **more** context to drafting prompts → mitigate via profile budgets (current) and add an explicit cap at injection point if we observe context-length failures.
- **Metadata threading gap** — `recordInteraction` is a private function in `openai-telemetry.ts`, called via `trackAiCall`. Full path: caller → prompt runner opts → `trackAiCall` opts → `recordInteraction` opts → Prisma create. All links must accept optional `metadata`.

### Migration / rollback risks
- `AIInteraction.metadata` + confidence policy tables require Prisma changes → include `db:push`, verification queries, and a rollback plan (revert to prior revision + env kill-switch).

### Followup booking safety risk
- Auto-booking currently uses a hardcoded `HIGH_CONFIDENCE_THRESHOLD = 0.9` (at `followup-engine.ts:3023`) → move to policy/settings and add a booking gate step before booking when enabled.

### Inline→registry migration risk (followup)
- `followup.parse_proposed_times.v1` is now registry-backed (override-compatible). Before enabling overrides widely, confirm no unexpected `PromptOverride` rows exist for this key.

### Calibration query performance
- Calibration runner queries `AIInteraction`, `AIDraft`, `MeetingOverseerDecision` across time windows. Compound indexes `@@index([clientId, createdAt])` are required and are included in `prisma/schema.prisma`.

### Repo mismatches (resolved)
- `AIInteraction.metadata Json?` exists (stats-only) and is written via allowlisted sanitizer (`lib/ai/openai-telemetry.ts`).
- Followup prompts are in the prompt registry (`lib/ai/prompt-registry.ts`).
- Prompt runner threads optional `metadata` end-to-end (`lib/ai/prompt-runner/*`).

## Success Criteria
- [x] Drafting, meeting overseer gate, auto-send evaluator, and followup-engine all source knowledge + memory from the same LeadContextBundle builder.
- [x] Each `AIInteraction` row includes stats-only metadata describing bundle composition and truncation.
- [x] Auto-send evaluator input includes redacted lead memory and preserves existing keys:
  - `service_description`, `goals`, `knowledge_context`, `verified_context_instructions`
- [x] Followup-engine auto-book decisions are gated by a booking gate when enabled, and thresholds are configurable (no hardcoded 0.9).
- [x] Super-admin control plane exists inside Settings with:
  - per-workspace enable/disable
  - on-demand calibration runs
  - proposal approve/apply/rollback
  - per-call telemetry inspector
- [x] `npm run lint`, `npm run build`, `npm test` pass; `npm run db:push` is in sync. (Verified 2026-02-06)

## Data Model / Interfaces

### Prisma changes (shipped)
- `AIInteraction`: `metadata Json?` for stats-only telemetry.
- `WorkspaceSettings`: shared-bundle toggles + budgets + followup gate toggle (super-admin controlled).
- Confidence governance models (enterprise-grade, DB-only artifacts):
  - `ConfidenceCalibrationRun` (results stored in DB; no filesystem artifacts)
  - `ConfidencePolicy`
  - `ConfidencePolicyProposal`
  - `ConfidencePolicyRevision` (audit + rollback)

### Prompt keys (shipped)
- `followup.parse_proposed_times.v1` is registered in `lib/ai/prompt-registry.ts` (override-compatible).
- `followup.booking.gate.v1` is registered in `lib/ai/prompt-registry.ts` (booking gate).

## Subphase Index (Execution Order)

Execution order is reordered so 112d-schema lands before 112b (which needs telemetry plumbing):

1. **a** — Contract: LeadContextBundle spec (format, redaction, budgets, injection mapping)
2. **d-schema** — Telemetry foundation: `AIInteraction.metadata Json?` + prompt runner/`trackAiCall`/`recordInteraction` metadata threading + `sanitizeMetadata()` allowlist
3. **b** — Build + wire: drafting + meeting overseer gate (shared builder; remove ad-hoc slicing)
4. **c** — Build + wire: auto-send evaluator (include redacted memory; preserve payload keys)
5. **d-calibration** — Confidence governance: DB models + calibration runner + proposal workflow actions
6. **e** — Rollout & monitoring: env kill switch + DB toggles + safety fallbacks
7. **f** — Followup-engine: context injection + configurable thresholds + booking gate
8. **g** — Super-admin control plane UI (new `confidence-control-plane.tsx` in admin-dashboard-tab): overview + per-call inspector + proposal workflow

## Assumptions (Agent)
- Proposal approvals can be performed by **workspace admins**, but **apply/rollback** is **super-admin only** (mirrors `MessagePerformanceProposal` workflow). (confidence ~90%)
  - Mitigation check: if you want "super-admin approve only", update the actions to require `isTrueSuperAdminUser` for approve/reject too.
- Drafting memory is **unredacted** (`draft` profile uses `redact: false`) to match current `ai-drafts.ts:1362` behavior. (confidence 100% — user decision)
- Super-admin control plane UI lives in a **new `confidence-control-plane.tsx` component** rendered inside `admin-dashboard-tab.tsx`, NOT in `settings-view.tsx` (which is already 338KB). (confidence ~90%)
- `npm test` exists and runs via `node --import tsx scripts/test-orchestrator.ts`. (confidence 100% — verified)

## Phase Summary (running)
- 2026-02-06 — Implemented confidence calibration + proposal workflow actions, rollout toggles actions, followup booking gate + policy threshold resolution, and super-admin control plane + AIInteraction inspector. (files: `lib/confidence-policy.ts`, `lib/confidence-calibration.ts`, `actions/confidence-calibration-actions.ts`, `actions/confidence-policy-actions.ts`, `actions/lead-context-bundle-rollout-actions.ts`, `lib/followup-engine.ts`, `lib/ai/prompt-registry.ts`, `components/dashboard/confidence-control-plane.tsx`, `actions/ai-interaction-inspector-actions.ts`, `components/dashboard/admin-dashboard-tab.tsx`)
- 2026-02-06 — Verified quality gates and updated Phase 112 plan docs to match repo reality; wrote post-implementation review. (files: `docs/planning/phase-112/plan.md`, `docs/planning/phase-112/review.md`)

## Open Questions (Need Human Input)

- [x] Booking gate scope: run for **Scenario 1 + 2 + 3** (accept offered slots + proposed-time matches + day-only booking), with a single retry on `needs_clarification`, then fallback to task + Slack alert.
  - Follow-up implementation plan: `docs/planning/phase-113/plan.md`
- [x] Confidence policy proposals: **workspace admin** can approve/reject; **true super-admin** can apply/rollback.
- [x] Followup parse/gate telemetry writes: keep the **post-call `AIInteraction` metadata update** for now (stats-only).

## Phase Summary

- Shipped:
  - Shared `LeadContextBundle` builder with profile-based redaction + budgets (`lib/lead-context-bundle.ts`) wired into drafting, overseer gate, auto-send evaluator, followup parse + booking gate.
  - Stats-only telemetry persisted to `AIInteraction.metadata` with allowlisted sanitizer and prompt-runner plumbing.
  - Confidence governance models + calibration runner + proposal/apply/rollback actions, plus super-admin control plane UI + per-call inspector.
- Verified (2026-02-06):
  - `npm run lint`: pass (warnings only)
  - `npm test`: pass
  - `npm run build`: pass
  - `npm run db:push`: pass (already in sync)
- Notes:
  - See `docs/planning/phase-112/review.md` for success-criteria evidence and follow-ups.
