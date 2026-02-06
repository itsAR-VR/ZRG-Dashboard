# Phase 112 — Shared LeadContextBundle + Enterprise Confidence Calibration (Drafting, Overseer, Auto-Send, Followups)

## Purpose
Unify AI context assembly into one shared **LeadContextBundle** so drafting, meeting overseer, auto-send evaluation, and followup/booking gates all see consistent verified workspace context + lead memory policy. Add an **enterprise-grade** confidence calibration + policy management loop (proposals, approvals, audit log, rollback) with a super-admin control plane section in Settings.

## Summary (Decisions Locked 2026-02-06)
- Shared bundle serialization: **plain-text sections** (Markdown-friendly); no JSON-as-canonical.
- Auto-send evaluator includes **redacted** lead memory.
- Meeting overseer **extraction stays lean** (no memory); gate uses memory.
- Rollout: **DB-backed per-workspace toggle (super-admin only)** + **env kill-switch**.
- Telemetry sink: **AIInteraction metadata** (requires schema + plumbing).
- Followup-engine is **in-scope now**: bundle injection + configurable thresholds + booking gate.
- Threshold/budget changes are **never auto-applied**: generate proposals, approve/apply in UI, audit + rollback.

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
| Working tree | Uncommitted changes present | `package.json`, `package-lock.json`, `next.config.mjs`, new Sentry example files | Treat as unrelated; do not mix into Phase 112 implementation without explicit intent. |
| Phase 108 | Shipped | Overseer/memory/eval themes | Build on existing primitives (lead memory, message-performance eval). Avoid re-introducing parallel context builders. |
| Phase 107 | Shipped | Auto-send evaluator context builder | Preserve `auto_send.evaluate.v1` behavior + prompt override compatibility; integrate changes via shared context bundle. |
| Phase 106 | Shipped | Meeting overseer semantics + persistence | Preserve scheduling semantics; gate remains enforcement point. |
| Phase 109 | Shipped | Meeting overseer made non-fatal for draft creation | Preserve non-fatal behavior (gate failures must not block draft creation). |

## Repo Reality Check (Verified 2026-02-06)
- Context builders exist:
  - `lib/knowledge-asset-context.ts` (`buildKnowledgeContextFromAssets`, token/byte budgeting)
  - `lib/lead-memory-context.ts` (`getLeadMemoryContext({ redact })`, token/byte budgeting)
- Drafting still uses ad-hoc asset slicing in `lib/ai-drafts.ts` (not token-budgeted).
- Meeting overseer gate already accepts `memoryContext`; extraction does not.
- Auto-send evaluator input is built in `lib/auto-send-evaluator-input.ts` and currently excludes memory.
- Telemetry table `AIInteraction` exists but has **no `metadata` field** yet (`prisma/schema.prisma:model AIInteraction`).
- Super-admin helper exists: `lib/workspace-access.ts` (`isTrueSuperAdminUser`).
- Settings has an Admin tab and an admin dashboard component:
  - `components/dashboard/settings-view.tsx`, `components/dashboard/admin-dashboard-tab.tsx`
- Existing proposal + revision workflow exists (message performance) and can be mirrored:
  - `actions/message-performance-proposals.ts`, `PromptOverrideRevision`, `KnowledgeAssetRevision`

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
  - lead memory injected to LLMs is **always redacted**
- Prompt override compatibility:
  - keep `auto_send.evaluate.v1` key and evaluator top-level keys stable
- Preserve “no default to website” behavior:
  - keep `Primary: Website URL` out of generic `knowledge_context`
- Performance:
  - shared builder should accept preloaded settings/assets when available (avoid extra queries)
  - AI calls: explicit budgets + timeouts; bounded retries
- If schema changes: **must** run `npm run db:push`.

## Success Criteria
1. Drafting, meeting overseer gate, auto-send evaluator, and followup-engine all source knowledge + memory from the same LeadContextBundle builder.
2. Each `AIInteraction` row includes stats-only metadata describing bundle composition and truncation.
3. Auto-send evaluator input includes redacted lead memory and preserves existing keys:
   - `service_description`, `goals`, `knowledge_context`, `verified_context_instructions`
4. Followup-engine auto-book decisions are gated by a booking gate when enabled, and thresholds are configurable (no hardcoded 0.9).
5. Super-admin control plane exists inside Settings with:
   - per-workspace enable/disable
   - on-demand calibration runs
   - proposal approve/apply/rollback
   - per-call telemetry inspector
6. `npm run lint`, `npm run build`, `npm test` pass. If schema changed, `npm run db:push` completed.

## Data Model / Interfaces

### Prisma changes (planned)
- `AIInteraction`: add `metadata Json?` for stats-only telemetry.
- `WorkspaceSettings`: add shared-bundle toggles + budgets + followup gate toggles/thresholds (super-admin controlled).
- Confidence governance models (enterprise-grade):
  - `ConfidenceCalibrationRun` (results stored in DB; no filesystem artifacts)
  - `ConfidencePolicy`
  - `ConfidencePolicyProposal`
  - `ConfidencePolicyRevision` (audit + rollback)

### Prompt keys (planned)
- Add `followup.parse_proposed_times.v1` to `lib/ai/prompt-registry.ts` so it supports overrides and stable telemetry.
- Add `followup.booking.gate.v1` (new) for the booking gate.

## Subphase Index
* a — Contract: LeadContextBundle spec (format, redaction, budgets, injection mapping)
* b — Build + wire: drafting + meeting overseer gate (shared builder; remove ad-hoc slicing)
* c — Build + wire: auto-send evaluator (include redacted memory; preserve payload keys)
* d — Enterprise confidence system: telemetry metadata + calibration runs + proposals + audit/rollback
* e — Rollout & monitoring: env kill switch + DB toggles + safety fallbacks
* f — Followup-engine: context injection + configurable thresholds + booking gate
* g — Super-admin control plane UI (Settings): overview + per-call inspector + proposal workflow
