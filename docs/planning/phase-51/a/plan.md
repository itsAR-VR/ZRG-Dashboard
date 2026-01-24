# Phase 51a — Pre-flight: Invariants + Regression Checklist

## Focus

Convert the "deep review" and duplication audit findings into explicit invariants and a regression checklist so Phase 51 refactors can be executed without accidental behavior drift in auto-booking, drafts, auto-send, and prompt overrides.

## Inputs

- `docs/audits/structural-duplication-2026-01-22.md`
- Last 10 phases for overlap context: `docs/planning/phase-41` … `docs/planning/phase-50`
- Core touchpoints:
  - `lib/background-jobs/*-inbound-post-process.ts`
  - `actions/email-actions.ts`
  - `lib/ai/prompt-registry.ts` + prompt override plumbing
  - `lib/ai-drafts.ts`
  - `lib/followup-engine.ts`, `lib/auto-reply-gate.ts`, `lib/auto-send-evaluator.ts`

## Work

1. **Multi-agent / working tree sanity**:
   - Run `git status --porcelain` to confirm current uncommitted state.
   - Decide: commit all prior phase work now, or implement Phase 51 on a separate branch.
   - **Mandatory**: Start Phase 51b from a clean base (commit/stash current changes) to avoid cross-phase merge noise.

2. **Lock invariants (must-not-change list)**:
   - **Auto-booking**:
     - `processMessageForAutoBooking(...)` semantics preserved: only called when draft is eligible; follow-up task creation intact.
     - Channel correctness: auto-book triggers on email channels only (SmartLead/Instantly).
     - Idempotency: duplicate auto-book attempts are no-ops.
   - **Draft generation**:
     - `generateResponseDraft(...)` return shape unchanged.
     - Prompt override resolution via `getPromptWithOverrides(...)` applied identically.
     - Step-3 verifier (email only) runs after generation; `sanitizeDraftContent(...)` post-processing unchanged.
   - **Auto-send**:
     - Safety gate ordering: blacklist/opt-out check → auto-send evaluation → delay scheduling → send.
     - `executeAutoSend(...)` from `lib/auto-send/orchestrator.ts` is the single entry point (Phase 48).
     - Precedence contract: campaign AI_AUTO_SEND > legacy per-lead autoReplyEnabled > disabled.
   - **Prompt editor**:
     - Overrides applied deterministically and scoped per workspace via `getPromptWithOverrides(clientId, promptKey)`.
     - No PII logged in prompt content.

3. **Define a regression checklist / test targets**:
   - Identify minimal unit tests (and fixtures) that block drift:
     - `lib/auto-send/__tests__/orchestrator.test.ts` — existing Phase 48 tests.
     - `lib/ai-drafts/__tests__/step3-verifier.test.ts` — existing Phase 49 tests.
     - (New) Email send equivalence test: CC resolution, provider branching, opt-out gating.
     - (New) Inbound pipeline stage ordering assertion (after kernel extraction).

4. **Define refactor boundaries**:
   - **Kernelized (shared)**:
     - Inbound orchestration spine: load → classify → assignment → follow-up pause → snooze → auto-book → draft → auto-send → scoring.
     - Email send internal helper: resolve lead/provider → validate → send → persist → post-hooks.
     - Prompt runner: override lookup → budget → call → parse → telemetry.
   - **Adapter-specific (not kernelized)**:
     - Transcript building (cross-channel vs channel-only).
     - Provider-specific enrichment (EmailBison sync, GHL sync, Clay, etc.).
     - Classification mapping (SmartLead/Instantly inbox classification → sentiment tag).

5. **Rollout / safety switches**:
   - Existing feature flags/config levers:
     - `WorkspaceSettings.autoFollowUpsOnReply` — controls follow-up resume on positive reply.
     - `WorkspaceSettings.roundRobinEnabled` — controls lead assignment (Phase 43).
     - `EmailCampaign.responseMode` — AI_AUTO_SEND vs SETTER_MANAGED.
     - `Lead.autoReplyEnabled` — legacy per-lead auto-reply toggle.
   - No new flags needed for Phase 51 (pure refactor).

## Validation (RED TEAM)

- Run `git status --porcelain` and confirm working tree state matches plan expectations.
- Run `npm run test` to confirm Phase 48 orchestrator tests pass.
- Run `npm run build` to confirm no type errors in current uncommitted state.

## Output

- A written invariants + regression checklist to be used as Phase 51 acceptance criteria (this document, Work section #2 and #3).
- A scoped "kernel boundary" decision that unblocks subphases b–d (this document, Work section #4).

## Handoff

Subphase b implements the inbound post-process kernel and migrates the most similar providers first (SmartLead + Instantly).
