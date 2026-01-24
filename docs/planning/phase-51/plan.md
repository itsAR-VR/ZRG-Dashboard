# Phase 51 — Automation Drift Hardening (Inbound Kernel + Prompt Runner + Email Send Unification)

## Purpose

Reduce "agentic drift" and subtle automation regressions by eliminating high-risk structural duplication in the inbound pipelines, email send pipelines, and LLM JSON-schema call wrappers that power auto-booking, drafts, and auto-send.

## Context

Over the last ~15 phases (Phase 36–50), we shipped a lot of automation surface area: multi-channel inbound ingestion, AI drafts, auto-send, follow-up logic, booking parsing, and an editable prompt system. The code works, but the "same orchestration spine" exists in multiple places with small operator differences.

The structural duplication audit report (`docs/audits/structural-duplication-2026-01-22.md`) found three high-leverage duplication groups:

- **Group A — Inbound post-processing pipelines**: `lib/background-jobs/*-inbound-post-process.ts` share a near-identical orchestration spine (load → transcript → classify → snooze/booking → drafts → auto-send → scoring) with drift-prone divergences.
- **Group B — Email reply send pipelines**: `actions/email-actions.ts:sendEmailReply` (draft approval) and `sendEmailReplyForLead` (manual) duplicate the same provider-send + persistence pipeline and are at risk of one-path-only fixes (CC/safety/idempotency).
- **Group C — "Prompt override + JSON schema call + parse + telemetry"**: repeated in multiple AI features, increasing the chance of inconsistent timeouts, parsing, and observability gaps.

This phase focuses on reducing drift risk without collapsing domain boundaries: keep feature modules separate, but extract shared kernels where the underlying processing pipeline is the same.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 50 | Complete/dirty (check working tree) | `actions/email-actions.ts` | Phase 51c must preserve CC semantics and keep send facades stable while unifying internals. |
| Phase 49 | Complete/dirty (check working tree) | `lib/ai-drafts.ts` | Phase 51d must integrate cleanly with prompt overrides and not regress step-3 verification behavior. |
| Phase 48 | Complete/dirty (check working tree) | `lib/background-jobs/*` + auto-send | Phase 51b must keep job payload contracts stable and preserve auto-send orchestration entrypoints. |
| Phase 47 | Complete/unknown (check working tree) | prompt editor / prompt overrides | Phase 51d must keep prompt editability intact and standardize JSON-schema call plumbing. |
| Phase 43 | Complete/unknown (check working tree) | inbound assignment / follow-up policies | Phase 51b must preserve round-robin + follow-up pause-on-reply behavior across channels. |

## Pre-Flight Conflict Check

- Start Phase 51 from a clean working tree (commit/stash) to avoid cross-phase merge noise.
- Current repo state includes uncommitted changes in the core overlap areas (email send, drafts, inbound jobs, followups) and untracked audit/test artifacts.

**Uncommitted changes at planning time (2026-01-22):**
- `actions/email-actions.ts` — Phase 50 CC/participant work
- `lib/ai-drafts.ts` — Phase 49 step-3 verifier integration
- `lib/ai-drafts/__tests__/step3-verifier.test.ts` — Phase 49 tests
- `lib/ai-drafts/step3-verifier.ts` — Phase 49 sanitization helpers
- `lib/auto-send/__tests__/orchestrator.test.ts` — Phase 48 tests
- `lib/background-jobs/*-inbound-post-process.ts` (4 files) — Phase 48 orchestrator migration
- `lib/followup-engine.ts` — Unknown (may be Phase 43 or later)

## Repo Reality Check (RED TEAM)

- What exists today:
  - **Inbound pipelines**: 5 files (`email-`, `sms-`, `smartlead-`, `instantly-`, `linkedin-inbound-post-process.ts`) with structurally similar orchestration. SmartLead and Instantly are near-identical (strong kernel candidate).
  - **Auto-send orchestrator**: Phase 48 already consolidated auto-send logic into `lib/auto-send/orchestrator.ts` with DI-friendly `createAutoSendExecutor`. All 4 major inbound jobs call `executeAutoSend(...)`.
  - **Email send actions**: `sendEmailReply` (863 lines total in file) and `sendEmailReplyForLead` are parallel implementations with ~300+ lines of shared provider/safety logic. CC resolution was unified in Phase 50 via `resolveOutboundCc()` helper.
  - **Prompt override plumbing**: `lib/ai/prompt-registry.ts:getPromptWithOverrides(...)` is used by 15+ call sites. JSON parsing helpers exist in `lib/ai/json-utils.ts` (verified: `extractJsonObjectFromText`, `extractFirstCompleteJsonObjectFromText`).
  - **Step-3 verifier**: Phase 49 added `lib/ai-drafts/step3-verifier.ts` with `replaceEmDashesWithCommaSpace()` and `enforceCanonicalBookingLink()`.
  - **Test harness**: `npm run test` + `npm run test:coverage` scripts exist (Phase 48); `scripts/test-orchestrator.ts` for orchestrator coverage.
- What the plan assumes:
  - SmartLead and Instantly pipelines are the closest pair and best candidate for kernel migration.
  - Email send unification can use a private internal helper without changing public exports.
  - A "prompt runner" module can be adopted incrementally without breaking existing call sites.
- Verified touch points:
  - `lib/auto-send/orchestrator.ts`: `executeAutoSend`, `createAutoSendExecutor`, `determineAutoSendMode`
  - `lib/auto-send/types.ts`: `AutoSendContext`, `AutoSendResult`, `AutoSendMode`, `AUTO_SEND_CONSTANTS`
  - `lib/ai/prompt-registry.ts`: `getPromptWithOverrides`, `getAIPromptTemplate`, `listAIPromptTemplates`
  - `actions/email-actions.ts`: `sendEmailReply`, `sendEmailReplyForLead`, `resolveOutboundCc`, `validateWithEmailGuard`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes

1. **Inbound kernel extraction changes stage ordering** → Orchestration order matters (e.g., snooze detection must happen before draft gating). Mitigation: define canonical stage ordering as a contract in the kernel; add assertions/logging for stage skips.

2. **Email send unification loses provider-specific edge cases** → EmailBison retry-on-invalid-sender logic, SmartLead/Instantly thread handle decoding, and opt-out gating are easy to regress. Mitigation: preserve all provider branches verbatim in internal helper; add explicit unit tests for each provider path.

3. **Prompt runner adoption breaks existing telemetry attribution** → Current call sites log `promptKey` + `featureId` inconsistently. Mitigation: require both as inputs to prompt runner; don't allow implicit defaults.

4. **LinkedIn pipeline is structurally different** → LinkedIn has enrichment/sync and no snooze/auto-book. Mitigation: exclude LinkedIn from first kernel migration; document it as a future follow-up.

5. **Working tree conflicts corrupt merged files** → Phase 49/50 changes are uncommitted and overlap with Phase 51 touchpoints. Mitigation: **MANDATORY pre-flight commit/stash before starting subphase b**.

### Missing or ambiguous requirements

- **Kernel boundary for transcript building**: SmartLead/Instantly build cross-channel transcripts; SMS builds channel-only transcripts. Should the kernel support both modes via adapter config, or keep transcript building outside the kernel?
  - Current default assumption: transcript building remains adapter-specific (outside kernel).

- **Scope of "prompt runner" adoption**: Which call sites should migrate in Phase 51d? All 15? Just the highest-risk 3-4?
  - **DECIDED**: Migrate ALL call sites to a unified prompt runner. Build a robust, agentic-ready architecture that supports the full range of AI patterns (structured JSON, reasoning, streaming) with proper observability, error categorization, and composability for multi-step workflows.

### Repo mismatches (fix the plan)

- **Subphase 51e references `AGENTS.md`** → File does not exist; should be `CLAUDE.md`. Fixed in subphase e plan.
- **Plan says `npm run typecheck`** → Verify this script exists in `package.json`. If not, remove from success criteria or add it.

### Performance / timeouts

- Inbound kernel adds a function-call layer; ensure no extra DB roundtrips per stage.
- Prompt runner must preserve existing timeout env vars (`OPENAI_TIMEOUT_MS`, `AI_*_TIMEOUT_MS`) and not introduce global defaults that change behavior.

### Security / permissions

- Email send actions already enforce blacklist/opt-out checks before send. Unification must not remove or reorder these guards.
- Prompt runner should not log full prompt content (PII risk); log only promptKey + truncated input length.

### Testing / validation

- Add explicit regression tests for:
  - SmartLead vs Instantly stage ordering equivalence (after kernel migration).
  - `sendEmailReply` vs `sendEmailReplyForLead` behavior equivalence on CC handling.
  - Prompt runner timeout/truncation behavior.
- Verify existing Phase 48 orchestrator tests still pass (`npm run test`).

### Multi-agent coordination

- Phases 48, 49, 50 have uncommitted changes in files Phase 51 will touch.
- **Coordination strategy**: Commit all prior phase work before starting Phase 51 implementation, or implement Phase 51 in a separate branch and rebase.
- No other active phases detected in `docs/planning/`.

## Objectives

* [x] Lock the invariants for auto-booking, drafts, auto-send, and prompt overrides (what must not change).
* [x] Extract a shared inbound post-process kernel (adapter-based) and migrate at least the most similar pipelines first.
* [x] Unify the email reply send pipeline behind one internal implementation used by both exported send paths.
* [x] Introduce a unified "prompt runner" for ALL AI calls — supporting structured JSON and reasoning-effort patterns with standardized error handling and observability (streaming abstraction deferred).
* [x] Add regression coverage + observability so future work can refactor safely.

## Constraints

- No behavior changes intended: refactor-by-extraction, preserve semantics and public exports.
- Keep server action return shapes consistent (`{ success, data?, error? }`) and validate all untrusted inputs.
- Do not weaken safety gates (opt-outs, auto-send gate, auto-reply gate); unify them to reduce "one-path misses".
- Preserve job payload contracts and scheduling semantics for `lib/background-jobs/*`.
- Avoid introducing new secrets or committing sensitive data.
- Exclude LinkedIn pipeline from first kernel migration (structurally different).

## Success Criteria

- [x] Inbound post-processing pipelines share a single orchestration kernel with provider/channel adapters (SmartLead + Instantly migrated).
- [x] Email reply sending routes through a single internal implementation; CC/safety/idempotency behavior is consistent for manual sends and draft approvals.
- [x] **All** LLM call sites (15+) use a unified prompt runner with standardized error categorization + telemetry (v1 supports structured JSON + text; no streaming abstraction yet).
- [x] `npm run test`, `npm run lint`, and `npm run build` pass.
- [x] A written regression checklist (or tests) exists for auto-booking, draft generation, auto-send gating, and prompt override usage.

## Subphase Index

* a — Pre-flight: invariants + regression checklist
* b — Inbound post-process kernel extraction + first migrations (SmartLead + Instantly)
* c — Email send pipeline unification (shared internal kernel)
* d — **Unified AI Prompt Runner: Full Migration + Agentic Architecture** (all 15+ call sites)
* e — Validation, observability, rollout checklist

## Assumptions (Agent)

- SmartLead and Instantly inbound pipelines are structurally equivalent enough to share a kernel with minimal adapter differences (confidence ~95%).
  - Mitigation check: diff the two files before starting subphase b to confirm.
- Email send unification can be done with a private internal helper that both `sendEmailReply` and `sendEmailReplyForLead` delegate to (confidence ~90%).
  - Mitigation check: if provider-specific logic diverges significantly, keep separate internal helpers per provider and unify only the common pre/post steps.
- All 15+ AI call sites can be migrated to the unified prompt runner without behavior changes (confidence ~90%).
  - Mitigation check: categorize call sites by pattern before migration; handle streaming/multi-step flows with dedicated patterns.
  - Migration strategy: migrate by category (structured JSON first, then classification, then multi-step, then streaming) with tests at each stage.
- Insights chat streaming can be refactored to use the prompt runner's streaming pattern (confidence ~85%).
  - Mitigation check: verify current streaming implementation is compatible with pattern abstraction; may need additional hooks.
- `npm run typecheck` script exists or can be added trivially (confidence ~80%).
  - Mitigation check: verify in package.json; if missing, use `npx tsc --noEmit` inline.

## Open Questions (Need Human Input)

- [ ] **Transcript building in kernel scope** (confidence ~70%)
  - What decision is needed: Should the inbound kernel handle transcript building, or should adapters build transcripts before calling the kernel?
  - Why it matters: If kernel handles transcripts, we need to support both cross-channel (SmartLead/Instantly) and channel-only (SMS) modes. If adapters handle it, the kernel is simpler but transcript logic remains duplicated.
  - Current default assumption: Adapters build transcripts; kernel receives `transcript` as input.

## Resolved Decisions

- [x] **Prompt runner adoption scope** — **DECIDED: Full migration**
  - Decision: Migrate ALL 15+ call sites to a unified prompt runner.
  - Rationale: Build robust, agentic-ready infrastructure from the start. Partial migration leaves drift risk; full unification enables consistent observability, error handling, and future multi-agent coordination.
  - Architecture: Support structured JSON output, reasoning models (o1/o3), streaming patterns, circuit breakers, and OpenTelemetry-style tracing.

## Phase Summary

- Shipped:
  - Inbound post-process kernel + adapters: `lib/inbound-post-process/` (SmartLead + Instantly migrated).
  - Email send unification: `actions/email-actions.ts`.
  - Unified prompt runner: `lib/ai/prompt-runner/` and call-site migrations (notably `lib/ai-drafts.ts`, `lib/followup-engine.ts`, `lib/knowledge-asset-extraction.ts`, `lib/insights-chat/thread-extractor.ts`).
- Verified:
  - `npm run typecheck`, `npm run lint` (warnings only), `npm run test`, `npm run build`.
- Notes:
  - Prompt runner v1 focuses on `structured_json` + `text` patterns; add a streaming abstraction if/when a streaming call site needs it.

## Review Notes

- **Review completed**: 2026-01-24
- **Review artifact**: `docs/planning/phase-51/review.md`
- **Quality gates**:
  - `npm run lint` — ✅ 0 errors, 17 warnings (pre-existing)
  - `npm run build` — ✅ passed (Turbopack + middleware warnings are infrastructure-level)
  - `npm run db:push` — skipped (Prisma schema changes are from Phase 53, not Phase 51)
- **Multi-agent coordination**: Working tree contains uncommitted changes from Phases 48–55; no semantic conflicts in Phase 51 deliverables
- **Follow-ups**:
  - Run manual smoke tests in preview/prod before production deploy
  - Add unit tests for kernel stage ordering + email send equivalence
  - Consider kernel migration for email/SMS pipelines in future phase
